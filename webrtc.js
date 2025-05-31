// WebRTC Configuration
const configuration = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302'
        },
        {
            urls: 'stun:stun1.l.google.com:19302'
        },
        {
            urls: 'stun:stun2.l.google.com:19302'
        },
        {
            urls: 'stun:stun3.l.google.com:19302'
        },
        {
            urls: 'stun:stun4.l.google.com:19302'
        }
    ],
    iceCandidatePoolSize: 10
};

class WebRTCHandler {
    constructor(userId) {
        this.userId = userId;
        this.peers = {};
        this.localStream = null;
        this.currentChannel = null;
        this.socket = io(window.location.origin, {
            transports: ['websocket'],
            upgrade: false,
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        this.usersInChannel = new Set();
        this.initializeSocketListeners();
    }

    async initialize() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Local stream initialized');
        } catch (error) {
            console.error('Error accessing microphone:', error);
        }
    }

    initializeSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to signaling server');
        });

        this.socket.on('user-joined', async (data) => {
            if (data.channelId === this.currentChannel) {
                console.log('User joined:', data.userId);
                this.usersInChannel.add(data.userId);
                this.updateUsersList();
                await this.createPeerConnection(data.userId);
            }
        });

        this.socket.on('user-left', (data) => {
            if (data.channelId === this.currentChannel) {
                console.log('User left:', data.userId);
                this.usersInChannel.delete(data.userId);
                this.updateUsersList();
                this.removePeer(data.userId);
            }
        });

        this.socket.on('channel-users', (data) => {
            if (data.channelId === this.currentChannel) {
                console.log('Received channel users:', data.users);
                this.usersInChannel = new Set(data.users);
                this.updateUsersList();
                
                // Create peer connections for all users in the channel
                data.users.forEach(userId => {
                    if (userId !== this.userId && !this.peers[userId]) {
                        this.initiateCall(userId);
                    }
                });
            }
        });

        this.socket.on('signal', async (data) => {
            if (data.channelId === this.currentChannel) {
                console.log('Received signal from:', data.from);
                await this.handleSignal(data);
            }
        });
    }

    updateUsersList() {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

        console.log('Updating users list:', Array.from(this.usersInChannel));
        usersList.innerHTML = '';
        
        this.usersInChannel.forEach(userId => {
            const userCard = document.createElement('div');
            userCard.className = 'user-card';
            userCard.dataset.userId = userId;
            
            // Add user avatar/icon
            const userIcon = document.createElement('div');
            userIcon.className = 'user-icon';
            userIcon.textContent = userId.charAt(0).toUpperCase();
            
            // Add username
            const username = document.createElement('span');
            username.className = 'username';
            username.textContent = userId === this.userId ? 'You' : `User ${userId.slice(0, 4)}`;
            
            // Add speaking indicator
            const speakingIndicator = document.createElement('div');
            speakingIndicator.className = 'speaking-indicator';
            
            userCard.appendChild(userIcon);
            userCard.appendChild(username);
            userCard.appendChild(speakingIndicator);
            usersList.appendChild(userCard);
        });
    }

    async setCurrentChannel(channelId) {
        if (this.currentChannel) {
            await this.leaveChannel();
        }
        
        this.currentChannel = channelId;
        console.log('Joining channel:', channelId);
        
        // Join the channel
        this.socket.emit('join-channel', {
            channelId: channelId,
            userId: this.userId
        });

        // Request current users in channel
        this.socket.emit('get-channel-users', {
            channelId: channelId
        });

        // Update UI immediately to show you're in the channel
        this.usersInChannel.add(this.userId);
        this.updateUsersList();

        // Update connection status
        const statusIndicator = document.querySelector('.status-indicator');
        const connectionStatus = document.getElementById('connectionStatus');
        if (statusIndicator) statusIndicator.classList.add('connected');
        if (connectionStatus) connectionStatus.textContent = 'Connected';
    }

    async leaveChannel() {
        if (!this.currentChannel) return;

        console.log('Leaving channel:', this.currentChannel);
        
        // Notify server
        this.socket.emit('leave-channel', {
            channelId: this.currentChannel,
            userId: this.userId
        });

        // Close all peer connections
        Object.values(this.peers).forEach(peer => {
            peer.close();
        });
        this.peers = {};
        this.usersInChannel.clear();

        // Update UI
        const currentChannelName = document.getElementById('currentChannelName');
        if (currentChannelName) {
            currentChannelName.textContent = 'No Channel Selected';
        }

        const usersList = document.getElementById('usersList');
        if (usersList) {
            usersList.innerHTML = '';
        }

        this.currentChannel = null;
    }

    async createPeerConnection(userId) {
        if (this.peers[userId]) {
            console.log('Peer connection already exists for:', userId);
            return this.peers[userId];
        }

        console.log('Creating peer connection for:', userId);
        const peerConnection = new RTCPeerConnection(configuration);
        this.peers[userId] = peerConnection;

        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({
                    type: 'candidate',
                    candidate: event.candidate,
                    to: userId,
                    channelId: this.currentChannel
                });
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${userId}:`, peerConnection.connectionState);
        };

        // Handle ICE connection state changes
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${userId}:`, peerConnection.iceConnectionState);
        };

        // Handle incoming tracks
        peerConnection.ontrack = (event) => {
            console.log('Received track from:', userId);
            const audioElement = document.createElement('audio');
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            document.body.appendChild(audioElement);

            // Update user card to show speaking
            const userCard = document.querySelector(`[data-user-id="${userId}"]`);
            if (userCard) {
                userCard.classList.add('speaking');
            }
        };

        return peerConnection;
    }

    async handleSignal(signal) {
        const { type, from, sdp, candidate, channelId } = signal;

        // Only process signals for current channel
        if (channelId !== this.currentChannel) return;

        console.log('Handling signal:', type, 'from:', from);

        try {
            if (type === 'offer') {
                const peerConnection = await this.createPeerConnection(from);
                
                // Set remote description first
                await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                
                // Create and set local description
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                
                this.sendSignal({
                    type: 'answer',
                    sdp: answer,
                    to: from,
                    channelId: this.currentChannel
                });
            }
            else if (type === 'answer') {
                const peerConnection = this.peers[from];
                if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                }
            }
            else if (type === 'candidate') {
                const peerConnection = this.peers[from];
                if (peerConnection) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (error) {
                        console.error('Error adding ICE candidate:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Error handling signal:', error);
        }
    }

    async initiateCall(userId) {
        console.log('Initiating call with:', userId);
        const peerConnection = await this.createPeerConnection(userId);
        
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            this.sendSignal({
                type: 'offer',
                sdp: offer,
                to: userId,
                channelId: this.currentChannel
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    sendSignal(signal) {
        this.socket.emit('signal', signal);
    }

    removePeer(userId) {
        if (this.peers[userId]) {
            this.peers[userId].close();
            delete this.peers[userId];
        }
    }
}

// Export the class for use in app.js
window.WebRTCHandler = WebRTCHandler; 