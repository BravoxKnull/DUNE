// Supabase configuration
const SUPABASE_URL = 'https://jvjlvzidmcwcshbeielf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2amx2emlkbWN3Y3NoYmVpZWxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg2Nzg5ODksImV4cCI6MjA2NDI1NDk4OX0.pTuQXNNsnqLJhFbA6W47wNoTmLZq4Fw53xnUmZdEUUw';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Check if we're on the dashboard page
const isDashboard = window.location.pathname.includes('dashboard.html');

// Initialize WebRTC handler
let webrtcHandler = null;
let currentUser = null;

// Initialize WebRTC when user is authenticated
async function initializeWebRTC() {
    if (!currentUser) {
        console.error('Cannot initialize WebRTC: No current user');
        return;
    }
    
    try {
        console.log('Initializing WebRTC handler...');
        webrtcHandler = new WebRTCHandler(currentUser.id);
        await webrtcHandler.initialize();
        console.log('WebRTC handler initialized successfully');
    } catch (error) {
        console.error('Error initializing WebRTC:', error);
    }
}

// Update channel click handler
async function handleChannelClick(channelId) {
    console.log('Channel clicked:', channelId);
    
    if (!webrtcHandler) {
        console.error('WebRTC handler not initialized');
        alert('Please wait while we initialize the voice chat...');
        return;
    }
    
    const channelElement = document.querySelector(`[data-channel-id="${channelId}"]`);
    if (!channelElement) {
        console.error('Channel element not found');
        return;
    }

    try {
        // Remove active class from all channels
        document.querySelectorAll('.channel-item').forEach(ch => ch.classList.remove('active'));
        // Add active class to clicked channel
        channelElement.classList.add('active');
        
        // Update current channel name
        const currentChannelName = document.getElementById('currentChannelName');
        if (currentChannelName) {
            currentChannelName.textContent = channelElement.textContent;
        }
        
        // Enable/disable buttons
        const joinBtn = document.getElementById('joinChannelBtn');
        const leaveBtn = document.getElementById('leaveChannelBtn');
        const muteBtn = document.getElementById('muteBtn');
        
        if (joinBtn) joinBtn.disabled = false;
        if (leaveBtn) leaveBtn.disabled = false;
        if (muteBtn) muteBtn.disabled = false;
        
        // Join the channel
        console.log('Setting current channel:', channelId);
        await webrtcHandler.setCurrentChannel(channelId);
        
        // Update connection status
        const statusIndicator = document.querySelector('.status-indicator');
        const connectionStatus = document.getElementById('connectionStatus');
        if (statusIndicator) statusIndicator.classList.add('connected');
        if (connectionStatus) connectionStatus.textContent = 'Connected';
        
        // Update users list
        const usersList = document.getElementById('usersList');
        if (usersList) {
            usersList.innerHTML = '<div class="user-card"><div class="user-icon">Y</div><span class="username">You</span></div>';
        }
    } catch (error) {
        console.error('Error handling channel click:', error);
        alert('Error joining channel. Please try again.');
    }
}

