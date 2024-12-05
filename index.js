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

    // Store the room details with the instructorId as the socket ID of the creator
    rooms.set(roomId, {
        passcode: isProtected ? passcode : null,
        isProtected,
        instructorId, // This ensures the creator is always the instructor
        expirationTime,
        participants,
    });

    res.status(201).json({ message: 'Room created', roomId });
});

// Serve the static React app
app.use(express.static(path.join(__dirname, 'frontend/build')));

// Dynamic route for React app
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

        const isInstructor = roomData.instructorId === socket.id;

        // Notify the user of their role
        socket.emit('role-assigned', { role: isInstructor ? 'instructor' : 'student' });

        if (!isInstructor) {
            // Assign the student to a free seat
            const freeSeatIndex = roomData.participants.findIndex((seat) => seat === null);
            if (freeSeatIndex !== -1) {
                roomData.participants[freeSeatIndex] = socket.id;
                rooms.set(roomId, roomData);

                console.log(`Student ${socket.id} assigned to seat ${freeSeatIndex} in room ${roomId}`);
            } else {
                console.warn(`No free seats available in room ${roomId}`);
                socket.emit('error', 'No seats available in this room.');
                return;
            }
        } else {
            console.log(`Instructor ${socket.id} joined room ${roomId}`);
        }

        // Join the Socket.IO room
        socket.join(roomId);

        // Notify other users in the room about the new connection
        socket.to(roomId).emit('user-connected', socket.id);

        // Notify the user about current seat data
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
