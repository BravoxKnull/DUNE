// Supabase configuration
const SUPABASE_URL = 'https://jvjlvzidmcwcshbeielf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2amx2emlkbWN3Y3NoYmVpZWxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg2Nzg5ODksImV4cCI6MjA2NDI1NDk4OX0.pTuQXNNsnqLJhFbA6W47wNoTmLZq4Fw53xnUmZdEUUw';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Check if we're on the dashboard page
const isDashboard = window.location.pathname.includes('dashboard.html');

if (isDashboard) {
    // Dashboard functionality
    const username = document.getElementById('username');
    const logoutBtn = document.getElementById('logoutBtn');
    const createChannelBtn = document.getElementById('createChannelBtn');
    const channelsList = document.getElementById('channelsList');
    const createChannelModal = document.getElementById('createChannelModal');
    const createChannelForm = document.getElementById('createChannelForm');
    const cancelBtn = document.querySelector('.cancel-btn');
    const currentChannelName = document.getElementById('currentChannelName');

    // Load user data
    async function loadUserData() {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const { data: profile } = await supabase
                .from('users')
                .select('username')
                .eq('id', user.id)
                .single();
            
            if (profile) {
                username.textContent = profile.username;
            }
        }
    }

    // Load channels
    async function loadChannels() {
        const { data: channels } = await supabase
            .from('channels')
            .select('*')
            .order('created_at', { ascending: false });

        channelsList.innerHTML = '';
        channels.forEach(channel => {
            const channelElement = document.createElement('div');
            channelElement.className = 'channel-item';
            channelElement.textContent = channel.name;
            channelElement.dataset.channelId = channel.id;
            
            channelElement.addEventListener('click', () => {
                // Remove active class from all channels
                document.querySelectorAll('.channel-item').forEach(item => {
                    item.classList.remove('active');
                });
                
                // Add active class to clicked channel
                channelElement.classList.add('active');
                
                // Update current channel
                currentChannelName.textContent = channel.name;
                window.webrtcHandler.setCurrentChannel(channel.id);
            });
            
            channelsList.appendChild(channelElement);
        });
    }

    // Create channel
    async function createChannel(name) {
        const { data: { user } } = await supabase.auth.getUser();
        
        const { data, error } = await supabase
            .from('channels')
            .insert([
                {
                    name,
                    created_by: user.id
                }
            ])
            .select()
            .single();

        if (error) {
            alert('Failed to create channel');
            return;
        }

        // Add channel to list
        const channelElement = document.createElement('div');
        channelElement.className = 'channel-item';
        channelElement.textContent = name;
        channelElement.dataset.channelId = data.id;
        channelsList.insertBefore(channelElement, channelsList.firstChild);

        // Close modal
        createChannelModal.classList.remove('active');
        createChannelForm.reset();
    }

    // Event Listeners
    logoutBtn.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });

    createChannelBtn.addEventListener('click', () => {
        createChannelModal.classList.add('active');
    });

    cancelBtn.addEventListener('click', () => {
        createChannelModal.classList.remove('active');
        createChannelForm.reset();
    });

    createChannelForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const channelName = document.getElementById('channelName').value;
        createChannel(channelName);
    });

    // Initialize dashboard
    loadUserData();
    loadChannels();

    // Subscribe to channel changes
    supabase
        .channel('channels')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => {
            loadChannels();
        })
        .subscribe();

} else {
    // Login/Signup page functionality
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const tabBtns = document.querySelectorAll('.tab-btn');

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons and forms
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
            
            // Add active class to clicked button and corresponding form
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}Form`).classList.add('active');
        });
    });

    // Handle Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });
            
            if (error) throw error;
            
            // Redirect to dashboard on successful login
            window.location.href = 'dashboard.html';
        } catch (error) {
            alert(error.message);
        }
    });

    // Handle Signup
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('signupUsername').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        
        try {
            // Sign up the user
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password
            });
            
            if (authError) throw authError;
            
            // Create user profile in the users table
            const { error: profileError } = await supabase
                .from('users')
                .insert([
                    {
                        id: authData.user.id,
                        username,
                        email
                    }
                ]);
                
            if (profileError) throw profileError;
            
            alert('Signup successful! Please check your email for verification.');
            
            // Switch to login tab
            document.querySelector('[data-tab="login"]').click();
        } catch (error) {
            alert(error.message);
        }
    });

    // Check if user is already logged in
    async function checkAuth() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            window.location.href = 'dashboard.html';
        }
    }

    // Run auth check on page load
    checkAuth();
} 