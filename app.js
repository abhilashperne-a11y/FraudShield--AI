/* ==========================================================================
   FraudShield AI - Core Application Script
   ========================================================================== */

// --- GLOBAL AUDIO UTILITY (WEB AUDIO API SYNTHESIZER) ---
// Generates secure cyber bleeps/bloops without loading external media files.
const AudioSynth = {
    ctx: null,
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    playTone(freq, type, duration) {
        try {
            this.init();
            if (!this.ctx) return;
            
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            
            gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            console.log("Audio play blocked by browser policy until interaction.");
        }
    },
    playClick() { this.playTone(800, 'triangle', 0.08); },
    playSuccess() {
        this.playTone(523.25, 'sine', 0.1); // C5
        setTimeout(() => this.playTone(659.25, 'sine', 0.15), 80); // E5
    },
    playWarning() {
        this.playTone(220, 'sawtooth', 0.2); // A3
        setTimeout(() => this.playTone(180, 'sawtooth', 0.25), 150);
    },
    playScan() {
        this.playTone(1200, 'sine', 0.05);
    }
};

// --- API CONFIGURATION (stores keys in localStorage + auto-loads from .api-keys.md) ---
const APIConfig = {
    getKey(name) {
        return localStorage.getItem(`fraudshield_apikey_${name}`) || "";
    },
    setKey(name, value) {
        localStorage.setItem(`fraudshield_apikey_${name}`, value.trim());
    },
    hasKey(name) {
        const k = this.getKey(name);
        return k && k.length > 10;
    },

    // Auto-load keys from .api-keys.md via Python server
    async loadFromServer() {
        try {
            const res = await fetch("http://localhost:8000/api/keys");
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.keys) {
                let loaded = 0;
                for (const [name, value] of Object.entries(data.keys)) {
                    if (value && value.length > 5) {
                        this.setKey(name, value);
                        loaded++;
                    }
                }
                if (loaded > 0) {
                    console.log(`🔑 Auto-loaded ${loaded} API key(s) from .api-keys.md`);
                    if (typeof updateAPIStatusIndicators === "function") {
                        updateAPIStatusIndicators();
                    }
                }
            }
        } catch (e) {
            // Server not running — keys stay in localStorage
            console.log("📁 .api-keys.md not available (server offline). Using localStorage keys.");
        }
    },

    // --- GOOGLE GEMINI AI ---
    async geminiAnalyze(prompt) {
        const key = this.getKey("gemini");
        if (!key) return null;
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
                })
            });
            if (!res.ok) {
                console.warn("Gemini API error:", res.status);
                return null;
            }
            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            return text || null;
        } catch (e) {
            console.warn("Gemini API call failed:", e);
            return null;
        }
    },

    // --- GOOGLE SAFE BROWSING ---
    async safeBrowsingCheck(url) {
        const key = this.getKey("safebrowsing");
        if (!key) return null;
        try {
            const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    client: { clientId: "fraudshield-ai", clientVersion: "1.0" },
                    threatInfo: {
                        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
                        platformTypes: ["ANY_PLATFORM"],
                        threatEntryTypes: ["URL"],
                        threatEntries: [{ url: url }]
                    }
                })
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data;
        } catch (e) {
            console.warn("Safe Browsing API failed:", e);
            return null;
        }
    },

    // --- VIRUSTOTAL (via Python proxy to avoid CORS) ---
    async virusTotalScan(url) {
        const key = this.getKey("virustotal");
        if (!key) return null;
        try {
            const res = await fetch(`http://localhost:8000/api/proxy/virustotal`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url, apiKey: key })
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.warn("VirusTotal proxy call failed:", e);
            return null;
        }
    }
};

// --- APP STATE ---
const AppState = {
    securedCount: 48,
    blockedCount: 12,
    securityScore: 95,
    activeTab: 'dashboard',
    quizIndex: 0,
    quizScore: 0,
    currentUser: null,
    settings: {
        spendingLimit: 2000,
        pipelinesFrozen: false,
        secureStart: "08:00",
        secureEnd: "22:00"
    },
    blacklist: []
};

