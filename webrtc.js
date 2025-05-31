// WebRTC Configuration
const configuration = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302'
        }
    ]
};

class WebRTCHandler {
    constructor() {
        this.localStream = null;
        this.peerConnections = {};
        this.currentChannel = null;
        this.isMuted = false;
        this.isConnected = false;

        // DOM Elements
        this.joinBtn = document.getElementById('joinChannelBtn');
        this.leaveBtn = document.getElementById('leaveChannelBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.statusIndicator = document.querySelector('.status-indicator');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.usersList = document.getElementById('usersList');

        // Bind event listeners
        this.joinBtn.addEventListener('click', () => this.joinChannel());
        this.leaveBtn.addEventListener('click', () => this.leaveChannel());
        this.muteBtn.addEventListener('click', () => this.toggleMute());

        // Initialize Supabase realtime subscription
        this.initializeRealtime();
    }

    async initializeRealtime() {
        const channel = supabase.channel('webrtc');
        
        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
            this.handleSignaling(payload);
        });

        await channel.subscribe();
    }

    async joinChannel() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Update UI
            this.joinBtn.disabled = true;
            this.leaveBtn.disabled = false;
            this.muteBtn.disabled = false;
            this.statusIndicator.classList.add('connected');
            this.connectionStatus.textContent = 'Connected';
            this.isConnected = true;

            // Get existing users in channel
            const { data: users } = await supabase
                .from('channel_users')
                .select('user_id')
                .eq('channel_id', this.currentChannel);

            // Create peer connections for existing users
            for (const user of users) {
                if (user.user_id !== supabase.auth.user().id) {
                    this.createPeerConnection(user.user_id);
                }
            }

            // Add user to channel_users
            await supabase
                .from('channel_users')
                .insert([
                    {
                        user_id: supabase.auth.user().id,
                        channel_id: this.currentChannel
                    }
                ]);

        } catch (error) {
            console.error('Error joining channel:', error);
            alert('Failed to join channel. Please check your microphone permissions.');
        }
    }

    async leaveChannel() {
        try {
            // Stop all tracks
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }

            // Close all peer connections
            Object.values(this.peerConnections).forEach(pc => pc.close());
            this.peerConnections = {};

            // Remove user from channel_users
            await supabase
                .from('channel_users')
                .delete()
                .match({
                    user_id: supabase.auth.user().id,
                    channel_id: this.currentChannel
                });

            // Update UI
            this.joinBtn.disabled = false;
            this.leaveBtn.disabled = true;
            this.muteBtn.disabled = true;
            this.statusIndicator.classList.remove('connected');
            this.connectionStatus.textContent = 'Disconnected';
            this.isConnected = false;
            this.usersList.innerHTML = '';

        } catch (error) {
            console.error('Error leaving channel:', error);
        }
    }

    toggleMute() {
        if (this.localStream) {
            this.isMuted = !this.isMuted;
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
            this.muteBtn.querySelector('.btn-text').textContent = this.isMuted ? 'Unmute' : 'Mute';
        }
    }

    createPeerConnection(userId) {
        const peerConnection = new RTCPeerConnection(configuration);
        this.peerConnections[userId] = peerConnection;

        // Add local stream
        this.localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, this.localStream);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({
                    type: 'candidate',
                    candidate: event.candidate,
                    to: userId
                });
            }
        };

        // Handle incoming tracks
        peerConnection.ontrack = (event) => {
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

        // Create and send offer
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                this.sendSignal({
                    type: 'offer',
                    sdp: peerConnection.localDescription,
                    to: userId
                });
            });

        return peerConnection;
    }

    async handleSignaling(signal) {
        const { type, from, sdp, candidate } = signal;

        if (type === 'offer') {
            const peerConnection = this.createPeerConnection(from);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            this.sendSignal({
                type: 'answer',
                sdp: answer,
                to: from
            });
        }
        else if (type === 'answer') {
            const peerConnection = this.peerConnections[from];
            if (peerConnection) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
            }
        }
        else if (type === 'candidate') {
            const peerConnection = this.peerConnections[from];
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        }
    }

    sendSignal(signal) {
        supabase.channel('webrtc').send({
            type: 'broadcast',
            event: 'signal',
            payload: {
                ...signal,
                from: supabase.auth.user().id
            }
        });
    }

    setCurrentChannel(channelId) {
        this.currentChannel = channelId;
        this.joinBtn.disabled = false;
    }
}

// Initialize WebRTC handler
const webrtcHandler = new WebRTCHandler();

// Export for use in app.js
window.webrtcHandler = webrtcHandler; 