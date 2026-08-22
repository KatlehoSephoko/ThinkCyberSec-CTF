const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

let teamState = {};

function getChallenges() {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'challenges.json'), 'utf-8'));
}

function saveStateToDB() {
    pool.query(
        'INSERT INTO global_state (id, state) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET state = $1',
        [teamState]
    ).catch(err => console.error("Failed to save state:", err));
}

// NEW HELPER: Calculates exact points based on fails and bought hints
function calculateEarnedPoints(chal, state) {
    const fails = state.attempts[chal.id] || 0;
    const penalty = chal.penalty || 0;
    const boughtCount = (state.boughtClues && state.boughtClues[chal.id]) ? state.boughtClues[chal.id] : 0;
    
    let hintsCost = 0;
    if (chal.hints) {
        for (let i = 0; i < boughtCount; i++) {
            if (chal.hints[i]) hintsCost += chal.hints[i].cost;
        }
    }
    return Math.max(0, chal.points - (fails * penalty) - hintsCost);
}

// --- ENDPOINTS ---
app.post('/api/register', (req, res) => {
    const { teamName, email, password } = req.body;
    if (teamState[teamName] || Object.values(teamState).some(t => t.email === email)) {
        return res.status(400).json({ error: 'Team name or email already registered.' });
    }
    // Added boughtClues tracking
    teamState[teamName] = { email, password, solved: [], attempts: {}, boughtClues: {} };
    saveStateToDB();
    res.json({ message: 'Team successfully registered! You can now log in.' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const teamName = Object.keys(teamState).find(name => 
        teamState[name].email === email && teamState[name].password === password
    );
    if (teamName) res.json({ message: `Welcome, ${teamName}!`, team: teamName });
    else res.status(401).json({ error: 'Invalid email or shared team password.' });
});

app.get('/api/challenges', (req, res) => {
    const teamName = req.query.team; 
    if (!teamName || !teamState[teamName]) return res.status(401).json({ error: "Invalid team" });

    const state = teamState[teamName];
    state.boughtClues = state.boughtClues || {}; // Safety net for old accounts
    const challenges = getChallenges(); 
    let cumulativeScore = 0;

    state.solved.forEach(id => {
        const chal = challenges.find(c => c.id === id);
        if (chal) cumulativeScore += calculateEarnedPoints(chal, state);
    });

    const availableChallenges = challenges.map(chal => {
        const isSolved = state.solved.includes(chal.id);
        const isUnlocked = chal.requires.every(reqId => state.solved.includes(reqId));
        const meetsScoreThreshold = chal.tier < 4 || cumulativeScore >= 1200;

        if (isUnlocked && meetsScoreThreshold) {
            const boughtCount = state.boughtClues[chal.id] || 0;
            const revealedHints = [];
            let nextHintCost = null;

            if (chal.hints) {
                for (let i = 0; i < boughtCount; i++) {
                    if (chal.hints[i]) revealedHints.push(chal.hints[i].text);
                }
                if (chal.hints[boughtCount]) {
                    nextHintCost = chal.hints[boughtCount].cost;
                }
            }

            const { flag, hints, ...safeData } = chal; 
            return { 
                ...safeData, 
                status: isSolved ? 'solved' : 'open',
                attemptsMade: state.attempts[chal.id] || 0,
                currentPoints: calculateEarnedPoints(chal, state),
                revealedHints,
                nextHintCost
            };
        }
        return null;
    }).filter(Boolean);

    res.json({ score: cumulativeScore, challenges: availableChallenges });
});

// NEW ENDPOINT: Buy a Hint
app.post('/api/buy-hint', (req, res) => {
    const { teamName, challengeId } = req.body;
    const state = teamState[teamName];
    const challenges = getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);

    if (!state || !challenge || state.solved.includes(challengeId)) {
        return res.status(400).json({ error: "Cannot buy hint." });
    }

    state.boughtClues = state.boughtClues || {};
    const boughtCount = state.boughtClues[challengeId] || 0;

    if (!challenge.hints || !challenge.hints[boughtCount]) {
        return res.status(400).json({ error: "No more hints available!" });
    }

    state.boughtClues[challengeId] = boughtCount + 1;
    saveStateToDB();
    res.json({ success: true, message: "Hint unlocked! Maximum points reduced." });
});

app.post('/api/submit-flag', (req, res) => {
    const { teamName, challengeId, submittedFlag } = req.body;
    const state = teamState[teamName];
    const challenges = getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);

    if (!state || !challenge) return res.status(404).json({ error: "Not found." });
    if (state.solved.includes(challengeId)) return res.status(400).json({ error: "Already solved." });

    const currentAttempts = state.attempts[challengeId] || 0;
    if (challenge.maxAttempts && currentAttempts >= challenge.maxAttempts) {
        return res.status(403).json({ error: "Maximum attempts reached. Challenge locked." });
    }

    if (challenge.flag === submittedFlag) {
        state.solved.push(challengeId);
        saveStateToDB();
        
        const earnedPoints = calculateEarnedPoints(challenge, state);
        res.json({ success: true, message: `Flag accepted! +${earnedPoints} pts added to total score.` });
    } else {
        state.attempts[challengeId] = currentAttempts + 1;
        let errMsg = "Incorrect flag.";
        if (challenge.penalty) errMsg += ` Challenge value reduced by ${challenge.penalty} points.`;
        
        saveStateToDB();
        res.status(401).json({ error: errMsg }); 
    }
});

app.get('/api/scoreboard', (req, res) => {
    const challenges = getChallenges(); 
    const leaderboard = Object.entries(teamState).map(([teamName, state]) => {
        let score = 0;
        let history = [{ y: 0, challenge: "Started CTF" }];
        
        state.solved.forEach(id => {
            const chal = challenges.find(c => c.id === id);
            if (chal) {
                score += calculateEarnedPoints(chal, state);
                history.push({ y: score, challenge: chal.name });
            }
        });
        
        return { teamName, score: score, solvedCount: state.solved.length, history };
    });
    
    leaderboard.sort((a, b) => b.score - a.score);
    res.json(leaderboard);
});

// --- BOOT UP SEQUENCE WITH RETRY LOOP ---
function initializeDatabase(retries = 5) {
    pool.query(`CREATE TABLE IF NOT EXISTS global_state (id INT PRIMARY KEY, state JSONB)`)
        .then(() => pool.query('SELECT state FROM global_state WHERE id = 1'))
        .then(res => {
            if (res.rows.length > 0) {
                teamState = res.rows[0].state;
                console.log("✅ Team state safely restored from Supabase!");
            } else {
                console.log("⚠️ No existing database found. Starting fresh.");
            }
            
            // Only start the server once the DB is fully awake and connected
            app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
        })
        .catch(err => {
            console.error(`⚠️ DB Error: Supabase might be asleep. Retries left: ${retries}`);
            if (retries > 0) {
                console.log("⏳ Waiting 5 seconds for Supabase to wake up...");
                setTimeout(() => initializeDatabase(retries - 1), 5000);
            } else {
                console.error("❌ CRITICAL: Could not connect to Supabase after multiple attempts.", err);
                process.exit(1); 
            }
        });
}

// Start the boot sequence
initializeDatabase();
