import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'perfect-moments.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS journeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    current_stage TEXT DEFAULT 'reflection',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS moments (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL REFERENCES journeys(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 5),
    title TEXT NOT NULL,
    story TEXT,
    location TEXT,
    people TEXT,
    emotions TEXT,
    senses TEXT,
    time_of_life TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(journey_id, slot)
  );

  CREATE TABLE IF NOT EXISTS realizations (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL REFERENCES journeys(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    insight TEXT NOT NULL,
    theme TEXT,
    related_moment_ids TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS principles (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL REFERENCES journeys(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    realization_id TEXT REFERENCES realizations(id),
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL REFERENCES journeys(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    principle_id TEXT REFERENCES principles(id),
    text TEXT NOT NULL,
    frequency TEXT DEFAULT 'daily',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Prepared statements
const stmts = {
  createUser: db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)'),
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),

  createJourney: db.prepare('INSERT INTO journeys (id, user_id) VALUES (?, ?)'),
  getJourney: db.prepare('SELECT * FROM journeys WHERE id = ? AND user_id = ?'),
  getJourneys: db.prepare('SELECT * FROM journeys WHERE user_id = ? ORDER BY created_at DESC'),
  updateJourneyStage: db.prepare('UPDATE journeys SET current_stage = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?'),

  upsertMoment: db.prepare(`
    INSERT INTO moments (id, journey_id, user_id, slot, title, story, location, people, emotions, senses, time_of_life)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(journey_id, slot) DO UPDATE SET
      title = excluded.title, story = excluded.story, location = excluded.location,
      people = excluded.people, emotions = excluded.emotions, senses = excluded.senses,
      time_of_life = excluded.time_of_life
  `),
  getMoments: db.prepare('SELECT * FROM moments WHERE journey_id = ? AND user_id = ? ORDER BY slot'),
  getMoment: db.prepare('SELECT * FROM moments WHERE id = ? AND user_id = ?'),

  createRealization: db.prepare('INSERT INTO realizations (id, journey_id, user_id, insight, theme, related_moment_ids) VALUES (?, ?, ?, ?, ?, ?)'),
  getRealizations: db.prepare('SELECT * FROM realizations WHERE journey_id = ? AND user_id = ? ORDER BY created_at'),
  deleteRealization: db.prepare('DELETE FROM realizations WHERE id = ? AND user_id = ?'),
  deleteJourneyRealizations: db.prepare('DELETE FROM realizations WHERE journey_id = ? AND user_id = ?'),

  createPrinciple: db.prepare('INSERT INTO principles (id, journey_id, user_id, realization_id, text) VALUES (?, ?, ?, ?, ?)'),
  getPrinciples: db.prepare('SELECT * FROM principles WHERE journey_id = ? AND user_id = ? ORDER BY created_at'),
  deletePrinciple: db.prepare('DELETE FROM principles WHERE id = ? AND user_id = ?'),

  createHabit: db.prepare('INSERT INTO habits (id, journey_id, user_id, principle_id, text, frequency) VALUES (?, ?, ?, ?, ?, ?)'),
  getHabits: db.prepare('SELECT * FROM habits WHERE journey_id = ? AND user_id = ? ORDER BY created_at'),
  updateHabit: db.prepare('UPDATE habits SET text = ?, frequency = ?, active = ? WHERE id = ? AND user_id = ?'),
  deleteHabit: db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?'),
};

export const users = {
  create(name, email) {
    const id = uuid();
    stmts.createUser.run(id, name, email);
    return stmts.getUser.get(id);
  },
  get(id) { return stmts.getUser.get(id); },
  getByEmail(email) { return stmts.getUserByEmail.get(email); },
  getOrCreate(name, email) {
    const existing = stmts.getUserByEmail.get(email);
    if (existing) return existing;
    return this.create(name, email);
  }
};

export const journeys = {
  create(userId) {
    const id = uuid();
    stmts.createJourney.run(id, userId);
    return stmts.getJourney.get(id, userId);
  },
  get(id, userId) { return stmts.getJourney.get(id, userId); },
  list(userId) { return stmts.getJourneys.all(userId); },
  updateStage(id, userId, stage) {
    stmts.updateJourneyStage.run(stage, id, userId);
    return stmts.getJourney.get(id, userId);
  }
};

export const moments = {
  upsert(journeyId, userId, slot, data) {
    const existing = stmts.getMoments.all(journeyId, userId).find(m => m.slot === slot);
    const id = existing?.id || uuid();
    stmts.upsertMoment.run(id, journeyId, userId, slot, data.title, data.story || null, data.location || null, data.people || null, data.emotions || null, data.senses || null, data.time_of_life || null);
    return stmts.getMoment.get(id, userId);
  },
  list(journeyId, userId) { return stmts.getMoments.all(journeyId, userId); },
};

export const realizations = {
  create(journeyId, userId, insight, theme, relatedMomentIds) {
    const id = uuid();
    stmts.createRealization.run(id, journeyId, userId, insight, theme || null, JSON.stringify(relatedMomentIds || []));
    return { id, journey_id: journeyId, user_id: userId, insight, theme, related_moment_ids: JSON.stringify(relatedMomentIds || []) };
  },
  list(journeyId, userId) {
    return stmts.getRealizations.all(journeyId, userId).map(r => ({
      ...r,
      related_moment_ids: JSON.parse(r.related_moment_ids || '[]')
    }));
  },
  delete(id, userId) { stmts.deleteRealization.run(id, userId); },
  clearForJourney(journeyId, userId) { stmts.deleteJourneyRealizations.run(journeyId, userId); },
};

export const principles = {
  create(journeyId, userId, realizationId, text) {
    const id = uuid();
    stmts.createPrinciple.run(id, journeyId, userId, realizationId, text);
    return { id, journey_id: journeyId, user_id: userId, realization_id: realizationId, text };
  },
  list(journeyId, userId) { return stmts.getPrinciples.all(journeyId, userId); },
  delete(id, userId) { stmts.deletePrinciple.run(id, userId); },
};

export const habits = {
  create(journeyId, userId, principleId, text, frequency = 'daily') {
    const id = uuid();
    stmts.createHabit.run(id, journeyId, userId, principleId, text, frequency);
    return { id, journey_id: journeyId, user_id: userId, principle_id: principleId, text, frequency, active: 1 };
  },
  list(journeyId, userId) { return stmts.getHabits.all(journeyId, userId); },
  update(id, userId, data) {
    stmts.updateHabit.run(data.text, data.frequency, data.active ? 1 : 0, id, userId);
  },
  delete(id, userId) { stmts.deleteHabit.run(id, userId); },
};

export default db;
