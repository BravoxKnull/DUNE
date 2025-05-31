const express = require('express');
const path = require('path');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Serve static files
app.use(express.static(__dirname));

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Handle all routes by serving index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle joining a channel
    socket.on('join-channel', (data) => {
        const { channelId, userId } = data;
        socket.join(channelId);
        console.log(`User ${userId} joined channel ${channelId}`);
        
        // Notify others in the channel
        socket.to(channelId).emit('user-joined', {
            channelId,
            userId
        });
    });

    // Handle leaving a channel
    socket.on('leave-channel', (data) => {
        const { channelId, userId } = data;
        socket.leave(channelId);
        console.log(`User ${userId} left channel ${channelId}`);
        
        // Notify others in the channel
        socket.to(channelId).emit('user-left', {
            channelId,
            userId
        });
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        socket.to(data.channelId).emit('signal', {
            ...data,
            from: socket.id
        });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 