// Dashboard functionality
async function initializeDashboard() {
    // Load user data
    async function loadUserData() {
        try {
            console.log('Loading user data...');
            
            if (!currentUser) {
                console.error('No current user found');
                window.location.href = 'index.html';
                return;
            }

            console.log('Current user:', currentUser);
            
            // Get user profile from users table
            const { data: profile, error: profileError } = await supabase
                .from('users')
                .select('username')
                .eq('id', currentUser.id)
                .single();
            
            if (profileError) {
                console.error('Error getting user profile:', profileError);
                throw profileError;
            }

            console.log('User profile:', profile);
            
            const usernameElement = document.getElementById('username');
            if (usernameElement) {
                if (profile && profile.username) {
                    usernameElement.textContent = profile.username;
                } else {
                    usernameElement.textContent = currentUser.email || 'User';
                }
            }
            
            await initializeWebRTC();
            
        } catch (error) {
            console.error('Error in loadUserData:', error);
            alert('Error loading user data. Please try logging in again.');
            window.location.href = 'index.html';
        }
    }

    // Load channels
    async function loadChannels() {
        try {
            const { data: channels, error } = await supabase
                .from('channels')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const channelsList = document.getElementById('channelsList');
            if (!channelsList) return;

            channelsList.innerHTML = '';
            channels.forEach(channel => {
                const channelElement = document.createElement('div');
                channelElement.className = 'channel-item';
                channelElement.textContent = channel.name;
                channelElement.dataset.channelId = channel.id;
                
                channelElement.addEventListener('click', () => {
                    handleChannelClick(channel.id);
                });
                
                channelsList.appendChild(channelElement);
            });
        } catch (error) {
            console.error('Error loading channels:', error);
            alert('Error loading channels. Please refresh the page.');
        }
    }

    // Create channel
    async function createChannel(name) {
        try {
            console.log('Starting channel creation for:', name);
            
            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError) {
                console.error('User error:', userError);
                throw userError;
            }
            
            if (!user) {
                console.error('No user found');
                alert('Please log in to create a channel.');
                return;
            }

            console.log('User authenticated:', user.id);

            // Create the channel
            const { data, error } = await supabase
                .from('channels')
                .insert([
                    {
                        name: name,
                        created_by: user.id,
                        created_at: new Date().toISOString()
                    }
                ])
                .select()
                .single();

            if (error) {
                console.error('Error creating channel:', error);
                throw error;
            }

            console.log('Channel created successfully:', data);

            // Add channel to list
            const channelsList = document.getElementById('channelsList');
            if (channelsList) {
                const channelElement = document.createElement('div');
                channelElement.className = 'channel-item';
                channelElement.textContent = name;
                channelElement.dataset.channelId = data.id;
                
                channelElement.addEventListener('click', () => {
                    handleChannelClick(data.id);
                });
                
                channelsList.insertBefore(channelElement, channelsList.firstChild);
            }

            // Close modal
            const createChannelModal = document.getElementById('createChannelModal');
            const createChannelForm = document.getElementById('createChannelForm');
            if (createChannelModal) {
                createChannelModal.style.display = 'none';
                createChannelModal.classList.remove('active');
            }
            if (createChannelForm) {
                createChannelForm.reset();
            }

            // Reload channels list
            await loadChannels();
            
        } catch (error) {
            console.error('Error in createChannel:', error);
            alert('Failed to create channel: ' + error.message);
        }
    }

    // Set up event listeners
    const logoutBtn = document.getElementById('logoutBtn');
    const createChannelBtn = document.getElementById('createChannelBtn');
    const createChannelModal = document.getElementById('createChannelModal');
    const createChannelForm = document.getElementById('createChannelForm');
    const cancelBtn = document.querySelector('.cancel-btn');
    const joinBtn = document.getElementById('joinChannelBtn');
    const leaveBtn = document.getElementById('leaveChannelBtn');
    const muteBtn = document.getElementById('muteBtn');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.href = 'index.html';
        });
    }

    if (createChannelBtn) {
        createChannelBtn.addEventListener('click', () => {
            console.log('Create channel button clicked');
            if (createChannelModal) {
                createChannelModal.style.display = 'flex';
                createChannelModal.classList.add('active');
            }
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (createChannelModal) {
                createChannelModal.style.display = 'none';
                createChannelModal.classList.remove('active');
            }
            if (createChannelForm) {
                createChannelForm.reset();
            }
        });
    }

    if (createChannelForm) {
        createChannelForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('Create channel form submitted');
            
            const channelNameInput = document.getElementById('channelName');
            if (!channelNameInput) {
                console.error('Channel name input not found');
                return;
            }
            
            const channelName = channelNameInput.value.trim();
            if (!channelName) {
                alert('Please enter a channel name');
                return;
            }
            
            console.log('Attempting to create channel:', channelName);
            await createChannel(channelName);
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            if (webrtcHandler && webrtcHandler.currentChannel) {
                joinBtn.disabled = true;
                if (leaveBtn) leaveBtn.disabled = false;
                if (muteBtn) muteBtn.disabled = false;
            }
        });
    }
    
    if (leaveBtn) {
        leaveBtn.addEventListener('click', async () => {
            if (webrtcHandler) {
                await webrtcHandler.leaveChannel();
                if (joinBtn) joinBtn.disabled = false;
                leaveBtn.disabled = true;
                if (muteBtn) muteBtn.disabled = true;
                const currentChannelName = document.getElementById('currentChannelName');
                if (currentChannelName) {
                    currentChannelName.textContent = 'No Channel Selected';
                }
            }
        });
    }
    
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            if (webrtcHandler && webrtcHandler.localStream) {
                const audioTrack = webrtcHandler.localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    const btnText = muteBtn.querySelector('.btn-text');
                    if (btnText) {
                        btnText.textContent = audioTrack.enabled ? 'Mute' : 'Unmute';
                    }
                }
            }
        });
    }

    // Initialize dashboard
    await loadUserData();
    await loadChannels();

    // Subscribe to channel changes
    supabase
        .channel('channels')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => {
            loadChannels();
        })
        .subscribe();

    return { loadChannels };
}

