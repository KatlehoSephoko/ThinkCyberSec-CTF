const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load challenges configuration
const challenges = JSON.parse(fs.readFileSync('./challenges.json', 'utf-8'));

// Initialize Supabase Postgres connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

let teamState = {};

// Save state to Supabase
function saveStateToDB() {
    pool.query(
        'INSERT INTO global_state (id, state) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET state = $1',
        [teamState]
    ).catch(err => console.error("Failed to save state:", err));
}

// --- ENDPOINTS ---
app.post('/api/register', (req, res) => {
    const { teamName, email, password } = req.body;
    if (teamState[teamName] || Object.values(teamState).some(t => t.email === email)) {
        return res.status(400).json({ error: 'Team name or email already registered.' });
    }
    teamState[teamName] = { email, password, solved: [], attempts: {}, penaltyPoints: 0 };
    saveStateToDB();
    res.json({ message: 'Team successfully registered! You can now log in.' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const teamName = Object.keys(teamState).find(name => 
        teamState[name].email === email && teamState[name].password === password
    );
    if (teamName) {
        res.json({ message: `Welcome, ${teamName}!`, team: teamName });
    } else {
        res.status(401).json({ error: 'Invalid email or shared team password.' });
    }
});

app.get('/api/challenges', (req, res) => {
    const teamName = req.query.team; 
    if (!teamName || !teamState[teamName]) return res.status(401).json({ error: "Invalid team" });

    const state = teamState[teamName];
    let cumulativeScore = 0;

    state.solved.forEach(id => {
        const chal = challenges.find(c => c.id === id);
        if (chal) cumulativeScore += chal.points;
    });
    cumulativeScore -= (state.penaltyPoints || 0);

    const availableChallenges = challenges.map(chal => {
        const isSolved = state.solved.includes(chal.id);
        const isUnlocked = chal.requires.every(reqId => state.solved.includes(reqId));
        const meetsScoreThreshold = chal.tier < 4 || cumulativeScore >= 1200;

        if (isUnlocked && meetsScoreThreshold) {
            const { flag, ...safeData } = chal; 
            return { 
                ...safeData, 
                status: isSolved ? 'solved' : 'open',
                attemptsMade: state.attempts[chal.id] || 0 // Sends attempt history to frontend
            };
        }
        return null;
    }).filter(Boolean);

    res.json({ score: cumulativeScore, challenges: availableChallenges });
});

app.post('/api/submit-flag', (req, res) => {
    const { teamName, challengeId, submittedFlag } = req.body;
    const state = teamState[teamName];
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
        
        // Let the team know if their previous penalties ate into their reward
        const penaltyTaken = currentAttempts * (challenge.penalty || 0);
        let msg = `Flag accepted! +${challenge.points} pts`;
        if (penaltyTaken > 0) {
            msg += ` (Note: You lost ${penaltyTaken} points from previous failed attempts)`;
        }
        
        res.json({ success: true, message: msg });
    } else {
        state.attempts[challengeId] = currentAttempts + 1;
        let errMsg = "Incorrect flag.";
        
        if (challenge.penalty) {
            state.penaltyPoints = (state.penaltyPoints || 0) + challenge.penalty;
            errMsg += ` ${challenge.penalty} points deducted from your dashboard!`;
        }
        
        saveStateToDB();
        
        // Calculate the live score so the dashboard updates instantly
        let newScore = 0;
        state.solved.forEach(id => {
            const c = challenges.find(x => x.id === id);
            if (c) newScore += c.points;
        });
        newScore -= (state.penaltyPoints || 0);
        
        res.status(401).json({ error: errMsg, newScore });
    }
});

app.get('/api/scoreboard', (req, res) => {
    const leaderboard = Object.entries(teamState).map(([teamName, state]) => {
        let score = 0;
        let history = [{ y: 0, challenge: "Started CTF" }];
        
        state.solved.forEach(id => {
            const chal = challenges.find(c => c.id === id);
            if (chal) {
                score += chal.points;
                history.push({ y: score, challenge: chal.name });
            }
        });
        
        const finalScore = score - (state.penaltyPoints || 0);
        return { teamName, score: finalScore, solvedCount: state.solved.length, history };
    });
    
    leaderboard.sort((a, b) => b.score - a.score);
    res.json(leaderboard);
});

// Boot sequence with database lock
pool.query(`CREATE TABLE IF NOT EXISTS global_state (id INT PRIMARY KEY, state JSONB)`)
    .then(() => pool.query('SELECT state FROM global_state WHERE id = 1'))
    .then(res => {
        if (res.rows.length > 0) {
            teamState = res.rows[0].state;
            console.log("Team state restored from Supabase!");
        }
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => {
        console.error("Database initialization error:", err);
        app.listen(PORT, () => console.log(`Server running on port ${PORT} (DB Error)`));
    });
