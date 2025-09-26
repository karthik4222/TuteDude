
// server.js - Proctoring backend (ESM)
import express from 'express';
import cors from 'cors';

import { connectDB } from './db.js';

let db;
// Connect to DB once at startup
connectDB().then(database => {
	db = database;
	console.log('Connected to MongoDB');
	// Start server only after DB is ready
	const PORT = process.env.PORT || 4000;
	app.listen(PORT, () => {
		console.log(`Backend listening on port ${PORT}`);
	});
}).catch(err => {
	console.error('Failed to connect to MongoDB:', err);
	process.exit(1);
});


const app = express();
app.use(cors());
app.use(express.json());

// GET /api/reports/:sessionId/detailed - get summary report for a session
app.get('/api/reports/:sessionId/detailed', async (req, res) => {
	const { sessionId } = req.params;
	try {
		const events = await db.collection('events').find({ sessionId }).sort({ timestamp: 1 }).toArray();
		if (!events.length) return res.status(404).json({ error: 'No events for session' });
		// Count event types
		const counts = {};
		for (const ev of events) {
			counts[ev.type] = (counts[ev.type] || 0) + 1;
		}
		// Sincerity score calculation (out of 100)
		// Deductions: PHONE=30, BOOK=15, WATCH=10, PAPER=10, INATTENTION=2, NO_FACE=5, MULTIPLE_FACES=10, NOISE=5
		let score = 100;
		score -= (counts.PHONE || 0) * 30;
		score -= (counts.BOOK || 0) * 15;
		score -= (counts.WATCH || 0) * 10;
		score -= (counts.PAPER || 0) * 10;
		score -= (counts.INATTENTION || 0) * 2;
		score -= (counts.NO_FACE || 0) * 5;
		score -= (counts.MULTIPLE_FACES || 0) * 10;
		score -= (counts.NOISE || 0) * 5;
		if (score < 0) score = 0;
		// Session summary
		const summary = {
			sessionId,
			candidateName: events[0].detail && events[0].type === 'INFO' && events[0].detail.includes('Ready.') ? (events[0].candidateName || null) : null,
			start: events[0].timestamp,
			end: events[events.length-1].timestamp,
			totalEvents: events.length,
			phoneDetections: counts.PHONE || 0,
			faceAway: counts.INATTENTION || 0,
			noFace: counts.NO_FACE || 0,
			multipleFaces: counts.MULTIPLE_FACES || 0,
			noise: counts.NOISE || 0,
			sincerityScore: score,
			allCounts: counts
		};
		res.json({ summary, events });
	} catch (err) {
		res.status(500).json({ error: 'DB error', details: err.message });
	}
});
// POST /api/events - log an event
app.post('/api/events', async (req, res) => {
	const { sessionId, type, detail, timestamp } = req.body;
	console.log('POST /api/events', { sessionId, type, detail, timestamp });
	if (!sessionId || !type || !timestamp) {
		console.warn('Missing required fields:', req.body);
		return res.status(400).json({ error: 'Missing required fields' });
	}
	try {
		await db.collection('events').insertOne({ sessionId, type, detail, timestamp });
		console.log('Event inserted to DB');
		res.json({ status: 'ok' });
	} catch (err) {
		console.error('DB error on insert:', err);
		res.status(500).json({ error: 'DB error', details: err.message });
	}
});

// GET /api/reports/:sessionId - get all events for a session

app.get('/api/reports/:sessionId', async (req, res) => {
	const { sessionId } = req.params;
	try {
		const events = await db.collection('events').find({ sessionId }).sort({ timestamp: 1 }).toArray();
		res.json({ sessionId, events });
	} catch (err) {
		res.status(500).json({ error: 'DB error', details: err.message });
	}
});