// Check if user is already logged in
async function checkAuth() {
    try {
        console.log('Checking authentication status...');
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error('Error checking session:', error);
            throw error;
        }

        if (session) {
            console.log('User is authenticated:', session.user);
            currentUser = session.user;
            
            if (isDashboard) {
                const authContainer = document.getElementById('auth-container');
                const dashboardContainer = document.getElementById('dashboard-container');
                
                if (authContainer) authContainer.style.display = 'none';
                if (dashboardContainer) dashboardContainer.style.display = 'block';
                
                // Initialize dashboard without reloading user data
                const dashboard = await initializeDashboard();
                window.loadChannels = dashboard.loadChannels;
            } else {
                window.location.href = 'dashboard.html';
            }
        } else if (isDashboard) {
            console.log('No active session, redirecting to login...');
            window.location.href = 'index.html';
        }
    } catch (error) {
        console.error('Error in checkAuth:', error);
        if (isDashboard) {
            window.location.href = 'index.html';
        }
    }
}

// Run auth check on page load
checkAuth();

// Login/Signup page functionality
if (!isDashboard) {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const tabBtns = document.querySelectorAll('.tab-btn');

    // Tab switching
    if (tabBtns) {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active class from all buttons and forms
                tabBtns.forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
                
                // Add active class to clicked button and corresponding form
                btn.classList.add('active');
                const form = document.getElementById(`${btn.dataset.tab}Form`);
                if (form) {
                    form.classList.add('active');
                }
            });
        });
    }

    // Handle Login
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const emailInput = document.getElementById('loginEmail');
            const passwordInput = document.getElementById('loginPassword');
            
            if (!emailInput || !passwordInput) return;
            
            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: emailInput.value,
                    password: passwordInput.value
                });
                
                if (error) throw error;
                
                // Redirect to dashboard on successful login
                window.location.href = 'dashboard.html';
            } catch (error) {
                alert(error.message);
            }
        });
    }

    // Handle Signup
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const usernameInput = document.getElementById('signupUsername');
            const emailInput = document.getElementById('signupEmail');
            const passwordInput = document.getElementById('signupPassword');
            
            if (!usernameInput || !emailInput || !passwordInput) return;
            
            try {
                // Sign up the user
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: emailInput.value,
                    password: passwordInput.value
                });
                
                if (authError) throw authError;
                
                // Create user profile in the users table
                const { error: profileError } = await supabase
                    .from('users')
                    .insert([
                        {
                            id: authData.user.id,
                            username: usernameInput.value,
                            email: emailInput.value
                        }
                    ]);
                    
                if (profileError) throw profileError;
                
                alert('Signup successful! Please check your email for verification.');
                
                // Switch to login tab
                const loginTab = document.querySelector('[data-tab="login"]');
                if (loginTab) {
                    loginTab.click();
                }
            } catch (error) {
                alert(error.message);
            }
        });
    }
} 