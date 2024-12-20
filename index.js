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

    console.log(`Room ${roomId} validated`);
    res.status(200).json({ message: 'Room validated', instructorId: parsedRoom.instructorId });
});

//Fetch Room Data
app.get('/fetch-room-data/:roomId', async (req, res) => {
    const roomId = req.params.roomId;
    const roomKey = `room:${roomId}`;
  
    try {
      const roomData = await redis.get(roomKey);
      if (roomData) {
        res.json(JSON.parse(roomData));
      } else {
        res.status(404).json({ error: 'Room not found' });
      }
    } catch (error) {
      console.error('Error fetching room data:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
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

    const pendingOffers = {}; // Store pending offers to track origin participants

    socket.on('signal', async ({ roomId, offer, answer, candidate }) => {
        const roomKey = `room:${roomId}`;
        const roomData = await redis.get(roomKey);

        if (!roomData) return console.error(`Room ${roomId} not found`);

        const parsedRoom = JSON.parse(roomData);
        const instructorId = parsedRoom.instructorId;

        if (offer) {
            // Relay offers to the instructor and store the sender ID
            console.log(`Relaying offer to instructor ${instructorId} from ${socket.id}`);
            pendingOffers[instructorId] = socket.id; // Track the participant's ID
            io.to(instructorId).emit('signal', { roomId, userId: socket.id, offer });
        } else if (answer) {
            // Relay answers back to the participant who sent the offer
            const participantId = pendingOffers[socket.id]; // Get the original participant's ID
            if (participantId) {
                console.log(`Relaying answer back to participant ${participantId}`);
                io.to(participantId).emit('signal', { roomId, userId: socket.id, answer });
                delete pendingOffers[socket.id]; // Clean up after relaying
            } else {
                console.error(`No pending offer found for instructor ${socket.id}`);
            }
        } else if (candidate) {
            // Relay ICE candidates to the appropriate peer
            const target = socket.id === instructorId ? parsedRoom.participants[0] : instructorId;
            console.log(`Relaying ICE candidate to ${target}`);
            io.to(target).emit('signal', { roomId, userId: socket.id, candidate });
        }
    });

});

app.use(express.static(path.join(__dirname, 'frontend/build')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
