const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
    }
});

// In-memory store for rooms with passcode, expiration, and participants
const rooms = new Map();

// Basic routes
app.get('/', (req, res) => {
    res.send('Server is running');
});

app.get('/api/message', (req, res) => {
    res.json({ message: "Hello from the backend!" });
});

// Room creation endpoint
app.post('/api/create-room', (req, res) => {
    const { roomId, passcode, isProtected, instructorId } = req.body; // Include instructorId from the request

    // Check if room already exists
    if (rooms.has(roomId)) {
        return res.status(400).json({ error: 'Room ID already exists. Please choose a different Room ID.' });
    }

    const expirationTime = Date.now() + 30 * 60 * 1000; // Room expires in 30 minutes
    const participants = Array(10).fill(null);

    // Store room details including instructor
    rooms.set(roomId, {
        passcode: isProtected ? passcode : null,
        isProtected,
        instructorId, // Save the instructor ID
        expirationTime,
        participants,
    });

    console.log(`Room created: ${roomId}`, rooms.get(roomId)); // Debugging log

    res.status(201).json({ message: 'Room created', roomId });
});

app.get('/api/validate-room', (req, res) => {
    const { roomId, passcode } = req.query;

    console.log(`Validation request for roomId=${roomId}, passcode=${passcode}`);

    const roomData = rooms.get(roomId);

    if (!roomData) {
        console.error(`Room ${roomId} does not exist.`);
        return res.status(404).json({ error: 'Room does not exist.' });
    }

    if (roomData.isProtected) {
        console.log(`Room is protected. Stored passcode: ${roomData.passcode}`);
        if (!passcode || roomData.passcode !== passcode) {
            console.error('Incorrect passcode.');
            return res.status(403).json({ error: 'Incorrect passcode.' });
        }
    } else {
        console.log('Room is not protected.');
    }

    res.status(200).json({ message: 'Room validated' });
});

app.get('/api/room-details', (req, res) => {
    const { roomId } = req.query;

    const roomData = rooms.get(roomId);

    if (!roomData) {
        return res.status(404).json({ error: 'Room does not exist.' });
    }

    res.status(200).json({
        roomId,
        instructorId: roomData.instructorId,
        isProtected: roomData.isProtected,
    });
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle room joining
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

        // Notify existing participants about the new user
        socket.to(roomId).emit('user-connected', socket.id);

        // Send current seat data to the new user
        socket.emit('seat-updated', roomData.participants);
    });

    // Handle WebRTC signaling
    socket.on('signal', ({ roomId, userId, offer, answer, candidate }) => {
        if (offer || answer || candidate) {
            console.log(`Signal from ${socket.id} to ${userId}:`, { offer, answer, candidate });
            io.to(userId).emit('signal', {
                userId: socket.id,
                offer,
                answer,
                candidate,
            });
        }
    });

    // Handle seat claiming
    socket.on('claim-seat', ({ roomId, seatIndex }, callback) => {
        const roomData = rooms.get(roomId);

        if (!roomData) {
            callback({ error: 'Room does not exist.' });
            return;
        }

        // Check if the user already has a seat
        const existingSeat = roomData.participants.indexOf(socket.id);
        if (existingSeat !== -1) {
            callback({ error: 'You already have a seat.' });
            return;
        }

        // Check if the seat is available
        if (roomData.participants[seatIndex]) {
            callback({ error: 'Seat is already taken.' });
            return;
        }

        // Assign the user to the seat
        roomData.participants[seatIndex] = socket.id;
        rooms.set(roomId, roomData); // Update the room data
        console.log(`User ${socket.id} claimed seat ${seatIndex} in room ${roomId}`);

        // Notify all participants about the updated seat assignments
        io.to(roomId).emit('seat-updated', roomData.participants);
        callback({ success: true });
    });

    // Handle user disconnecting
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        let roomToDelete = null;

        // Remove user from any seats they occupied
        rooms.forEach((roomData, roomId) => {
            const seatIndex = roomData.participants.indexOf(socket.id);
            if (seatIndex !== -1) {
                roomData.participants[seatIndex] = null; // Clear the seat
                io.to(roomId).emit('seat-updated', roomData.participants);
                console.log(`Cleared seat ${seatIndex} in room ${roomId} due to disconnection.`);
            }

            // Check if the room is empty
            const remainingUsers = io.sockets.adapter.rooms.get(roomId)?.size || 0;
            if (remainingUsers === 0) {
                roomToDelete = roomId;
            }
        });

        // Delete the room if no users remain
        if (roomToDelete) {
            rooms.delete(roomToDelete);
            console.log(`Room ${roomToDelete} deleted as no users remain.`);
        }

        // Notify remaining participants that the user disconnected
        socket.to([...socket.rooms]).emit('user-disconnected', socket.id);
    });
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