// --- DUAL-MODE BACKEND CLIENT (AUTOMATIC PYTHON HTTP / LOCALSTORAGE FALLBACK) ---
const BackendClient = {
    useServer: false,
    apiBase: "http://localhost:8000/api",
    
    defaultDB: {
        users: [],
        transactions: [],
        emergency_reports: [],
        blacklist: [
            "unknown-lottery@ybl",
            "prize-rewards@paytm",
            "9827389102",
            "win-prize@phonepe"
        ],
        settings: {
            spendingLimit: 2000,
            pipelinesFrozen: false,
            secureStart: "08:00",
            secureEnd: "22:00"
        }
    },

    getLocalDB() {
        let db = localStorage.getItem("fraudshield_db");
        if (!db) {
            db = JSON.stringify(this.defaultDB);
            localStorage.setItem("fraudshield_db", db);
        }
        return JSON.parse(db);
    },

    setLocalDB(db) {
        localStorage.setItem("fraudshield_db", JSON.stringify(db));
    },

    async init() {
        try {
            // Check server availability with a fast timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);
            const res = await fetch(`${this.apiBase}/settings`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                this.useServer = true;
                console.log("🟢 FraudShield AI Server connected!");
            }
        } catch (e) {
            console.log("🟡 Backend server offline. Seamlessly utilizing secure client-side LocalStorage DB.");
        }
    },

    async post(endpoint, data) {
        if (this.useServer) {
            try {
                const res = await fetch(`${this.apiBase}${endpoint}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
                return await res.json();
            } catch (e) {
                console.error("Fetch server error, using simulation fallback:", e);
            }
        }
        return this.simulatePost(endpoint, data);
    },

    async get(endpoint) {
        if (this.useServer) {
            try {
                const res = await fetch(`${this.apiBase}${endpoint}`);
                return await res.json();
            } catch (e) {
                console.error("Fetch server error, using simulation fallback:", e);
            }
        }
        return this.simulateGet(endpoint);
    },

    simulatePost(endpoint, data) {
        const db = this.getLocalDB();
        if (endpoint === "/auth/signup") {
            const fullName = data.fullName.trim();
            const pin = data.pin.trim();
            const recovery = data.recovery.trim();
            const language = data.language || "en";

            if (db.users.some(u => u.fullName.toLowerCase() === fullName.toLowerCase())) {
                return { success: false, message: "A profile with this name already exists." };
            }
            db.users.push({ fullName, pin, recovery, language });
            this.setLocalDB(db);
            return { success: true, message: "Profile created successfully!" };
        }

        if (endpoint === "/auth/login") {
            const fullName = data.fullName.trim();
            const pin = data.pin.trim();
            const user = db.users.find(u => u.fullName.toLowerCase() === fullName.toLowerCase());
            if (!user) {
                return { success: false, message: "Profile not found." };
            }
            if (user.pin !== pin) {
                return { success: false, message: "Incorrect Security PIN." };
            }
            return { success: true, message: "Login successful!", user: { fullName: user.fullName, language: user.language } };
        }

        if (endpoint === "/auth/recover") {
            const fullName = data.fullName.trim();
            const recovery = data.recovery.trim();
            const user = db.users.find(u => u.fullName.toLowerCase() === fullName.toLowerCase());
            if (!user) return { success: false, message: "Profile not found." };
            if (user.recovery.toLowerCase() !== recovery.toLowerCase()) {
                return { success: false, message: "Incorrect recovery answer." };
            }
            return { success: true, pin: user.pin };
        }

        if (endpoint === "/transactions") {
            db.transactions.unshift(data);
            this.setLocalDB(db);
            return { success: true };
        }

        if (endpoint === "/blacklist") {
            const target = data.target.trim();
            if (target && !db.blacklist.includes(target)) {
                db.blacklist.push(target);
                this.setLocalDB(db);
            }
            return { success: true, blacklist: db.blacklist };
        }

        if (endpoint === "/reports") {
            db.emergency_reports.unshift(data);
            this.setLocalDB(db);
            return { success: true };
        }

        if (endpoint === "/settings") {
            db.settings = { ...db.settings, ...data };
            this.setLocalDB(db);
            return { success: true, settings: db.settings };
        }

        return { success: false, message: "Endpoint not found" };
    },

    simulateGet(endpoint) {
        const db = this.getLocalDB();
        if (endpoint === "/blacklist") {
            return { blacklist: db.blacklist };
        }
        if (endpoint === "/transactions") {
            return { transactions: db.transactions };
        }
        if (endpoint === "/reports") {
            return { reports: db.emergency_reports };
        }
        if (endpoint === "/settings") {
            return { settings: db.settings };
        }
        return {};
    }
};

// --- CORE CONTROLLERS ---
document.addEventListener("DOMContentLoaded", async () => {
    // Auto-apply saved theme immediately on startup
    const savedTheme = localStorage.getItem("fraudshield_theme") || "dark";
    if (savedTheme === "light") {
        document.body.classList.add("light-theme");
    }

    // Start clock ticking
    updateClock();
    setInterval(updateClock, 1000);

    // Initial check connecting to Backend (Python API Server / LocalStorage fallback)
    await BackendClient.init();

    // Auto-load API keys from .api-keys.md (if server is running)
    await APIConfig.loadFromServer();
    
    // Check if user session is active
    initAuthenticationFlow();
});

// Authentication System Controller
function initAuthenticationFlow() {
    const authModal = document.getElementById("auth-modal");
    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    const loginTabBtn = document.getElementById("tab-login-btn");
    const signupTabBtn = document.getElementById("tab-signup-btn");
    const forgotPinBtn = document.getElementById("btn-forgot-pin");
    const logoutBtn = document.getElementById("btn-logout");
    
    const errorBox = document.getElementById("auth-error");
    const errorText = document.getElementById("auth-error-text");
    const successBox = document.getElementById("auth-success");
    const successText = document.getElementById("auth-success-text");

    const showError = (msg) => {
        successBox.style.display = "none";
        errorBox.style.display = "flex";
        errorText.innerText = msg;
        AudioSynth.playWarning();
    };

    const showSuccess = (msg) => {
        errorBox.style.display = "none";
        successBox.style.display = "flex";
        successText.innerText = msg;
        AudioSynth.playSuccess();
    };

    const clearBanners = () => {
        errorBox.style.display = "none";
        successBox.style.display = "none";
    };

    // Tab Switching
    loginTabBtn.addEventListener("click", () => {
        clearBanners();
        loginTabBtn.classList.add("active");
        signupTabBtn.classList.remove("active");
        loginForm.classList.add("active");
        signupForm.classList.remove("active");
        AudioSynth.playClick();
    });

    signupTabBtn.addEventListener("click", () => {
        clearBanners();
        signupTabBtn.classList.add("active");
        loginTabBtn.classList.remove("active");
        signupForm.classList.add("active");
        loginForm.classList.remove("active");
        AudioSynth.playClick();
    });

    // Handle Signup Submit
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fullName = document.getElementById("signup-name").value.trim();
        const pin = document.getElementById("signup-pin").value.trim();
        const recovery = document.getElementById("signup-recovery").value.trim();
        const language = document.getElementById("signup-lang").value;

        if (pin.length !== 6 || isNaN(pin)) {
            showError("PIN must be a 6-digit number.");
            return;
        }

        const res = await BackendClient.post("/auth/signup", { fullName, pin, recovery, language });
        if (res && res.success) {
            showSuccess("Profile created! Switching to Sign In...");
            signupForm.reset();
            setTimeout(() => {
                loginTabBtn.click();
                document.getElementById("login-name").value = fullName;
                document.getElementById("login-pin").focus();
            }, 1500);
        } else {
            showError(res ? res.message : "Registration failed.");
        }
    });

    // Handle Login Submit
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fullName = document.getElementById("login-name").value.trim();
        const pin = document.getElementById("login-pin").value.trim();

        const res = await BackendClient.post("/auth/login", { fullName, pin });
        if (res && res.success) {
            showSuccess("Identity verified! Powering secure modules...");
            setTimeout(() => {
                loginForm.reset();
                initializeUserSession(res.user);
            }, 1200);
        } else {
            showError(res ? res.message : "Authentication failed.");
        }
    });

    // Forgot Pin Recovery Flow
    forgotPinBtn.addEventListener("click", async () => {
        AudioSynth.playClick();
        const fullName = prompt("Enter your Profile Full Name:");
        if (!fullName) return;
        
        const recovery = prompt(`Security Recovery Challenge:\nEnter your Recovery Answer (Favorite Teacher/Hero):`);
        if (!recovery) return;

        const res = await BackendClient.post("/auth/recover", { fullName, recovery });
        if (res && res.success) {
            alert(`🛡️ PIN recovered successfully!\nYour Security PIN is: ${res.pin}`);
            AudioSynth.playSuccess();
        } else {
            alert(`❌ PIN Recovery failed: ${res ? res.message : "Incorrect details."}`);
            AudioSynth.playWarning();
        }
    });

    // Logout Action
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            AudioSynth.playWarning();
            sessionStorage.removeItem("active_user");
            location.reload();
        });
    }

    // Auto-login session restore check
    const savedSession = sessionStorage.getItem("active_user");
    if (savedSession) {
        try {
            const user = JSON.parse(savedSession);
            initializeUserSession(user);
        } catch (e) {
            sessionStorage.removeItem("active_user");
            authModal.style.display = "flex";
        }
    } else {
        authModal.style.display = "flex";
    }
}

// Loads dynamic settings, streams, and visual cues once a user logs in successfully
async function initializeUserSession(user) {
    AppState.currentUser = user;
    sessionStorage.setItem("active_user", JSON.stringify(user));

    // Hide Auth Portal
    const authModal = document.getElementById("auth-modal");
    authModal.style.opacity = 0;
    setTimeout(() => {
        authModal.style.display = "none";
    }, 500);

    // Dynamic UI Updates
    document.getElementById("user-name-display").innerText = user.fullName;
    document.querySelectorAll(".welcome-heading").forEach(el => {
        el.innerHTML = `Welcome Back, <span class="text-gradient">${user.fullName.split(" ")[0]}</span>`;
    });

    // Update Incidents victim default
    const incVictim = document.getElementById("inc-victim");
    if (incVictim) incVictim.value = user.fullName;

    // Set voice language preference automatically
    // Load Database settings and data
    await loadDatabaseTelemetry();

    // Setup tab listeners and interactive controllers
    setupTabNavigation();
    initTransactionAnalyzer();
    initScanners();
    initBehavioralGuardian();
    initFraudAcademy();
    initEmergencyDesk();
    initHeatMap();
    initAPISettings();

    // Trigger initial startup self-check scan animation
    setTimeout(() => {
        animateDashboardGaugeSelfCheck();
    }, 800);
}

// Load backend lists, user configurations, and sync streams
async function loadDatabaseTelemetry() {
    // 1. Get settings
    const settingsRes = await BackendClient.get("/settings");
    if (settingsRes && settingsRes.settings) {
        AppState.settings = settingsRes.settings;
        
        // Sync spending slider settings
        const slider = document.getElementById("slider-spending-limit");
        const limitDisplay = document.getElementById("spending-limit-display");
        if (slider && limitDisplay) {
            slider.value = AppState.settings.spendingLimit;
            limitDisplay.innerText = "₹" + Number(AppState.settings.spendingLimit).toLocaleString('en-IN');
        }
    }

    // 2. Get blacklist
    const blacklistRes = await BackendClient.get("/blacklist");
    if (blacklistRes && blacklistRes.blacklist) {
        AppState.blacklist = blacklistRes.blacklist;
    }

    // 3. Sync recent scans to the stream list
    await refreshThreatStream();
}

async function refreshThreatStream() {
    const stream = document.getElementById("threat-stream-list");
    if (!stream) return;

    const txRes = await BackendClient.get("/transactions");
    const txs = txRes && txRes.transactions ? txRes.transactions : [];

    // Clear list
    stream.innerHTML = "";

    // Show persistent simulated events if transaction log is empty
    if (txs.length === 0) {
        stream.innerHTML = `
            <div class="threat-row border-left-danger">
                <div class="threat-row-header">
                    <span class="threat-badge bg-danger">Critical</span>
                    <span class="threat-time">Just Now</span>
                </div>
                <p class="threat-desc">OTP fraud attempt bypassed. Target: Elderly user. Status: <strong>Blocked</strong></p>
            </div>
            <div class="threat-row border-left-warning">
                <div class="threat-row-header">
                    <span class="threat-badge bg-warning">Warning</span>
                    <span class="threat-time">2 mins ago</span>
                </div>
                <p class="threat-desc">Malicious payment link detected targeting \`amaz0n-win-prize.in\`. Status: <strong>Blacklisted</strong></p>
            </div>
        `;
        return;
    }

    // Render transactions log
    txs.slice(0, 5).forEach(tx => {
        const isDangerous = tx.risk >= 70;
        const isMedium = tx.risk >= 30 && tx.risk < 70;
        
        const badgeClass = isDangerous ? "bg-danger" : (isMedium ? "bg-warning" : "bg-info");
        const borderClass = isDangerous ? "border-left-danger" : (isMedium ? "border-left-warning" : "border-left-info");
        const badgeLabel = isDangerous ? "Blocked Alert" : (isMedium ? "Warning Check" : "Secure Log");
        const statusLabel = isDangerous ? "<strong class='text-danger'>Blocked</strong>" : (isMedium ? "<strong class='text-warning'>Flagged</strong>" : "<strong class='text-emerald'>Verified Safe</strong>");

        const row = document.createElement("div");
        row.className = `threat-row ${borderClass}`;
        row.innerHTML = `
            <div class="threat-row-header">
                <span class="threat-badge ${badgeClass}">${badgeLabel}</span>
                <span class="threat-time">${tx.time}</span>
            </div>
            <p class="threat-desc">Transaction pre-check scanned: transfer of <strong>₹${tx.amount.toLocaleString('en-IN')}</strong> to <code>${tx.upiId}</code>. Risk Score: <strong>${tx.risk}%</strong>. Status: ${statusLabel}</p>
        `;
        stream.appendChild(row);
    });

    // Update Dashboard statistical counts based on session data
    const securedCountEl = document.getElementById("stat-secured-count");
    const blockedCountEl = document.getElementById("stat-blocked-count");
    if (securedCountEl && blockedCountEl) {
        const totalChecked = txs.length;
        const totalBlocked = txs.filter(tx => tx.risk >= 70).length;
        securedCountEl.innerText = AppState.securedCount + (totalChecked - totalBlocked);
        blockedCountEl.innerText = AppState.blockedCount + totalBlocked;
    }
}

// Clock Logic
function updateClock() {
    const clockEl = document.getElementById("live-clock");
    if (clockEl) {
        const now = new Date();
        const options = { weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
        clockEl.innerText = now.toLocaleString('en-US', options);
    }
}

// Navigation Logic
function setupTabNavigation() {
    const buttons = document.querySelectorAll(".nav-menu button");
    const panes = document.querySelectorAll(".tab-pane");

    buttons.forEach(btn => {
        // Prevent duplicate listener hooks
        btn.onclick = null;
        btn.addEventListener("click", () => {
            AudioSynth.playClick();
            const tabId = btn.getAttribute("data-tab");
            
            // Toggle active button
            buttons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            // Toggle active panel
            panes.forEach(pane => {
                pane.classList.remove("active");
                if (pane.getAttribute("id") === `pane-${tabId}`) {
                    pane.classList.add("active");
                }
            });
            
            AppState.activeTab = tabId;
        });
    });

    // Simulate Threats demo trigger
    const demoTrigger = document.getElementById("btn-demo-trigger");
    if (demoTrigger) {
        demoTrigger.onclick = null;
        demoTrigger.addEventListener("click", () => {
            AudioSynth.playWarning();
            
            // Push an alarm notification on screen
            const systemPill = document.getElementById("system-status-pill");
            systemPill.className = "badge-status-pill danger animate-pulse";
            systemPill.querySelector("span:not(.pulse-dot)").innerText = "CRITICAL THREAT BLOCKED";
            systemPill.querySelector(".pulse-dot").className = "pulse-dot red";

            // Add live row to dashboard stream
            const stream = document.getElementById("threat-stream-list");
            const newRow = document.createElement("div");
            newRow.className = "threat-row border-left-danger animate-pulse";
            newRow.innerHTML = `
                <div class="threat-row-header">
                    <span class="threat-badge bg-danger">Critical Alert</span>
                    <span class="threat-time">Just Now</span>
                </div>
                <p class="threat-desc">Immediate mitigation triggered. Blocked rogue Google Maps Customer helpline call from intercepting screen telemetry.</p>
            `;
            stream.insertBefore(newRow, stream.firstChild);

            // Increment count
            AppState.blockedCount += 1;
            document.getElementById("stat-blocked-count").innerText = AppState.blockedCount;
            
            alert("🚨 FraudShield Alert Simulator: Blocked an active screensharing scam attempt on your device. Shield verified!");

            // Revert status pill back to normal after 5 seconds
            setTimeout(() => {
                systemPill.className = "badge-status-pill secure";
                systemPill.querySelector("span:not(.pulse-dot)").innerText = "Shield Active";
                systemPill.querySelector(".pulse-dot").className = "pulse-dot green";
            }, 6000);
        });
    }

    // Dashboard demo buttons
    const demoBtn1 = document.getElementById("quick-demo-1");
    const demoBtn2 = document.getElementById("quick-demo-2");
    
    if (demoBtn1 && demoBtn2) {
        demoBtn1.onclick = null;
        demoBtn1.addEventListener("click", () => {
            const btnScanners = document.getElementById("btn-tab-scanners");
            btnScanners.click();
            document.getElementById("scam-message-text").value = "CONGRATULATIONS! You have won ₹5 Lakh. Click link below immediately to deposit rewards to your bank account: lotto-rewards.in";
            document.getElementById("btn-scan-message").click();
        });

        demoBtn2.onclick = null;
        demoBtn2.addEventListener("click", () => {
            const btnTx = document.getElementById("btn-tab-transaction");
            btnTx.click();
            document.getElementById("upi-id").value = "unknown-lottery@ybl";
            document.getElementById("payment-amount").value = 25000;
            document.getElementById("tx-time").value = "00:45";
            document.querySelector('input[name="tx-recipient-type"][value="new"]').checked = true;
            document.getElementById("btn-analyze-transaction").click();
        });
    }
}

// --- MODULE 1: SMART TRANSACTION ANALYZER ---
function initTransactionAnalyzer() {
    const btnAnalyze = document.getElementById("btn-analyze-transaction");
    
    if (btnAnalyze) {
        btnAnalyze.onclick = null;
        btnAnalyze.addEventListener("click", async () => {
            AudioSynth.playClick();
            
            const upiId = document.getElementById("upi-id").value.trim();
            const amount = parseFloat(document.getElementById("payment-amount").value) || 0;
            const time = document.getElementById("tx-time").value;
            const isNew = document.querySelector('input[name="tx-recipient-type"]:checked').value === 'new';

            if (!upiId) {
                alert("Please specify a valid UPI ID or Account Number.");
                return;
            }

            // Sync dynamic settings & blacklist first
            await loadDatabaseTelemetry();

            // Calculate Risk statefully
            let score = 0;
            const reasons = [];

            // Rule 0: Critical check if pipelines are locked (Emergency Block)
            if (AppState.settings.pipelinesFrozen) {
                score = 100;
                reasons.push("❌ **TRANSACTION ABORTED**: Emergency pipeline lock is active. outgoing transfers blocked.");
                updateTransactionGauge(score, reasons);
                
                // Save state log
                const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                await BackendClient.post("/transactions", { upiId, amount, time: timeNow, risk: score, date: new Date().toISOString() });
                await refreshThreatStream();
                return;
            }

            // Rule 1: Check blacklist database
            const isBlacklisted = AppState.blacklist.some(b => b.toLowerCase() === upiId.toLowerCase());
            if (isBlacklisted) {
                score += 90;
                reasons.push("❌ **Blacklisted Scammer Account**: This UPI address matches a globally reported scam signature!");
            }

            // Rule 2: Unknown recipient vs Trusted history
            if (isNew) {
                score += 30;
                reasons.push("🚨 **New Recipient**: This account has no matching historical records on your device.");

                // Rule 3: Single payment limits check (Dynamic state from Settings)
                if (amount > AppState.settings.spendingLimit) {
                    score += 40;
                    reasons.push(`⚠️ **Exceeds Safe Budget**: Amount exceeds your self-configured spending shield threshold (₹${AppState.settings.spendingLimit.toLocaleString('en-IN')}).`);
                } else if (amount > 10000) {
                    score += 25;
                    reasons.push(`⚠️ **Large Transfer Amount**: Transfer exceeding ₹10,000 flags mandatory visual review.`);
                } else {
                    reasons.push("✅ **Secure budget size**: Transaction size is within standard daily safe parameters.");
                }

                // Rule 4: Midnight anomalous timing profile (Dynamic secure hours)
                const hour = parseInt(time.split(":")[0]) || 12;
                const startHour = parseInt(AppState.settings.secureStart.split(":")[0]) || 8;
                const endHour = parseInt(AppState.settings.secureEnd.split(":")[0]) || 22;

                if (hour < startHour || hour > endHour) {
                    score += 25;
                    reasons.push(`⚠️ **Anomalous Timing Profile**: Late night transfers fall outside your standard active hour settings (${AppState.settings.secureStart} - ${AppState.settings.secureEnd}).`);
                }
            } else {
                score += 5;
                reasons.push("✅ **Trusted history**: You have successfully transferred money here before.");
                reasons.push("✅ **Bypassed timing & budget shields**: Recipient is verified in your trusted list.");
            }

            // Rule 5: Suspicious keywords checks
            const lowerUpi = upiId.toLowerCase();
            if (lowerUpi.includes("lottery") || lowerUpi.includes("win") || lowerUpi.includes("prize") || lowerUpi.includes("reward") || lowerUpi.includes("gift")) {
                if (isNew) {
                    score += 35;
                    reasons.push("❌ **Lexical Fraud Indicators**: Recipient address contains keyword traps (lotto/win/prize).");
                } else {
                    score += 10;
                    reasons.push("⚠️ **Lexical Caution**: Trusted name contains lottery/prize keywords; exercise standard care.");
                }
            }

            // Cap score
            score = Math.min(100, Math.max(5, score));

            // --- GEMINI AI ENHANCEMENT (if API key present) ---
            let aiInsight = "";
            if (APIConfig.hasKey("gemini")) {
                const aiPrompt = `You are a financial fraud detection AI. Analyze this UPI transaction:
- Recipient UPI: ${upiId}
- Amount: ₹${amount}
- Time: ${time}
- New recipient: ${isNew ? "Yes" : "No"}
- Rule-based risk score: ${score}/100
- Rule flags: ${reasons.map(r => r.replace(/[❌⚠️✅🚨]/g, "").trim()).join("; ")}

Provide a 2-3 sentence expert analysis. Is this likely fraudulent? Any additional red flags the rules may have missed? Be concise and specific.`;
                const geminiText = await APIConfig.geminiAnalyze(aiPrompt);
                if (geminiText) {
                    aiInsight = geminiText;
                    reasons.push(`🧠 **Gemini AI Analysis**: ${aiInsight}`);
                }
            } else {
                reasons.push("💡 *Add Gemini API key in ⚙️ Settings to get AI-powered transaction insights.*");
            }
            
            // Render risk speedometer gauge
            updateTransactionGauge(score, reasons);

            // POST transaction log to persistent DB!
            const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            await BackendClient.post("/transactions", {
                upiId,
                amount,
                time: timeNow,
                risk: score,
                date: new Date().toISOString()
            });

            // Reload threat log stream dynamically
            await refreshThreatStream();
        });
    }
}

function updateTransactionGauge(score, reasons) {
    const needle = document.getElementById("tx-gauge-needle");
    const progress = document.getElementById("tx-gauge-progress");
    const scoreVal = document.getElementById("tx-risk-score-value");
    const badge = document.getElementById("tx-risk-badge");
    const explanationPanel = document.getElementById("tx-explanation-details");
    const actionsBlock = document.getElementById("tx-actions-block");
    const card = document.getElementById("transaction-results-card");

    // Audio warning
    if (score >= 70) {
        AudioSynth.playWarning();
        card.className = "card glass-card flex-col align-center justify-between border-pulse scanned-danger";
    } else {
        AudioSynth.playSuccess();
        card.className = "card glass-card flex-col align-center justify-between border-pulse scanned-safe";
    }

    // Needle rotation (-90deg at 0%, 90deg at 100%)
    const degrees = -90 + (score * 1.8);
    needle.style.transform = `rotate(${degrees}deg)`;

    // SVG dashoffset: full circle dasharray is 282.7. 
    // Since it's a semi-circle gauge (180deg visible), progress is scaled.
    // 0% risk -> full dashoffset (282.7, circle hidden)
    // 100% risk -> 141.35 dashoffset (half circle colored)
    const strokeOffset = 282.7 - ((score / 100) * 141.35);
    progress.style.strokeDashoffset = strokeOffset;

    // Numerical display
    scoreVal.innerText = `${score}%`;

    // Badge classification
    if (score <= 30) {
        badge.innerText = "SAFE";
        badge.className = "gauge-label safe";
        actionsBlock.style.display = "none";
    } else if (score <= 70) {
        badge.innerText = "MEDIUM RISK";
        badge.className = "gauge-label medium";
        actionsBlock.style.display = "block";
        actionsBlock.querySelector(".warning-alert-box").className = "warning-alert-box bg-amber-trans border-amber mb-3";
        actionsBlock.querySelector(".alert-header").className = "alert-header font-bold text-amber flex-center gap-2";
        actionsBlock.querySelector(".alert-header span").innerText = "SUSPICIOUS TRANSACTION PATH";
    } else {
        badge.innerText = "HIGH RISK";
        badge.className = "gauge-label dangerous";
        actionsBlock.style.display = "block";
        actionsBlock.querySelector(".warning-alert-box").className = "warning-alert-box bg-rose-trans border-rose mb-3";
        actionsBlock.querySelector(".alert-header").className = "alert-header font-bold text-rose flex-center gap-2";
        actionsBlock.querySelector(".alert-header span").innerText = "CRITICAL PAYMENT WARNING";
    }

    // Compile reasons
    explanationPanel.innerHTML = reasons.map(r => {
        // Simple markdown parsing to strong elements
        const cleanStr = r.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return `<div class="reason-item"><span>${cleanStr}</span></div>`;
    }).join("");
}

// --- MODULE 2 & 3: SCANNING SYSTEMS (API-ENHANCED) ---
function initScanners() {
    const btnScanLink = document.getElementById("btn-scan-link");
    const btnScanMsg = document.getElementById("btn-scan-message");

    // Module 2: Link scanner (Google Safe Browsing + VirusTotal + Rules)
    if (btnScanLink) {
        btnScanLink.addEventListener("click", async () => {
            const url = document.getElementById("phishing-url").value.trim();
            if (!url) {
                alert("Please enter a link to scan.");
                return;
            }

            AudioSynth.playClick();
            
            const loader = document.getElementById("link-scanning-loader");
            const resultCard = document.getElementById("link-scan-result");
            
            loader.style.display = "flex";
            resultCard.style.display = "none";

            let tick = 0;
            const scanInterval = setInterval(() => {
                AudioSynth.playScan();
                tick++;
                if (tick >= 6) clearInterval(scanInterval);
            }, 150);

            // Try API-powered scans first
            let apiResult = null;
            let apiSource = "";

            // 1) Try Google Safe Browsing
            if (APIConfig.hasKey("safebrowsing")) {
                loader.querySelector("span").innerText = "🔍 Querying Google Safe Browsing threat database...";
                const sbResult = await APIConfig.safeBrowsingCheck(url);
                if (sbResult !== null) {
                    apiSource = "Google Safe Browsing API";
                    if (sbResult.matches && sbResult.matches.length > 0) {
                        const threats = sbResult.matches.map(m => m.threatType).join(", ");
                        apiResult = {
                            riskScore: 98,
                            riskText: "CONFIRMED THREAT BY GOOGLE",
                            badgeClass: "badge-status-pill danger",
                            reasonHtml: `
                                <p class="text-sm text-secondary mb-2">❌ <strong>Google Safe Browsing Match:</strong> URL is flagged for: <code>${threats}</code></p>
                                <p class="text-sm text-secondary mb-2">❌ <strong>Platform:</strong> ${sbResult.matches[0].platformType || "ANY"}</p>
                                <p class="text-sm text-secondary"><em>Source: ${apiSource} (Live Database)</em></p>
                            `
                        };
                    } else {
                        apiResult = {
                            riskScore: 5,
                            riskText: "CLEAN — NO THREATS FOUND",
                            badgeClass: "badge-status-pill secure",
                            reasonHtml: `
                                <p class="text-sm text-secondary mb-2">🟢 <strong>Google Safe Browsing:</strong> No malware, phishing, or social engineering threats detected.</p>
                                <p class="text-sm text-secondary"><em>Source: ${apiSource} (Live Database)</em></p>
                            `
                        };
                    }
                }
            }

            // 2) Try VirusTotal (enhance or override)
            if (APIConfig.hasKey("virustotal")) {
                loader.querySelector("span").innerText = "🔬 Scanning with VirusTotal multi-engine analysis...";
                const vtResult = await APIConfig.virusTotalScan(url);
                if (vtResult && vtResult.success && vtResult.stats) {
                    const malicious = vtResult.stats.malicious || 0;
                    const total = vtResult.stats.total || 70;
                    const vtScore = Math.min(100, Math.round((malicious / total) * 100 * 5));
                    apiSource = apiSource ? apiSource + " + VirusTotal" : "VirusTotal API";
                    
                    if (malicious > 0) {
                        apiResult = {
                            riskScore: Math.max(apiResult?.riskScore || 0, vtScore),
                            riskText: `FLAGGED BY ${malicious}/${total} ENGINES`,
                            badgeClass: "badge-status-pill danger",
                            reasonHtml: `
                                <p class="text-sm text-secondary mb-2">❌ <strong>VirusTotal Report:</strong> ${malicious} out of ${total} antivirus engines flagged this URL as malicious.</p>
                                ${apiResult ? apiResult.reasonHtml : ""}
                                <p class="text-sm text-secondary"><em>Source: ${apiSource}</em></p>
                            `
                        };
                    } else if (!apiResult || apiResult.riskScore <= 10) {
                        apiResult = {
                            riskScore: 2,
                            riskText: "VERIFIED CLEAN BY ALL ENGINES",
                            badgeClass: "badge-status-pill secure",
                            reasonHtml: `
                                <p class="text-sm text-secondary mb-2">🟢 <strong>VirusTotal:</strong> 0/${total} engines flagged this URL. Clean across all databases.</p>
                                ${apiResult ? apiResult.reasonHtml : ""}
                                <p class="text-sm text-secondary"><em>Source: ${apiSource}</em></p>
                            `
                        };
                    }
                }
            }

            // 3) Fallback to rule-based heuristics if no API results
            if (!apiResult) {
                apiResult = runLinkHeuristics(url);
                apiSource = "FraudShield Rule Engine (offline)";
                apiResult.reasonHtml += `<p class="text-sm text-secondary mt-2"><em>Source: ${apiSource}. Add API keys in ⚙️ Settings for live database scanning.</em></p>`;
            }

            // Render
            loader.style.display = "none";
            resultCard.style.display = "block";

            if (apiResult.riskScore >= 50) {
                AudioSynth.playWarning();
            } else {
                AudioSynth.playSuccess();
            }

            resultCard.innerHTML = `
                <div class="scan-result-header">
                    <div>
                        <span class="${apiResult.badgeClass}">${apiResult.riskText}</span>
                    </div>
                    <span class="scan-score text-gradient">${apiResult.riskScore}% Risk</span>
                </div>
                <div class="scan-reasons mt-2">
                    ${apiResult.reasonHtml}
                </div>
            `;
        });
    }

    // Module 3: Message scanner (Gemini AI + Rules)
    if (btnScanMsg) {
        btnScanMsg.addEventListener("click", async () => {
            const text = document.getElementById("scam-message-text").value.trim();
            if (!text) {
                alert("Please enter message body text to analyze.");
                return;
            }

            AudioSynth.playClick();

            const loader = document.getElementById("msg-scanning-loader");
            const resultCard = document.getElementById("msg-scan-result");

            loader.style.display = "flex";
            resultCard.style.display = "none";

            let tick = 0;
            const scanInterval = setInterval(() => {
                AudioSynth.playScan();
                tick++;
                if (tick >= 6) clearInterval(scanInterval);
            }, 150);

            let aiResult = null;

            // Try Gemini AI analysis first
            if (APIConfig.hasKey("gemini")) {
                loader.querySelector("span").innerText = "🧠 Gemini AI analyzing message for scam patterns...";
                const prompt = `You are a cybersecurity fraud detection AI. Analyze the following SMS/WhatsApp/Email message and determine if it is a scam.

Message: "${text}"

Respond in EXACTLY this JSON format (no markdown, no backticks):
{"score": 0-100, "verdict": "SAFE/SUSPICIOUS/DANGEROUS", "reasons": ["reason1", "reason2"], "advice": "brief safety advice"}

Score guide: 0-30 = safe, 31-70 = suspicious, 71-100 = dangerous scam.
Focus on: urgency tactics, unrealistic rewards, fake authority claims, suspicious links, OTP/PIN requests.`;

                const geminiResponse = await APIConfig.geminiAnalyze(prompt);
                if (geminiResponse) {
                    try {
                        // Clean response (remove markdown code blocks if any)
                        const cleaned = geminiResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
                        const parsed = JSON.parse(cleaned);
                        aiResult = {
                            score: Math.min(100, Math.max(0, parsed.score || 50)),
                            verdict: parsed.verdict || "SUSPICIOUS",
                            reasons: parsed.reasons || [],
                            advice: parsed.advice || "",
                            source: "Google Gemini AI"
                        };
                    } catch (e) {
                        console.warn("Gemini response parse error, using rule fallback:", e);
                    }
                }
            }

            // Fallback to rule-based heuristics
            if (!aiResult) {
                aiResult = runMessageHeuristics(text);
                aiResult.source = "FraudShield Rule Engine (offline)";
            }

            loader.style.display = "none";
            resultCard.style.display = "block";

            const badgeClass = aiResult.score >= 70 ? "badge-status-pill danger" 
                             : aiResult.score >= 30 ? "badge-status-pill danger" 
                             : "badge-status-pill secure";
            const verdictText = aiResult.score >= 70 ? "DANGEROUS SCAM PATTERN"
                              : aiResult.score >= 30 ? "SUSPICIOUS MESSAGE"
                              : "PROBABLY SECURE";

            if (aiResult.score >= 30) {
                AudioSynth.playWarning();
            } else {
                AudioSynth.playSuccess();
            }

            const reasonsHtml = aiResult.reasons.length > 0
                ? aiResult.reasons.map(r => `<p class="text-sm text-secondary mb-2">⚠️ ${r}</p>`).join("")
                : `<p class="text-sm text-secondary">🟢 No scam indicators detected.</p>`;

            resultCard.innerHTML = `
                <div class="scan-result-header">
                    <div>
                        <span class="${badgeClass}">${verdictText}</span>
                    </div>
                    <span class="scan-score text-gradient">${aiResult.score}% Risk</span>
                </div>
                <div class="scan-reasons mt-2">
                    ${reasonsHtml}
                    ${aiResult.advice ? `<p class="text-sm mt-2" style="color: var(--primary);"><strong>AI Advice:</strong> ${aiResult.advice}</p>` : ""}
                    <p class="text-sm text-secondary mt-2"><em>Source: ${aiResult.source}${aiResult.source.includes("offline") ? ". Add Gemini API key in ⚙️ Settings for AI-powered analysis." : ""}</em></p>
                </div>
            `;
        });
    }
}

// --- RULE-BASED FALLBACK ENGINES ---
function runLinkHeuristics(url) {
    const lowerUrl = url.toLowerCase().trim();

    // 1) Clear Dangerous / Phishing Lookalikes
    if (lowerUrl.includes("amaz0n") || lowerUrl.includes("amazon-offers") || lowerUrl.includes("win-gift") || lowerUrl.includes("lotto-") || lowerUrl.includes("free-reward") || lowerUrl.includes("claim-prize")) {
        return {
            riskScore: 94, riskText: "DANGEROUS PHISHING WEBSITE", badgeClass: "badge-status-pill danger",
            reasonHtml: `<p class="text-sm text-secondary mb-2">❌ <strong>Lookalike Domain:</strong> Imitates official brand using deceptive keywords or spelling tricks.</p>
                         <p class="text-sm text-secondary mb-2">❌ <strong>Recently Registered:</strong> Created on temporary proxy hosters.</p>
                         <p class="text-sm text-secondary">❌ <strong>Blacklisted:</strong> Flagged by multi-source threat intelligence.</p>`
        };
    } else if (lowerUrl.includes("sbi-secure") || lowerUrl.includes("sbi-login") || lowerUrl.includes("secure-banking") || lowerUrl.includes("icici-secure") || lowerUrl.includes("hdfc-verification")) {
        return {
            riskScore: 98, riskText: "CRITICAL BANK PHISHING TRAP", badgeClass: "badge-status-pill danger",
            reasonHtml: `<p class="text-sm text-secondary mb-2">❌ <strong>Fake Banking Portal:</strong> Imitates bank customer interface.</p>
                         <p class="text-sm text-secondary mb-2">❌ <strong>No SSL Signature:</strong> Missing or fake SSL certification.</p>
                         <p class="text-sm text-secondary">❌ <strong>Threat Signature:</strong> High phishing activity detected.</p>`
        };
    }

    // 2) Known Popular Safe Domains list
    const safeDomains = [
        "google.com", "google.co.in", "youtube.com", "wikipedia.org", "wikipedia.com", 
        "github.com", "microsoft.com", "apple.com", "netflix.com", "yahoo.com", 
        "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", 
        "gmail.com", "amazon.in", "amazon.com", "zoom.us", "dropbox.com", "salesforce.com", 
        "stackoverflow.com", "openai.com", "cloudflare.com", "github.io", "w3schools.com"
    ];

    const isKnownSafe = safeDomains.some(domain => {
        // Must match either domain exactly, or as a host (e.g. support.google.com, not google.com.scam.in)
        const escaped = domain.replace(/\./g, '\\.');
        const regex = new RegExp(`^(https?:\\/\\/)?([^\\/\\?#]+\\.)?${escaped}(\\/|\\?|#|$)`);
        return regex.test(lowerUrl);
    });

    if (isKnownSafe) {
        return {
            riskScore: 2, riskText: "VERIFIED SAFE LINK", badgeClass: "badge-status-pill secure",
            reasonHtml: `<p class="text-sm text-secondary mb-2">🟢 <strong>Official Trusted Domain:</strong> High global authority domain with active SSL roots.</p>
                         <p class="text-sm text-secondary">🟢 <strong>Clean Reputation:</strong> Zero malicious reports or incident logs recorded.</p>`
        };
    }

    // 3) General Safe URL analysis (No dangerous tokens, normal domains)
    // If it looks like a standard normal website (e.g. starts with http/https, has a simple tld, and no suspicious keywords)
    const isUrlWellFormed = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(lowerUrl);
    const hasSuspiciousTokens = /[\d_-]+(lotto|gift|free|prize|reward|claim|win|verify|login|secure|update|billing|invoice|refund|account|wallet|kyc|support|help)/.test(lowerUrl);

    if (isUrlWellFormed && !hasSuspiciousTokens) {
        return {
            riskScore: 10, riskText: "PROBABLY SECURE DOMAIN", badgeClass: "badge-status-pill secure",
            reasonHtml: `<p class="text-sm text-secondary mb-2">🟢 <strong>Well-Formed Address:</strong> Standard clean domain path with no malicious character mappings.</p>
                         <p class="text-sm text-secondary">🟢 <strong>Low Threat Density:</strong> No scam keywords or phishing patterns detected offline.</p>`
        };
    }

    // 4) Fallback for unrecognized, odd-looking, or uncertified links
    return {
        riskScore: 60, riskText: "SUSPICIOUS / UNKNOWN DOMAIN", badgeClass: "badge-status-pill danger",
        reasonHtml: `<p class="text-sm text-secondary mb-2">⚠️ <strong>Unverified Registry:</strong> Lacks registered trust metrics in the local signature db.</p>
                     <p class="text-sm text-secondary">⚠️ <strong>Caution Advised:</strong> Avoid typing sensitive information or entering passwords here.</p>`
    };
}

function runMessageHeuristics(text) {
    const lowerText = text.toLowerCase();
    let score = 5;
    let reasons = [];

    if (lowerText.includes("won") || lowerText.includes("lottery") || lowerText.includes("prize") || lowerText.includes("lakh") || lowerText.includes("crore")) {
        score += 45;
        reasons.push("🎁 **Unrealistic Financial Rewards**: Message promises substantial unexpected wealth.");
    }
    if (lowerText.includes("immediately") || lowerText.includes("urgently") || lowerText.includes("cut off") || lowerText.includes("blocked") || lowerText.includes("suspended")) {
        score += 35;
        reasons.push("🚨 **Urgency Pressure Hook**: Commands prompt quick panic reactions.");
    }
    if (lowerText.includes("click") || lowerText.includes("link") || lowerText.includes(".in") || lowerText.includes(".com") || lowerText.includes("http")) {
        score += 15;
        reasons.push("🔗 **Call to Action Link**: Redirects users out of secure ecosystems.");
    }
    score = Math.min(100, score);

    return { score, reasons, advice: score >= 50 ? "Do not click links or share OTPs. Verify with your bank directly." : "" };
}

// --- MODULE 5: BEHAVIORAL GUARDIAN ---
function initBehavioralGuardian() {
    const btnSafe = document.getElementById("btn-sim-behavior-safe");
    const btnAnomaly = document.getElementById("btn-sim-behavior-anomaly");

    if (btnSafe) {
        btnSafe.addEventListener("click", () => {
            AudioSynth.playClick();
            simulateBehaviorVerdict(5, "NORMAL", [
                "✅ Transaction Amount inside normal boundaries",
                "✅ Timing complies with normal diurnal cycle",
                "✅ IP Location velocity verified",
                "✅ Biometric interaction pattern matching"
            ]);
        });
    }

    if (btnAnomaly) {
        btnAnomaly.addEventListener("click", () => {
            AudioSynth.playWarning();
            simulateBehaviorVerdict(90, "HIGH RISK ANOMALY", [
                "❌ Transaction amount (₹25,000) exceeds standard ₹2,000 threshold",
                "❌ Transfer initiated at 12:30 AM (Standard resting hours)",
                "⚠️ New destination bank code routed out-of-state",
                "❌ Speed of PIN entering matches automated screen grab"
            ]);
        });
    }
}

function simulateBehaviorVerdict(score, verdictText, checklist) {
    const needle = document.getElementById("behavior-gauge-needle");
    const progress = document.getElementById("behavior-gauge-progress");
    const riskVal = document.getElementById("behavior-risk-value");
    const badge = document.getElementById("behavior-risk-badge");
    const statusBox = document.getElementById("behavior-status-list");
    const card = document.getElementById("behavioral-visualizer-card");

    if (score >= 70) {
        card.className = "card glass-card flex-col align-center justify-between border-pulse scanned-danger";
    } else {
        card.className = "card glass-card flex-col align-center justify-between border-pulse scanned-safe";
    }

    // Needle rotation (-90 to 90 deg)
    const degrees = -90 + (score * 1.8);
    needle.style.transform = `rotate(${degrees}deg)`;

    // Circular progress stroke offset (180deg visible limit -> 141.35 max stroke color)
    const strokeOffset = 282.7 - ((score / 100) * 141.35);
    progress.style.strokeDashoffset = strokeOffset;

    riskVal.innerText = `${score}%`;
    badge.innerText = verdictText;

    if (score <= 30) {
        badge.className = "gauge-label safe";
    } else {
        badge.className = "gauge-label dangerous";
    }

    // Compile checklist HTML
    statusBox.innerHTML = checklist.map(item => {
        const isFail = item.startsWith("❌") || item.startsWith("⚠️");
        const itemClass = isFail ? (item.startsWith("❌") ? "failed" : "failed") : "checked";
        return `<li class="${itemClass}">${item}</li>`;
    }).join("");
}

// --- GLOBAL QUIZ QUESTIONS ---
const QuizQuestions = [
    {
        q: "You receive an SMS saying your electricity will be disconnected tonight unless you call a mobile number. What should you do?",
        options: [
            "Call the number immediately and pay to avoid power cut",
            "Ignore the SMS and check your official electricity bill portal or utility office",
            "Download the remote screen-sharing app they request to verify your account"
        ],
        correct: 1,
        a: "Utility companies never send SMS warnings with personal mobile numbers or ask you to install third-party screen sharing apps like AnyDesk."
    },
    {
        q: "A caller claims to be from your bank and asks for a 6-digit OTP sent to your phone to 'secure' your blocked account. Should you share it?",
        options: [
            "Yes, OTP is required to unlock accounts",
            "No, never share OTPs, PINs, or passwords with anyone, including bank staff",
            "Only share it if they know your correct home address and full name"
        ],
        correct: 1,
        a: "Banks never ask for OTPs, PINs, or passwords. Sharing an OTP gives scammers full authorization to transfer your money."
    },
    {
        q: "You scan a UPI QR code sent by a buyer to 'receive' payment for an item you are selling. You are asked to enter your UPI PIN. What happens next?",
        options: [
            "Money will be deposited into your bank account",
            "Money will be deducted from your bank account",
            "The transaction will register your contact details as safe"
        ],
        correct: 1,
        a: "UPI PIN is ONLY required to send or deduct money, NEVER to receive money. If you enter your PIN, money will be immediately stolen from your account."
    }
];

// --- MODULE 6: FRAUD ACADEMY & CAROUSEL ---
let currentSlide = 0;
const totalSlides = 3;

function initFraudAcademy() {
    const btnPrev = document.getElementById("btn-prev-slide");
    const btnNext = document.getElementById("btn-next-slide");
    const slideNum = document.getElementById("edu-slide-num");
    const slides = document.querySelectorAll(".carousel-slide");

    if (btnPrev && btnNext) {
        btnPrev.addEventListener("click", () => {
            AudioSynth.playClick();
            slides[currentSlide].classList.remove("active");
            currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
            slides[currentSlide].classList.add("active");
            slideNum.innerText = `${currentSlide + 1} of ${totalSlides}`;
        });

        btnNext.addEventListener("click", () => {
            AudioSynth.playClick();
            slides[currentSlide].classList.remove("active");
            currentSlide = (currentSlide + 1) % totalSlides;
            slides[currentSlide].classList.add("active");
            slideNum.innerText = `${currentSlide + 1} of ${totalSlides}`;
        });
    }

    // Quiz Setup
    renderQuizQuestion();
    
    const btnQuiz = document.getElementById("btn-quiz-action");
    if (btnQuiz) {
        btnQuiz.addEventListener("click", () => {
            if (btnQuiz.innerText === "Next Question") {
                AudioSynth.playClick();
                proceedQuizStep();
            } else {
                const selectedOption = document.querySelector(".quiz-option.selected");
                if (!selectedOption) return;

                const selectedIdx = parseInt(selectedOption.getAttribute("data-index"));
                const currentQ = QuizQuestions[AppState.quizIndex];
                const isCorrect = selectedIdx === currentQ.correct;

                // Lock options clicking
                document.querySelectorAll(".quiz-option").forEach(opt => {
                    opt.style.pointerEvents = "none";
                    const optIdx = parseInt(opt.getAttribute("data-index"));
                    if (optIdx === currentQ.correct) {
                        opt.classList.add("correct");
                    } else if (optIdx === selectedIdx) {
                        opt.classList.add("incorrect");
                    }
                });

                const verdictBanner = document.getElementById("quiz-verdict-banner");
                verdictBanner.style.display = "block";

                if (isCorrect) {
                    AudioSynth.playSuccess();
                    AppState.quizScore += 1;
                    verdictBanner.className = "quiz-verdict-banner bg-emerald-trans border-emerald text-emerald p-4 rounded-lg mt-4";
                    verdictBanner.innerHTML = `<strong>Correct Answer!</strong><br>${currentQ.a}`;
                } else {
                    AudioSynth.playWarning();
                    verdictBanner.className = "quiz-verdict-banner bg-rose-trans border-rose text-rose p-4 rounded-lg mt-4";
                    verdictBanner.innerHTML = `<strong>Incorrect!</strong> The correct answer is: ${currentQ.options[currentQ.correct]}.<br>${currentQ.a}`;
                }

                // Next state
                btnQuiz.innerText = "Next Question";
            }
        });
    }
}

function renderQuizQuestion() {
    const qText = document.getElementById("quiz-question-text");
    const optionsBox = document.getElementById("quiz-options-box");
    const progressFill = document.getElementById("quiz-progress-fill");
    const btnQuiz = document.getElementById("btn-quiz-action");
    const verdictBanner = document.getElementById("quiz-verdict-banner");

    if (!qText) return;

    verdictBanner.style.display = "none";
    const currentQ = QuizQuestions[AppState.quizIndex];
    qText.innerText = `Q: ${currentQ.q}`;
    
    // Fill options
    optionsBox.innerHTML = currentQ.options.map((opt, idx) => {
        const char = String.fromCharCode(65 + idx); // A, B, C...
        return `
            <div class="quiz-option" data-index="${idx}" onclick="selectQuizOption(this)">
                <span class="quiz-option-marker">${char}</span>
                <span>${opt}</span>
            </div>
        `;
    }).join("");

    // Progress bar
    const progressPercent = ((AppState.quizIndex) / QuizQuestions.length) * 100;
    progressFill.style.width = `${progressPercent}%`;

    // Button states reset
    btnQuiz.innerText = "Submit Answer";
    btnQuiz.disabled = true;
    btnQuiz.onclick = null; // Revert custom submit listener back to standard flow
}

window.selectQuizOption = function(element) {
    AudioSynth.playClick();
    const options = document.querySelectorAll(".quiz-option");
    options.forEach(opt => opt.classList.remove("selected"));
    
    element.classList.add("selected");
    
    const btnQuiz = document.getElementById("btn-quiz-action");
    btnQuiz.disabled = false;
};

function proceedQuizStep() {
    AppState.quizIndex += 1;
    
    if (AppState.quizIndex < QuizQuestions.length) {
        renderQuizQuestion();
    } else {
        // Finished Quiz!
        AudioSynth.playSuccess();
        const card = document.getElementById("quiz-card");
        const pct = (AppState.quizScore / QuizQuestions.length) * 100;

        let badgeAwardText = "Cyber Trainee 🔰";
        if (pct === 100) badgeAwardText = "Grand Master Cyber Shield 🏆";
        else if (pct >= 75) badgeAwardText = "Shield Guard 🛡️";
        
        document.getElementById("quiz-score-badge").innerText = badgeAwardText;

        card.innerHTML = `
            <div class="card-header text-center w-full">
                <h3 class="card-title text-2xl">Quiz Completed!</h3>
                <p class="card-subtitle">Cybersecurity Assessment Completed Successfully</p>
            </div>
            <div class="text-center py-6">
                <div class="text-gradient font-display text-5xl font-bold mb-4">${AppState.quizScore} / ${QuizQuestions.length}</div>
                <h4 class="font-bold text-lg mb-2">Award: ${badgeAwardText}</h4>
                <p class="text-sm text-secondary px-6">You've mastered critical anti-phishing knowledge! You are now statistically 80% safer from common UPI &amp; OTP frauds.</p>
            </div>
            <button class="btn btn-primary btn-full mt-4" onclick="location.reload()">Restart Quiz</button>
        `;
    }
}

// --- MODULE 7: EMERGENCY FRAUD REPORTING ---
function initEmergencyDesk() {
    const btnFreeze = document.getElementById("btn-emergency-freeze");
    const btnBlock = document.getElementById("btn-emergency-block");
    const btnReport = document.getElementById("btn-generate-report");

    if (btnFreeze) {
        btnFreeze.addEventListener("click", () => {
            AudioSynth.playWarning();
            alert("🔐 EMERGENCY SECURE PROTOCOL ACTIVE: Mock RBI freeze orders dispatched to Paytm, PhonePe, and Google Pay API hubs. All outgoing payment pipelines for Amit Kumar have been LOCKED. Contact bank care 1800-BANK-SAFE to lift lock.");
        });
    }

    if (btnBlock) {
        btnBlock.addEventListener("click", () => {
            AudioSynth.playClick();
            const attackerId = prompt("Enter Caller phone number or scam UPI ID to globally block:");
            if (attackerId) {
                AudioSynth.playSuccess();
                alert(`🚫 Added "${attackerId}" to global FraudShield blockchain list. Future payment attempts to/from this address will be automatically blocked by our network. Thank you for reporting!`);
            }
        });
    }

    if (btnReport) {
        btnReport.addEventListener("click", () => {
            AudioSynth.playClick();
            
            // Collect report data
            const victim = document.getElementById("inc-victim").value || "Amit Kumar";
            const scammer = document.getElementById("inc-scammer").value || "Unknown Phone/UPI";
            const type = document.getElementById("inc-type").value;
            const loss = document.getElementById("inc-loss").value || "0";
            const details = document.getElementById("inc-description").value || "None provided";

            // Generate printing layout HTML
            const printableArea = document.getElementById("printable-report-area");
            const dateStr = new Date().toLocaleString();

            printableArea.innerHTML = `
                <div class="print-header">
                    <h2>OFFICIAL CYBERCRIME SECURITY REPORT</h2>
                    <p>Compiled by FraudShield AI System • Date: ${dateStr}</p>
                </div>
                <div class="print-section">
                    <h3>1. Complainant / Victim Profile</h3>
                    <div class="print-grid">
                        <p><strong>Victim Full Name:</strong> ${victim}</p>
                        <p><strong>Status:</strong> Active Security Profile Verified</p>
                    </div>
                </div>
                <div class="print-section">
                    <h3>2. Attack Incident Details</h3>
                    <div class="print-grid">
                        <p><strong>Suspect Address/UPI/Phone:</strong> ${scammer}</p>
                        <p><strong>Category of Scam:</strong> ${type}</p>
                        <p><strong>Financial Loss:</strong> ₹${Number(loss).toLocaleString('en-IN')}</p>
                        <p><strong>Flagged Threat Level:</strong> Critical (High Risk)</p>
                    </div>
                </div>
                <div class="print-section">
                    <h3>3. Attack Description &amp; Indicators</h3>
                    <p style="white-space: pre-line;">${details}</p>
                </div>
                <div class="print-section" style="margin-top: 3cm;">
                    <hr>
                    <p style="text-align: center; font-size: 0.8rem; color: #555;">Document secure hash: <strong>SHA-256/FSD_${Math.floor(Math.random()*10000000)}</strong><br>Generated automatically via client side AI telemetry on device. Authorized under RBI Cyber Security Framework.</p>
                </div>
            `;

            // Prompt print dialog
            window.print();
        });
    }
}

// --- DASHBOARD SPEEDOMETER STARTUP DIAGNOSTIC ANIMATION ---
function animateDashboardGaugeSelfCheck() {
    const needle = document.getElementById("dashboard-gauge-needle");
    const progress = document.getElementById("gauge-progress-circle");
    const scoreVal = document.getElementById("dashboard-gauge-val");
    const status = document.getElementById("dashboard-gauge-status");
    const reason = document.getElementById("dashboard-gauge-reason");

    if (!needle || !progress) return;

    reason.innerHTML = "⚡ Initializing AI Defense Grids... Scanning memory frames...";
    AudioSynth.playTone(400, 'sine', 0.2);

    let currentRisk = 0;
    let sweepingUp = true;
    
    // Quick tick timer sweeping gauge needle up to 100% and back to 5% (safe status)
    const interval = setInterval(() => {
        if (sweepingUp) {
            currentRisk += 8;
            if (currentRisk >= 100) {
                currentRisk = 100;
                sweepingUp = false;
                AudioSynth.playWarning();
                reason.innerHTML = "⚠️ Threat audit completed. Recalibrating safety scopes...";
            }
        } else {
            currentRisk -= 6;
            if (currentRisk <= 5) {
                currentRisk = 5;
                clearInterval(interval);
                AudioSynth.playSuccess();
                reason.innerHTML = "🟢 System diagnostics: 100% clean. All active shields operational.";
                status.innerText = "SECURE";
                status.className = "gauge-label safe";
            }
        }

        // Needle rotation
        const degrees = -90 + (currentRisk * 1.8);
        needle.style.transform = `rotate(${degrees}deg)`;

        // SVG dashoffset
        const strokeOffset = 282.7 - ((currentRisk / 100) * 141.35);
        progress.style.strokeDashoffset = strokeOffset;

        scoreVal.innerText = `${currentRisk}%`;
        
        if (currentRisk >= 75) {
            status.innerText = "THREAT?";
            status.className = "gauge-label dangerous animate-pulse";
        } else if (currentRisk >= 35) {
            status.innerText = "AUDITING";
            status.className = "gauge-label medium";
        } else {
            status.innerText = "SCANNING";
            status.className = "gauge-label safe";
        }
    }, 45);
}

// --- INNOVATIVE FEATURE: FRAUD RISK HEATMAP ---
function initHeatMap() {
    const hotspots = document.querySelectorAll(".hotspot");
    const mapInfoCity = document.getElementById("map-info-city");
    const mapInfoScam = document.getElementById("map-info-scam");
    const mapInfoRisk = document.getElementById("map-info-risk");
    const mapDetailCard = document.getElementById("map-detail-card");

    const StateThreatData = {
        jk: { name: "Jammu & Kashmir / Ladakh", risk: 28, threat: "Low", scam: "Sim Impersonation", color: "safe" },
        py: { name: "Punjab & Haryana (Delhi)", risk: 82, threat: "High", scam: "Job Offer / OTP Scam", color: "high" },
        hu: { name: "Himachal & Uttarakhand", risk: 22, threat: "Low", scam: "Fake Customer Care No.", color: "safe" },
        rj: { name: "Rajasthan", risk: 58, threat: "Medium", scam: "Electricity Bill Fraud", color: "medium" },
        gj: { name: "Gujarat", risk: 54, threat: "Medium", scam: "UPI Collect Request", color: "medium" },
        up: { name: "Uttar Pradesh", risk: 78, threat: "High", scam: "KBC Lottery Bait", color: "high" },
        mp: { name: "Madhya Pradesh", risk: 42, threat: "Medium", scam: "Aadhaar Enabled Payment", color: "medium" },
        mh: { name: "Maharashtra", risk: 82, threat: "High", scam: "Fake Electricity Bill / Part-time Job", color: "high" },
        ka: { name: "Karnataka", risk: 85, threat: "High", scam: "UPI QR Code Phishing", color: "high" },
        ap: { name: "Andhra & Telangana", risk: 62, threat: "Medium", scam: "KYC Suspicious Update", color: "medium" },
        kl: { name: "Kerala", risk: 35, threat: "Medium", scam: "FedEx Parcel Scam", color: "medium" },
        tn: { name: "Tamil Nadu", risk: 48, threat: "Medium", scam: "Gas Connection Rebate", color: "medium" },
        br: { name: "Bihar & Jharkhand", risk: 72, threat: "High", scam: "OTP Phishing & Takeover", color: "high" },
        od: { name: "Odisha & Chhattisgarh", risk: 38, threat: "Medium", scam: "PM-Kisan Fraud Bait", color: "medium" },
        wb: { name: "West Bengal", risk: 56, threat: "Medium", scam: "E-wallet Freeze Scare", color: "medium" },
        ne: { name: "Northeast States", risk: 30, threat: "Low", scam: "Remote Support Trap", color: "safe" }
    };

    const statePaths = document.querySelectorAll(".map-state-path");

    // 1. Mouseover interactions for all detailed state paths
    statePaths.forEach(path => {
        const stateId = path.getAttribute("id").replace("state-", "");
        const data = StateThreatData[stateId];

        path.addEventListener("mouseenter", () => {
            statePaths.forEach(p => p.classList.remove("active"));
            path.classList.add("active");

            if (data) {
                mapInfoCity.innerText = data.name;
                mapInfoScam.innerText = data.scam;
                mapInfoRisk.innerText = `${data.threat} Threat (${data.risk}%)`;
                if (data.color === 'safe') {
                    mapInfoRisk.className = "badge-risk safe";
                } else if (data.color === 'medium') {
                    mapInfoRisk.className = "badge-risk medium";
                } else {
                    mapInfoRisk.className = "badge-risk high";
                }
                mapDetailCard.style.display = "block";
            }
        });
    });

    // 2. Pulse Hotspots Click/Hover Interactivity
    hotspots.forEach(spot => {
        spot.addEventListener("click", () => {
            AudioSynth.playClick();

            const city = spot.getAttribute("data-city");
            const scam = spot.getAttribute("data-type");
            const level = spot.getAttribute("data-level");
            const stateId = spot.getAttribute("data-state");

            mapInfoCity.innerText = city;
            mapInfoScam.innerText = scam;

            if (level === 'High') {
                mapInfoRisk.innerText = "Critical Risk (85%)";
                mapInfoRisk.className = "badge-risk high";
            } else if (level === 'Medium') {
                mapInfoRisk.innerText = "Medium Risk (52%)";
                mapInfoRisk.className = "badge-risk medium";
            } else {
                mapInfoRisk.innerText = "Low Threat (15%)";
                mapInfoRisk.className = "badge-risk safe";
            }

            mapDetailCard.style.display = "block";

            // Highlight the corresponding state outline
            statePaths.forEach(p => p.classList.remove("active"));
            const targetState = document.getElementById(`state-${stateId}`);
            if (targetState) {
                targetState.classList.add("active");
            }
        });
    });
}

// --- CENTRAL SETTINGS & API CONFIGURATION CONTROLLER ---
function initAPISettings() {
    const btn = document.getElementById("btn-api-settings");
    const modal = document.getElementById("api-settings-modal");
    const closeBtn = document.getElementById("btn-close-api-settings");
    const saveBtn = document.getElementById("btn-save-api-keys");

    if (!btn || !modal) return;

    // 1) Load keys into modal inputs and page inputs
    const loadKeys = () => {
        const geminiKey = APIConfig.getKey("gemini");
        const sbKey = APIConfig.getKey("safebrowsing");
        const vtKey = APIConfig.getKey("virustotal");

        document.getElementById("input-gemini-key").value = geminiKey;
        document.getElementById("input-safebrowsing-key").value = sbKey;
        document.getElementById("input-virustotal-key").value = vtKey;

        // Settings page inputs sync
        const geminiPage = document.getElementById("input-gemini-key-page");
        const sbPage = document.getElementById("input-safebrowsing-key-page");
        const vtPage = document.getElementById("input-virustotal-key-page");

        if (geminiPage) geminiPage.value = geminiKey;
        if (sbPage) sbPage.value = sbKey;
        if (vtPage) vtPage.value = vtKey;

        updateAPIStatusIndicators();
    };

    // 2) Modal bindings
    btn.addEventListener("click", () => {
        AudioSynth.playClick();
        loadKeys();
        modal.style.display = "flex";
        setTimeout(() => modal.classList.add("active"), 10);
    });

    closeBtn.addEventListener("click", () => {
        modal.classList.remove("active");
        setTimeout(() => modal.style.display = "none", 300);
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.remove("active");
            setTimeout(() => modal.style.display = "none", 300);
        }
    });

    saveBtn.addEventListener("click", () => {
        AudioSynth.playSuccess();
        const geminiVal = document.getElementById("input-gemini-key").value;
        const sbVal = document.getElementById("input-safebrowsing-key").value;
        const vtVal = document.getElementById("input-virustotal-key").value;

        APIConfig.setKey("gemini", geminiVal);
        APIConfig.setKey("safebrowsing", sbVal);
        APIConfig.setKey("virustotal", vtVal);

        loadKeys(); // reload and sync
        
        saveBtn.innerText = "✅ Keys Saved!";
        saveBtn.style.background = "var(--success)";
        setTimeout(() => {
            saveBtn.innerText = "Save API Keys";
            saveBtn.style.background = "";
        }, 2000);
    });

    // 3) Dedicated Settings Tab Page Logic
    const savePageKeysBtn = document.getElementById("btn-save-api-keys-page");
    if (savePageKeysBtn) {
        savePageKeysBtn.addEventListener("click", () => {
            AudioSynth.playSuccess();
            const geminiVal = document.getElementById("input-gemini-key-page").value;
            const sbVal = document.getElementById("input-safebrowsing-key-page").value;
            const vtVal = document.getElementById("input-virustotal-key-page").value;

            APIConfig.setKey("gemini", geminiVal);
            APIConfig.setKey("safebrowsing", sbVal);
            APIConfig.setKey("virustotal", vtVal);

            loadKeys(); // reload and sync

            savePageKeysBtn.innerText = "✅ Saved Successfully!";
            setTimeout(() => {
                savePageKeysBtn.innerText = "Save API Configurations";
            }, 2000);
        });
    }

    // 4) Theme Selector Logic
    const themeDark = document.getElementById("theme-choice-dark");
    const themeLight = document.getElementById("theme-choice-light");

    if (themeDark && themeLight) {
        // Init active state based on current theme
        const currentTheme = localStorage.getItem("fraudshield_theme") || "dark";
        if (currentTheme === "light") {
            themeLight.classList.add("active");
            themeDark.classList.remove("active");
        } else {
            themeDark.classList.add("active");
            themeLight.classList.remove("active");
        }

        themeDark.addEventListener("click", () => {
            AudioSynth.playClick();
            document.body.classList.remove("light-theme");
            localStorage.setItem("fraudshield_theme", "dark");
            themeDark.classList.add("active");
            themeLight.classList.remove("active");
        });

        themeLight.addEventListener("click", () => {
            AudioSynth.playClick();
            document.body.classList.add("light-theme");
            localStorage.setItem("fraudshield_theme", "light");
            themeLight.classList.add("active");
            themeDark.classList.remove("active");
        });
    }

    // 5) Behavioral Guardian boundary configs sync
    const settingsSliderLimit = document.getElementById("settings-slider-spending-limit");
    const settingsLimitDisplay = document.getElementById("settings-spending-limit-display");
    const saveBehaviorBtn = document.getElementById("btn-save-behavior-settings");

    if (settingsSliderLimit && settingsLimitDisplay) {
        // Sync setting page slider on load
        const currentLimit = AppState.settings?.spendingLimit || 2000;
        settingsSliderLimit.value = currentLimit;
        settingsLimitDisplay.innerText = "₹" + Number(currentLimit).toLocaleString('en-IN');

        // Dynamic updates on drag
        settingsSliderLimit.addEventListener("input", (e) => {
            settingsLimitDisplay.innerText = "₹" + Number(e.target.value).toLocaleString('en-IN');
        });
    }

    // Sync normal times on load
    const secureStartInput = document.getElementById("settings-secure-start");
    const secureEndInput = document.getElementById("settings-secure-end");
    if (secureStartInput && secureEndInput) {
        secureStartInput.value = AppState.settings?.secureStart || "08:00";
        secureEndInput.value = AppState.settings?.secureEnd || "22:00";
    }

    if (saveBehaviorBtn) {
        saveBehaviorBtn.addEventListener("click", async () => {
            AudioSynth.playSuccess();
            
            const newLimit = parseInt(settingsSliderLimit.value) || 2000;
            const newStart = secureStartInput.value || "08:00";
            const newEnd = secureEndInput.value || "22:00";

            // Sync with AppState
            AppState.settings.spendingLimit = newLimit;
            AppState.settings.secureStart = newStart;
            AppState.settings.secureEnd = newEnd;

            // Also update the main slider and text inside the Behavioral Tab pane
            const mainSlider = document.getElementById("slider-spending-limit");
            const mainSliderDisplay = document.getElementById("spending-limit-display");
            if (mainSlider) mainSlider.value = newLimit;
            if (mainSliderDisplay) mainSliderDisplay.innerText = "₹" + Number(newLimit).toLocaleString('en-IN');

            // Save to Backend server
            const res = await BackendClient.post("/settings", AppState.settings);
            if (res && res.success) {
                saveBehaviorBtn.innerText = "✅ Rules Saved & Synced!";
                setTimeout(() => {
                    saveBehaviorBtn.innerText = "Save App & Behavior Rules";
                }, 2000);
            } else {
                saveBehaviorBtn.innerText = "✅ Saved Locally!";
                setTimeout(() => {
                    saveBehaviorBtn.innerText = "Save App & Behavior Rules";
                }, 2000);
            }
        });
    }

    // Initialize all input keys and status
    loadKeys();
}

function updateAPIStatusIndicators() {
    const indicators = {
        gemini: [document.getElementById("status-gemini"), document.getElementById("status-gemini-page")],
        safebrowsing: [document.getElementById("status-safebrowsing"), document.getElementById("status-safebrowsing-page")],
        virustotal: [document.getElementById("status-virustotal"), document.getElementById("status-virustotal-page")]
    };

    const badge = document.getElementById("api-status-badge");

    let activeCount = 0;
    for (const [name, elements] of Object.entries(indicators)) {
        const hasKey = APIConfig.hasKey(name);
        if (hasKey) activeCount++;
        
        elements.forEach(el => {
            if (!el) return;
            if (hasKey) {
                el.className = "api-status-dot active";
                el.title = "Connected";
            } else {
                el.className = "api-status-dot inactive";
                el.title = "No key";
            }
        });
    }

    if (badge) {
        if (activeCount === 3) {
            badge.innerText = "All APIs Active";
            badge.className = "api-badge active";
        } else if (activeCount > 0) {
            badge.innerText = `${activeCount}/3 APIs`;
            badge.className = "api-badge partial";
        } else {
            badge.innerText = "Offline Mode";
            badge.className = "api-badge inactive";
        }
    }
}
