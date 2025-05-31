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
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all'
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
            upgrade: false,
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        this.usersInChannel = new Map();
        this.audioContext = null;
        this.audioAnalyzers = new Map();
        this.remoteStreams = new Map();
        this.initializeSocketListeners();
    }

    async initialize() {
        try {
            // Request audio with specific constraints for better quality
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 48000,
                    latency: 0,
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true
                },
                video: false
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
            
            console.log('Local stream initialized with audio processing');
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
                        indicator.classList.toggle('active', isSpeaking);
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
                
                // Clean up audio elements
                const audioElement = document.getElementById(`audio-${data.userId}`);
                if (audioElement) {
                    audioElement.srcObject = null;
                    audioElement.remove();
                }
                this.remoteStreams.delete(data.userId);
                this.audioAnalyzers.delete(data.userId);
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
                console.log('Received signal from:', data.from);
                await this.handleSignal(data);
            }
        });
    }

    updateUsersList() {
        const usersList = document.getElementById('usersList');
        if (!usersList) return;

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
            if (userId === this.userId) return;
            
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

        // Update UI immediately
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
        
        // Clean up all remote streams and audio elements
        this.remoteStreams.forEach((stream, userId) => {
            const audioElement = document.getElementById(`audio-${userId}`);
            if (audioElement) {
                audioElement.srcObject = null;
                audioElement.remove();
            }
        });
        
        this.peers = {};
        this.usersInChannel.clear();
        this.remoteStreams.clear();
        this.audioAnalyzers.clear();

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
            if (peerConnection.connectionState === 'connected') {
                console.log('Peer connection established with:', userId);
            }
            if (peerConnection.connectionState === 'disconnected' || 
                peerConnection.connectionState === 'failed') {
                this.removePeer(userId);
            }
        };

        // Handle ICE connection state changes
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${userId}:`, peerConnection.iceConnectionState);
            if (peerConnection.iceConnectionState === 'disconnected' || 
                peerConnection.iceConnectionState === 'failed') {
                this.removePeer(userId);
            }
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
            
            // Add track to remote stream if not already present
            if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
                remoteStream.addTrack(event.track);
            }
            
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
            
            // Set the stream if it's different
            if (audioElement.srcObject !== remoteStream) {
                audioElement.srcObject = remoteStream;
            }
            
            // Set up audio analysis if not already done
            if (!this.audioAnalyzers.has(userId)) {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioContext.createMediaStreamSource(remoteStream);
                const analyzer = audioContext.createAnalyser();
                analyzer.fftSize = 256;
                source.connect(analyzer);
                this.audioAnalyzers.set(userId, analyzer);
            }
            
            // Play the audio
            audioElement.play().catch(error => {
                console.error('Error playing audio:', error);
            });
        };

        return peerConnection;
    }

    async handleSignal(signal) {
        const { type, from, sdp, candidate, channelId } = signal;

        // Only process signals for current channel
        if (channelId !== this.currentChannel) return;

        console.log('Handling signal:', type, 'from:', from);

        try {
            if (!this.peers[from]) {
                await this.createPeerConnection(from);
            }
            const peerConnection = this.peers[from];

            switch (type) {
                case 'offer':
                    if (peerConnection.signalingState !== 'stable') {
                        console.log('Cannot handle offer, signaling state is:', peerConnection.signalingState);
                        return;
                    }
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    this.sendSignal({
                        type: 'answer',
                        sdp: answer,
                        to: from,
                        channelId: this.currentChannel
                    });
                    break;

                case 'answer':
                    if (peerConnection.signalingState !== 'have-local-offer') {
                        console.log('Cannot handle answer, signaling state is:', peerConnection.signalingState);
                        return;
                    }
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                    break;

                case 'candidate':
                    if (candidate) {
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (error) {
                            console.error('Error adding ICE candidate:', error);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling signal:', error);
        }
    }

    async initiateCall(userId) {
        console.log('Initiating call with:', userId);
        const peerConnection = await this.createPeerConnection(userId);
        
        try {
            if (peerConnection.signalingState !== 'stable') {
                console.log('Cannot create offer, signaling state is:', peerConnection.signalingState);
                return;
            }

            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            
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
            
            // Clean up audio elements
            const audioElement = document.getElementById(`audio-${userId}`);
            if (audioElement) {
                audioElement.srcObject = null;
                audioElement.remove();
            }
            this.remoteStreams.delete(userId);
            this.audioAnalyzers.delete(userId);
        }
    }
}

// Export the class for use in app.js
window.WebRTCHandler = WebRTCHandler;