const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Redis = require('ioredis'); // Redis for persistent storage

const redis = new Redis(process.env.REDIS_URL); // Add REDIS_URL to your Heroku environment

const app = express();
app.use(express.json());

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
    const { roomId, passcode, isProtected, instructorId, participants } = req.body;

    if (!roomId || !instructorId) {
        return res.status(400).json({ error: 'Missing required fields: roomId or instructorId.' });
    }

    const roomKey = `room:${roomId}`;
    const roomExists = await redis.exists(roomKey);

    if (roomExists) {
        return res.status(400).json({ error: 'Room ID already exists.' });
    }

    const roomData = {
        passcode: isProtected ? passcode : null,
        isProtected,
        instructorId, // Track instructor separately
        participants: Array(8).fill(null), // 8 seats for students
    };

    await redis.set(roomKey, JSON.stringify(roomData), 'EX', 1800);
    console.log(JSON.stringify(roomData));
    console.log(`Room ${roomId} created by instructor ${instructorId}`);
    res.status(201).json({ message: 'Room created', roomId });
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

    console.log(`Room ${roomId} validated by ${socket.id}`);
    res.status(200).json({ message: 'Room validated', instructorId: parsedRoom.instructorId });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', async ({ roomId, passcode }) => {
        const roomKey = `room:${roomId}`;
        const roomData = await redis.get(roomKey);

        if (!roomData) {
            socket.emit('error', 'Room does not exist.');
            return;
        }

        const parsedRoom = JSON.parse(roomData);
        const isInstructor = parsedRoom.instructorId === socket.id;

        if (parsedRoom.isProtected && parsedRoom.passcode !== passcode) {
            socket.emit('error', 'Incorrect passcode.');
            return;
        }

        // Manage participant seat assignment
        if (!isInstructor) {
            const alreadyAssigned = parsedRoom.participants.includes(socket.id);
            if (!alreadyAssigned) {
                const freeSeatIndex = parsedRoom.participants.findIndex((seat) => seat === null);
                if (freeSeatIndex !== -1) {
                    parsedRoom.participants[freeSeatIndex] = socket.id;
                    console.log(`User ${socket.id} assigned to seat ${freeSeatIndex}`);
                } else {
                    socket.emit('error', 'No seats available.');
                    return;
                }
            }
        } else {
            console.log(`Instructor ${socket.id} joined room ${roomId}`);
        }

        await redis.set(roomKey, JSON.stringify(parsedRoom), 'EX', 1800);
        socket.join(roomId);

        // Emit seat updates and connection info
        io.to(roomId).emit('seat-updated', parsedRoom.participants);
        io.to(roomId).emit('user-connected', socket.id);
        socket.emit('role-assigned', { role: isInstructor ? 'instructor' : 'student' });
    });

    socket.on('disconnect', async () => {
        for (const roomId of socket.rooms) {
            if (roomId === socket.id) continue;

            const roomKey = `room:${roomId}`;
            const roomData = await redis.get(roomKey);

            if (!roomData) continue;

            const parsedRoom = JSON.parse(roomData);

            const seatIndex = parsedRoom.participants.indexOf(socket.id);
            if (seatIndex !== -1) {
                parsedRoom.participants[seatIndex] = null;
                console.log(`Seat ${seatIndex} cleared for room ${roomId}`);
            }

            // Handle instructor disconnect
            if (parsedRoom.instructorId === socket.id) {
                console.log(`Instructor disconnected, closing room ${roomId}`);
                await redis.del(roomKey);
                io.to(roomId).emit('room-closed', { message: 'The instructor closed the room.' });
                return;
            }

            await redis.set(roomKey, JSON.stringify(parsedRoom), 'EX', 1800);
            io.to(roomId).emit('seat-updated', parsedRoom.participants);
            io.to(roomId).emit('user-disconnected', socket.id);
        }
        console.log(`User disconnected: ${socket.id}`);
    });

    // Chat (signal-message) logic
    socket.on('signal-message', (message) => {
        const roomId = Array.from(socket.rooms).find((room) => room !== socket.id);
        if (roomId) {
            io.to(roomId).emit('signal-message', { sender: socket.id, text: message });
        }
    });
});

app.use(express.static(path.join(__dirname, 'frontend/build')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
