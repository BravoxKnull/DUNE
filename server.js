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

// Store channel users with their usernames
const channelUsers = new Map();
const socketToUser = new Map();

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
        const { channelId, userId, username } = data;
        
        // Store socket to user mapping
        socketToUser.set(socket.id, { userId, username });
        
        // Add user to channel
        if (!channelUsers.has(channelId)) {
            channelUsers.set(channelId, new Map());
        }
        channelUsers.get(channelId).set(userId, {
            id: userId,
            username: username || userId,
            socketId: socket.id
        });
        
        socket.join(channelId);
        console.log(`User ${username || userId} joined channel ${channelId}`);
        
        // Send current channel users to the new user
        socket.emit('channel-users', {
            channelId,
            users: Array.from(channelUsers.get(channelId).values())
        });
        
        // Notify others in the channel
        socket.to(channelId).emit('user-joined', {
            channelId,
            userId,
            username: username || userId
        });
    });

    // Handle leaving a channel
    socket.on('leave-channel', (data) => {
        const { channelId, userId } = data;
        
        // Remove user from channel
        if (channelUsers.has(channelId)) {
            const userData = channelUsers.get(channelId).get(userId);
            channelUsers.get(channelId).delete(userId);
            if (channelUsers.get(channelId).size === 0) {
                channelUsers.delete(channelId);
            }
            
            socket.leave(channelId);
            console.log(`User ${userData?.username || userId} left channel ${channelId}`);
            
            // Notify others in the channel
            socket.to(channelId).emit('user-left', {
                channelId,
                userId,
                username: userData?.username || userId
            });
            
            // Update remaining users
            if (channelUsers.has(channelId)) {
                io.to(channelId).emit('channel-users', {
                    channelId,
                    users: Array.from(channelUsers.get(channelId).values())
                });
            }
        }
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        const { to, channelId } = data;
        const targetUser = Array.from(channelUsers.get(channelId)?.values() || [])
            .find(user => user.id === to);
        
        if (targetUser) {
            io.to(targetUser.socketId).emit('signal', {
                ...data,
                from: socketToUser.get(socket.id)?.userId
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const userData = socketToUser.get(socket.id);
        
        if (userData) {
            // Remove user from all channels
            channelUsers.forEach((users, channelId) => {
                if (users.has(userData.userId)) {
                    users.delete(userData.userId);
                    if (users.size === 0) {
                        channelUsers.delete(channelId);
                    } else {
                        io.to(channelId).emit('user-left', {
                            channelId,
                            userId: userData.userId,
                            username: userData.username
                        });
                        io.to(channelId).emit('channel-users', {
                            channelId,
                            users: Array.from(users.values())
                        });
                    }
                }
            });
            
            socketToUser.delete(socket.id);
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 