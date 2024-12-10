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

redis.ping((err, result) => { //to check if things are working right - look for PONG in the heroku logs
    if (err) {
        console.error('Redis connection error:', err.message);
    } else {
        console.log('Redis connected successfully:', result);
    }
});

// Room creation endpoint
app.post('/api/create-room', async (req, res) => {
    console.log('Received POST /api/create-room'); // Debug log to confirm the request hits
    console.log('Request Body:', req.body); // Debug the payload

    try {
        const { roomId, passcode, isProtected, instructorId } = req.body;

        // Check required parameters
        if (!roomId || !instructorId) {
            console.log('Missing required fields');
            return res.status(400).json({ error: 'Missing required fields: roomId or instructorId.' });
        }

        // Redis logic
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
            participants: [instructorId, ...Array(8).fill(null)],
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

    // Passcode validation
    if (parsedRoom.isProtected && (!passcode || parsedRoom.passcode !== passcode)) {
        return res.status(403).json({ error: 'Incorrect passcode.' });
    }

    // Include instructorId in the response for frontend to validate role
    res.status(200).json({
        message: 'Room validated',
        instructorId: parsedRoom.instructorId, // Send instructor ID to the client
    });
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join-room logic
    socket.on('join-room', async ({ roomId, passcode }) => {
        const roomKey = `room:${roomId}`;
        const roomData = await redis.get(roomKey);

        if (!roomData) {
            socket.emit('error', 'Room does not exist.');
            return;
        }

        const parsedRoom = JSON.parse(roomData);

        // Passcode validation
        if (parsedRoom.isProtected && parsedRoom.passcode !== passcode) {
            socket.emit('error', 'Incorrect passcode.');
            return;
        }

        // Check if the user is the instructor
        const isInstructor = parsedRoom.instructorId === socket.id;

        if (isInstructor) {
            console.log(`Instructor ${socket.id} joined room ${roomId}`);
        } else {
            // Assign the user to the next available seat (1-8)
            const freeSeatIndex = parsedRoom.participants.findIndex((seat, index) => index > 0 && seat === null);
            if (freeSeatIndex !== -1) {
                parsedRoom.participants[freeSeatIndex] = socket.id;
                await redis.set(roomKey, JSON.stringify(parsedRoom), 'EX', 1800);

                console.log(`User ${socket.id} assigned to seat ${freeSeatIndex} in room ${roomId}`);
            } else {
                socket.emit('error', 'No seats available in this room.');
                return;
            }
        }

        // Emit updated participants and role
        socket.join(roomId);
        io.to(roomId).emit('seat-updated', parsedRoom.participants);
        socket.emit('role-assigned', { role: isInstructor ? 'instructor' : 'student' });

        io.to(roomID).emit(
            'signal-message',
            `User ${socket.id} joined room ${roomId} as ${isInstructor ? 'Instructor' : 'Student'}`
        );
    });


    // Disconnect handling
    socket.on('disconnect', async () => {
        const keys = await redis.keys('room:*');

        for (const key of keys) {
            const roomData = JSON.parse(await redis.get(key));

            // Find and remove the disconnected user
            const seatIndex = roomData.participants.indexOf(socket.id);
            if (seatIndex !== -1) {
                console.log(`User ${socket.id} disconnected from room ${key.split(':')[1]}`);
                roomData.participants[seatIndex] = null;

                // Update room data in Redis
                await redis.set(key, JSON.stringify(roomData), 'EX', 1800);
                io.to(key.split(':')[1]).emit('seat-updated', roomData.participants);
            }

            // Check if the room is empty
            const hasParticipants = roomData.participants.some((seat) => seat !== null);
            if (!hasParticipants) {
                await redis.del(key); // Delete the room if empty
                console.log(`Room ${key.split(':')[1]} deleted due to inactivity.`);
            }
        }

        console.log(`User disconnected: ${socket.id}`);
        io.to(key.split(':')[1]).emit(
            'signal-message',
            `User ${socket.id} disconnected from room ${key.split(':')[1]}`
        );
        
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
