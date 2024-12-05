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

app.post('/api/create-room', (req, res) => {
    const { roomId, passcode, isProtected, instructorId } = req.body;

    if (rooms.has(roomId)) {
        return res.status(400).json({ error: 'Room ID already exists. Please choose a different Room ID.' });
    }

    const expirationTime = Date.now() + 30 * 60 * 1000; // Room expires in 30 minutes
    const participants = Array(10).fill(null);

    // Store the room details with the instructorId as the creator's socket ID
    rooms.set(roomId, {
        passcode: isProtected ? passcode : null,
        isProtected,
        instructorId, // This ties the instructor to the original creator's socket ID
        expirationTime,
        participants,
    });

    console.log(`Room created: ${roomId} with instructorId: ${instructorId}`);
    res.status(201).json({ message: 'Room created', roomId });
});


// Room details endpoint
app.get('/:roomId', (req, res, next) => {
    const { roomId } = req.params;
    const roomData = rooms.get(roomId);

    if (roomData) {
        return res.status(200).json({
            roomId,
            instructorId: roomData.instructorId,
            isProtected: roomData.isProtected,
        });
    }

    // If the room doesn't exist, continue to the React app
    next();
});

// Serve the static React app
app.use(express.static(path.join(__dirname, 'frontend/build')));

// Catch-all route to serve React
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join-room logic
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

        // Assign the user to a free seat
        const freeSeatIndex = roomData.participants.findIndex((seat) => seat === null);
        if (freeSeatIndex !== -1) {
            roomData.participants[freeSeatIndex] = socket.id;
            rooms.set(roomId, roomData);

            console.log(`User ${socket.id} assigned to seat ${freeSeatIndex} in room ${roomId}`);
        } else {
            console.warn(`No free seats available in room ${roomId}`);
            socket.emit('error', 'No seats available in this room.');
            return;
        }

        // Join the Socket.IO room
        socket.join(roomId);

        // Notify other users in the room about the new connection
        socket.to(roomId).emit('user-connected', socket.id);

        // Send updated seat data to all users in the room
        io.to(roomId).emit('seat-updated', roomData.participants);
    });

    // Signal handling
    socket.on('signal', ({ roomId, userId, offer, answer, candidate }) => {
        io.to(userId).emit('signal', { userId: socket.id, offer, answer, candidate });
    });

    // Claim seat logic
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

    // Disconnect handling
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
