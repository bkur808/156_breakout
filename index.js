const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Redis = require('ioredis'); // Redis for persistent storage

// Initialize Redis
const redis = new Redis(process.env.REDIS_URL); // Add REDIS_URL to your Heroku environment

const app = express();
app.use(express.json());

// Configure CORS dynamically based on environment
app.use(
    cors({
        origin: process.env.NODE_ENV === 'production' ? '*' : 'http://localhost:3000',
        methods: ['GET', 'POST'],
    })
);

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? '*' : 'http://localhost:3000',
        methods: ['GET', 'POST'],
    },
});

redis.ping((err, result) => {
    if (err) {
        console.error('Redis connection error:', err.message);
    } else {
        console.log('Redis connected successfully:', result);
    }
});

// Room creation endpoint
app.post('/api/create-room', async (req, res) => {
    console.log('Received POST /api/create-room');
    console.log('Request Body:', req.body);

    try {
        const { roomId, passcode, isProtected, instructorId } = req.body;

        if (!roomId || !instructorId) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields: roomId or instructorId.' });
        }

        const roomKey = `room:${roomId}`;
        const roomExists = await redis.exists(roomKey);

        if (roomExists) {
            console.log('Room already exists');
            return res.status(400).json({ error: 'Room ID already exists. Please choose a different Room ID.' });
        }

        const roomData = {
            passcode: isProtected ? passcode : null,
            isProtected,
            instructorId,
            participants: [Array(8).fill(null)],
        };

        await redis.set(roomKey, JSON.stringify(roomData), 'EX', 1800); // Set with 30 min expiry
        console.log('Room created successfully:', roomId);

        res.status(201).json({ message: 'Room created', roomId });
    } catch (err) {
        console.error('Error in /api/create-room:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Validate room endpoint
app.get('/api/validate-room', async (req, res) => {
    const { roomId, passcode } = req.query;
    const roomKey = `room:${roomId}`;
    const roomData = await redis.get(roomKey);

    if (!roomData) {
        return res.status(404).json({ error: 'Room does not exist.' });
    }

    const parsedRoom = JSON.parse(roomData);

    if (parsedRoom.isProtected && (!passcode || parsedRoom.passcode !== passcode)) {
        return res.status(403).json({ error: 'Incorrect passcode.' });
    }

    res.status(200).json({
        message: 'Room validated',
        instructorId: parsedRoom.instructorId,
    });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join-room', async ({ roomId, passcode }) => {
        if (socket.rooms.has(roomId)) {
            console.log(`Socket ${socket.id} already joined room ${roomId}`);
            return; // Prevent duplicate joins
        }
    
        const roomKey = `room:${roomId}`;
        const roomData = await redis.get(roomKey);
    
        if (!roomData) {
            socket.emit('error', 'Room does not exist.');
            return;
        }
    
        const parsedRoom = JSON.parse(roomData);
    
        if (parsedRoom.isProtected && parsedRoom.passcode !== passcode) {
            socket.emit('error', 'Incorrect passcode.');
            return;
        }
    
        const isInstructor = parsedRoom.instructorId === socket.id;
    
        if (isInstructor) {
            console.log(`Instructor ${socket.id} joined room ${roomId}`);
        } else {
            const alreadyAssigned = parsedRoom.participants.includes(socket.id);
            if (!alreadyAssigned) {
                const freeSeatIndex = parsedRoom.participants.findIndex((seat, index) => index > 0 && seat === null);
                if (freeSeatIndex !== -1) {
                    parsedRoom.participants[freeSeatIndex] = socket.id;
                    console.log(`User ${socket.id} assigned to seat ${freeSeatIndex} in room ${roomId}`);
                } else {
                    socket.emit('error', 'No seats available in this room.');
                    return;
                }
            }
        }
    
        await redis.set(roomKey, JSON.stringify(parsedRoom), 'EX', 1800);
        socket.join(roomId);
    
        io.to(roomId).emit('seat-updated', parsedRoom.participants);
        socket.emit('role-assigned', { role: isInstructor ? 'instructor' : 'student' });
        io.to(roomId).emit('signal-message', `User ${socket.id} joined room ${roomId}`);
        io.to(roomId).emit('user-connected', socket.id);
    });
    
    socket.on('disconnect', async () => {
        for (const roomId of socket.rooms) {
            if (roomId === socket.id) continue; // Skip the socket's own room
    
            const roomKey = `room:${roomId}`;
            const roomData = JSON.parse(await redis.get(roomKey));
    
            const seatIndex = roomData.participants.indexOf(socket.id);
            if (seatIndex !== -1) {
                roomData.participants[seatIndex] = null;
    
                if (roomData.instructorId === socket.id) {
                    console.log(`Instructor disconnected, closing room ${roomId}`);
                    await redis.del(roomKey);
                    io.to(roomId).emit('room-closed', { message: 'The instructor closed the room.' });
                    return;
                }
    
                await redis.set(roomKey, JSON.stringify(roomData), 'EX', 1800);
                io.to(roomId).emit('seat-updated', roomData.participants);
                io.to(roomId).emit('signal-message', `User ${socket.id} disconnected`);
            }
        }
    
        console.log(`User disconnected: ${socket.id}`);
    });    

    // Chat (signal-message) logic
    socket.on('signal-message', (message) => {
        const roomId = Array.from(socket.rooms).find((room) => room !== socket.id); // Find the room the socket is in
        if (roomId) {
            io.to(roomId).emit('signal-message', { sender: socket.id, text: message });
            console.log(`Message sent from ${socket.id} to room ${roomId}: ${message}`);
        }
    });
});

// Serve the static React app
app.use(express.static(path.join(__dirname, 'frontend/build')));

// Catch-all route to serve React
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
