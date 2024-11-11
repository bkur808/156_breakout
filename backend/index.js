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

// Basic routes
app.get('/', (req, res) => {
    res.send('Server is running');
});

app.get('/api/message', (req, res) => {
    res.json({ message: "Hello from the backend!" });
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle room joining
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
        
        // Notify others in the room that a new user has joined
        socket.to(roomId).emit('user-joined', socket.id);
    });

    // Handle WebRTC signaling data
    socket.on('signal', ({ roomId, signalData }) => {
        // Broadcast signaling data to other users in the room
        socket.to(roomId).emit('signal', { signalData, senderId: socket.id });
    });

    // Handle user disconnecting
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Optional: Notify other users in the room that this user left
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
