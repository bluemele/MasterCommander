import express from 'express';
import cors from 'cors';
import { users, journeys, moments, realizations, principles, habits } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Simple auth middleware - uses x-user-id header
function auth(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = users.get(userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

// --- Users ---
app.post('/api/users', (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  try {
    const user = users.getOrCreate(name, email);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Journeys ---
app.post('/api/journeys', auth, (req, res) => {
  const journey = journeys.create(req.user.id);
  res.json(journey);
});

app.get('/api/journeys', auth, (req, res) => {
  res.json(journeys.list(req.user.id));
});

app.get('/api/journeys/:id', auth, (req, res) => {
  const journey = journeys.get(req.params.id, req.user.id);
  if (!journey) return res.status(404).json({ error: 'Journey not found' });
  res.json(journey);
});

app.patch('/api/journeys/:id/stage', auth, (req, res) => {
  const { stage } = req.body;
  const valid = ['reflection', 'realizations', 'planning', 'complete'];
  if (!valid.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const journey = journeys.updateStage(req.params.id, req.user.id, stage);
  res.json(journey);
});

// --- Moments ---
app.put('/api/journeys/:journeyId/moments/:slot', auth, (req, res) => {
  const slot = parseInt(req.params.slot);
  if (slot < 1 || slot > 5) return res.status(400).json({ error: 'Slot must be 1-5' });
  const { title, story, location, people, emotions, senses, time_of_life } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const moment = moments.upsert(req.params.journeyId, req.user.id, slot, {
    title, story, location, people, emotions, senses, time_of_life
  });
  res.json(moment);
});

app.get('/api/journeys/:journeyId/moments', auth, (req, res) => {
  res.json(moments.list(req.params.journeyId, req.user.id));
});

// --- Realizations ---
app.post('/api/journeys/:journeyId/realizations', auth, (req, res) => {
  const { insight, theme, related_moment_ids } = req.body;
  if (!insight) return res.status(400).json({ error: 'Insight required' });
  const r = realizations.create(req.params.journeyId, req.user.id, insight, theme, related_moment_ids);
  res.json(r);
});

app.get('/api/journeys/:journeyId/realizations', auth, (req, res) => {
  res.json(realizations.list(req.params.journeyId, req.user.id));
});

app.delete('/api/journeys/:journeyId/realizations/:id', auth, (req, res) => {
  realizations.delete(req.params.id, req.user.id);
  res.json({ ok: true });
});

// --- Principles ---
app.post('/api/journeys/:journeyId/principles', auth, (req, res) => {
  const { realization_id, text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const p = principles.create(req.params.journeyId, req.user.id, realization_id, text);
  res.json(p);
});

app.get('/api/journeys/:journeyId/principles', auth, (req, res) => {
  res.json(principles.list(req.params.journeyId, req.user.id));
});

app.delete('/api/journeys/:journeyId/principles/:id', auth, (req, res) => {
  principles.delete(req.params.id, req.user.id);
  res.json({ ok: true });
});

// --- Habits ---
app.post('/api/journeys/:journeyId/habits', auth, (req, res) => {
  const { principle_id, text, frequency } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const h = habits.create(req.params.journeyId, req.user.id, principle_id, text, frequency);
  res.json(h);
});

app.get('/api/journeys/:journeyId/habits', auth, (req, res) => {
  res.json(habits.list(req.params.journeyId, req.user.id));
});

app.patch('/api/journeys/:journeyId/habits/:id', auth, (req, res) => {
  habits.update(req.params.id, req.user.id, req.body);
  res.json({ ok: true });
});

app.delete('/api/journeys/:journeyId/habits/:id', auth, (req, res) => {
  habits.delete(req.params.id, req.user.id);
  res.json({ ok: true });
});

// --- Full journey snapshot ---
app.get('/api/journeys/:id/full', auth, (req, res) => {
  const journey = journeys.get(req.params.id, req.user.id);
  if (!journey) return res.status(404).json({ error: 'Journey not found' });
  res.json({
    ...journey,
    moments: moments.list(req.params.id, req.user.id),
    realizations: realizations.list(req.params.id, req.user.id),
    principles: principles.list(req.params.id, req.user.id),
    habits: habits.list(req.params.id, req.user.id),
  });
});

app.listen(PORT, () => {
  console.log(`Perfect Moments API running on http://localhost:${PORT}`);
});
