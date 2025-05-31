// WebRTC Configuration
const configuration = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302'
        }
    ]
};

class WebRTCHandler {
    constructor(userId, username) {
        this.userId = userId;
        this.username = username;
        this.peers = {};
        this.localStream = null;
        this.currentChannel = null;
        this.socket = io(window.location.origin, {
            transports: ['websocket'],
            upgrade: false
        });
        this.usersInChannel = new Map();
        this.audioContext = null;
        this.audioAnalyzers = new Map();
        this.remoteStreams = new Map();
        this.initializeSocketListeners();
    }

    async initialize() {
        try {
            // Request audio with basic constraints
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true
            });
            
            // Initialize audio context for level monitoring
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            const analyzer = this.audioContext.createAnalyser();
            analyzer.fftSize = 256;
            source.connect(analyzer);
            
            // Store analyzer for local stream
            this.audioAnalyzers.set(this.userId, analyzer);
            
            // Start monitoring audio levels
            this.startAudioLevelMonitoring();
            
            console.log('Local stream initialized successfully');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            throw error;
        }
    }

    startAudioLevelMonitoring() {
        const updateLevels = () => {
            this.audioAnalyzers.forEach((analyzer, userId) => {
                const dataArray = new Uint8Array(analyzer.frequencyBinCount);
                analyzer.getByteFrequencyData(dataArray);
                
                // Calculate average volume
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                const isSpeaking = average > 15;
                
                // Update speaking indicator
                const userCard = document.querySelector(`[data-user-id="${userId}"]`);
                if (userCard) {
                    const indicator = userCard.querySelector('.speaking-indicator');
                    if (indicator) {
                        if (isSpeaking) {
                            indicator.classList.add('active');
                        } else {
                            indicator.classList.remove('active');
                        }
                    }
                }
            });
            
            requestAnimationFrame(updateLevels);
        };
        
        updateLevels();
    }

    initializeSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to signaling server');
        });

        this.socket.on('user-joined', async (data) => {
            if (data.channelId === this.currentChannel) {
                console.log('User joined:', data.userId);
                this.usersInChannel.set(data.userId, {
                    id: data.userId,
                    username: data.username || data.userId
                });
                this.updateUsersList();
                await this.initiateCall(data.userId);
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
                this.usersInChannel = new Map(data.users.map(user => [user.id, user]));
                this.updateUsersList();
                
                // Create peer connections for all users in the channel
                data.users.forEach(user => {
                    if (user.id !== this.userId && !this.peers[user.id]) {
                        this.initiateCall(user.id);
                    }
                });
            }
        });

        this.socket.on('signal', async (data) => {
            if (data.channelId === this.currentChannel) {
                console.log('Received signal:', data.type, 'from:', data.from);
                await this.handleSignal(data);
            }
        });
    }

    updateUsersList() {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

        console.log('Updating users list:', Array.from(this.usersInChannel.values()));
        usersList.innerHTML = '';
        
        // Add current user first
        const currentUserCard = document.createElement('div');
        currentUserCard.className = 'user-card';
        currentUserCard.dataset.userId = this.userId;
        
        const currentUserIcon = document.createElement('div');
        currentUserIcon.className = 'user-icon';
        currentUserIcon.textContent = this.username.charAt(0).toUpperCase();
        
        const currentUsername = document.createElement('span');
        currentUsername.className = 'username';
        currentUsername.textContent = 'You';
        
        const currentSpeakingIndicator = document.createElement('div');
        currentSpeakingIndicator.className = 'speaking-indicator';
        
        currentUserCard.appendChild(currentUserIcon);
        currentUserCard.appendChild(currentUsername);
        currentUserCard.appendChild(currentSpeakingIndicator);
        usersList.appendChild(currentUserCard);
        
        // Add other users
        this.usersInChannel.forEach((userData, userId) => {
            if (userId === this.userId) return; // Skip current user
            
            const userCard = document.createElement('div');
            userCard.className = 'user-card';
            userCard.dataset.userId = userId;
            
            const userIcon = document.createElement('div');
            userIcon.className = 'user-icon';
            userIcon.textContent = userData.username.charAt(0).toUpperCase();
            
            const username = document.createElement('span');
            username.className = 'username';
            username.textContent = userData.username;
            
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
            userId: this.userId,
            username: this.username
        });

        // Request current users in channel
        this.socket.emit('get-channel-users', {
            channelId: channelId
        });

        // Update UI immediately to show you're in the channel
        this.usersInChannel.set(this.userId, {
            id: this.userId,
            username: this.username
        });
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
                console.log('Adding local track to peer connection:', track.kind);
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Sending ICE candidate to:', userId);
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
            console.log('Received track from:', userId, 'Track kind:', event.track.kind);
            
            // Get or create remote stream
            let remoteStream = this.remoteStreams.get(userId);
            if (!remoteStream) {
                remoteStream = new MediaStream();
                this.remoteStreams.set(userId, remoteStream);
            }
            
            // Add track to remote stream
            remoteStream.addTrack(event.track);
            
            // Create or update audio element
            let audioElement = document.getElementById(`audio-${userId}`);
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = `audio-${userId}`;
                audioElement.autoplay = true;
                audioElement.playsInline = true;
                audioElement.volume = 1.0;
                document.body.appendChild(audioElement);
            }
            
            // Set the stream
            audioElement.srcObject = remoteStream;
            
            // Set up audio analysis for remote stream
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(remoteStream);
            const analyzer = audioContext.createAnalyser();
            analyzer.fftSize = 256;
            source.connect(analyzer);
            this.audioAnalyzers.set(userId, analyzer);
            
            // Log audio element state
            audioElement.onloadedmetadata = () => {
                console.log('Audio element loaded metadata for:', userId);
                audioElement.play().catch(error => {
                    console.error('Error playing audio:', error);
                });
            };
        };

        return peerConnection;
    }

    async handleSignal(signal) {
        const { type, from, sdp, candidate, channelId } = signal;

        if (channelId !== this.currentChannel) return;

        console.log('Handling signal:', type, 'from:', from);

        try {
            if (type === 'offer') {
                const peerConnection = await this.createPeerConnection(from);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
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
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                }
            }
            else if (type === 'candidate') {
                const peerConnection = this.peers[from];
                if (peerConnection) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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