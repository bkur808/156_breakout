const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

// In-memory store for rooms
const rooms = new Map();

// Room creation endpoint
app.post('/api/create-room', (req, res) => {
    const { roomId, passcode, isProtected, instructorId } = req.body;

    if (rooms.has(roomId)) {
        return res.status(400).json({ error: 'Room ID already exists. Please choose a different Room ID.' });
    }

    const expirationTime = Date.now() + 30 * 60 * 1000; // Room expires in 30 minutes
    const participants = Array(10).fill(null);

    rooms.set(roomId, {
        passcode: isProtected ? passcode : null,
        isProtected,
        instructorId,
        expirationTime,
        participants,
    });

    res.status(201).json({ message: 'Room created', roomId });
});

// Room validation endpoint
app.get('/api/validate-room', (req, res) => {
    const { roomId, passcode } = req.query;

    const roomData = rooms.get(roomId);
    if (!roomData) {
        return res.status(404).json({ error: 'Room does not exist.' });
    }

    if (roomData.isProtected && (!passcode || roomData.passcode !== passcode)) {
        return res.status(403).json({ error: 'Incorrect passcode.' });
    }

    res.status(200).json({ message: 'Room validated' });
});

// Dynamic route to fetch room details
app.get('/:roomId', (req, res, next) => {
    const { roomId } = req.params;

    // Check if roomId exists in rooms map
    const roomData = rooms.get(roomId);

    if (roomData) {
        return res.status(200).json({
            roomId,
            instructorId: roomData.instructorId,
            isProtected: roomData.isProtected,
        });
    }

    // If no room data, continue to serve React app
    next();
});

// Serve React app for all unmatched routes
app.use(express.static(path.join(__dirname, 'frontend/build')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, passcode }) => {
        const roomData = rooms.get(roomId);

        if (!roomData) {
            socket.emit('error', 'Room does not exist.');
            return;
        }

        if (roomData.isProtected && roomData.passcode !== passcode) {
            socket.emit('error', 'Incorrect passcode.');
            return;
        }

        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
        socket.to(roomId).emit('user-connected', socket.id);
        socket.emit('seat-updated', roomData.participants);
    });

    socket.on('signal', ({ roomId, userId, offer, answer, candidate }) => {
        io.to(userId).emit('signal', { userId: socket.id, offer, answer, candidate });
    });

    socket.on('claim-seat', ({ roomId, seatIndex }, callback) => {
        const roomData = rooms.get(roomId);

        if (!roomData) {
            callback({ error: 'Room does not exist.' });
            return;
        }

        const existingSeat = roomData.participants.indexOf(socket.id);
        if (existingSeat !== -1) {
            callback({ error: 'You already have a seat.' });
            return;
        }

        if (roomData.participants[seatIndex]) {
            callback({ error: 'Seat is already taken.' });
            return;
        }

        roomData.participants[seatIndex] = socket.id;
        rooms.set(roomId, roomData);

        io.to(roomId).emit('seat-updated', roomData.participants);
        callback({ success: true });
    });

    socket.on('disconnect', () => {
        rooms.forEach((roomData, roomId) => {
            const seatIndex = roomData.participants.indexOf(socket.id);
            if (seatIndex !== -1) {
                roomData.participants[seatIndex] = null;
                io.to(roomId).emit('seat-updated', roomData.participants);
            }

            const remainingUsers = io.sockets.adapter.rooms.get(roomId)?.size || 0;
            if (remainingUsers === 0) {
                rooms.delete(roomId);
            }
        });

        console.log(`User disconnected: ${socket.id}`);
    });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
