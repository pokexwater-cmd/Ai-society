const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const { resolveEventKnowledge } = require('./eventEngine');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Render's Postgres gives you a connection string as DATABASE_URL.
// SSL is required on Render's managed Postgres.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Simple health check — confirms the server AND the database are both alive
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      server_time: new Date().toISOString(),
      db_time: result.rows[0].now
    });
  } catch (err) {
    console.error('DB health check failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Runs schema.sql against the database. Safe to call more than once —
// every statement uses IF NOT EXISTS / ON CONFLICT so it won't wipe existing data.
app.get('/setup', async (req, res) => {
  try {
    const sql = fs.readFileSync('./schema.sql', 'utf8');
    await pool.query(sql);
    res.json({ status: 'ok', message: 'Schema created successfully.' });
  } catch (err) {
    console.error('Setup failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Lists all tables that currently exist, so you can confirm setup worked.
app.get('/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    res.json({ status: 'ok', tables: result.rows.map(r => r.table_name) });
  } catch (err) {
    console.error('Table list failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Runs seed.sql — inserts the 3 starting characters, their state, and relationships.
// Only run this ONCE. Running it twice creates duplicate characters (we'll add
// a safety check for that in a later step).
app.get('/seed', async (req, res) => {
  try {
    const sql = fs.readFileSync('./seed.sql', 'utf8');
    await pool.query(sql);
    res.json({ status: 'ok', message: 'Characters seeded successfully.' });
  } catch (err) {
    console.error('Seed failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Shows all characters with their current state, so you can confirm they exist
// and look right, before any game logic touches them.
app.get('/characters', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.personality, c.values_priority, c.fears, c.goals, c.skills,
        s.location, s.money, s.mood
      FROM characters c
      JOIN character_state s ON s.character_id = c.id
      ORDER BY c.id
    `);
    res.json({ status: 'ok', characters: result.rows });
  } catch (err) {
    console.error('Fetching characters failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// TEST ROUTE for Step 4: triggers a sample event ("someone stole coins")
// and writes each character's resulting memory based on witness/rumor logic.
// This is temporary/manual — later steps will trigger events automatically.
app.get('/test-event', async (req, res) => {
  try {
    // Pull current character list + location
    const charResult = await pool.query(`
      SELECT c.id, c.name, s.location
      FROM characters c
      JOIN character_state s ON s.character_id = c.id
    `);
    const allCharacters = charResult.rows;

    if (allCharacters.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No characters found — run /seed first.' });
    }

    // Get current turn number
    const turnResult = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
    const currentTurn = turnResult.rows[0].current_turn;

    // Sample event: Karlos "steals" 20 coins at the Market, only witnessed
    // by whoever happens to be there. For this first test, let's put the
    // event at Town Square where everyone currently starts, then separately
    // test a Market-only event so you can see the difference.
    const karlos = allCharacters.find(c => c.name === 'Karlos');
    const event = {
      description: `${karlos.name} secretly took 20 coins from the shared market stall.`,
      location: 'Market',
      peopleInvolved: [karlos.id]
    };

    // Record ground truth in world_events regardless of who knows about it
    await pool.query(
      `INSERT INTO world_events (description, people_involved, turn_number) VALUES ($1, $2, $3)`,
      [event.description, event.peopleInvolved, currentTurn]
    );

    // Resolve who knows what
    const knowledgeResults = resolveEventKnowledge(event, allCharacters);

    // Write one memory row per character who ended up knowing something
    for (const entry of knowledgeResults) {
      await pool.query(
        `INSERT INTO memories (character_id, event_description, importance, emotion, people_involved, turn_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.character_id,
          entry.memory_text,
          entry.is_accurate ? 70 : 40,
          entry.source === 'witnessed' ? 'concern' : 'suspicion',
          event.peopleInvolved,
          currentTurn
        ]
      );
    }

    res.json({
      status: 'ok',
      event_location: event.location,
      note: 'Only characters physically at "Market" witness this directly — everyone else got a rumor roll (or nothing).',
      results: knowledgeResults
    });
  } catch (err) {
    console.error('Test event failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// View all memories currently stored, grouped by character — so you can see
// that different characters ended up believing different things.
app.get('/memories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, c.name AS character_name, m.event_description, m.importance,
             m.emotion, m.turn_number, m.created_at
      FROM memories m
      JOIN characters c ON c.id = m.character_id
      ORDER BY c.name, m.created_at
    `);
    res.json({ status: 'ok', memories: result.rows });
  } catch (err) {
    console.error('Fetching memories failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// TEST ROUTE: manually move a character to a location, so we can test
// witness-vs-rumor behavior (a character only witnesses events where they are).
// Usage: /move-character?name=Karlos&location=Market
app.get('/move-character', async (req, res) => {
  try {
    const { name, location } = req.query;
    if (!name || !location) {
      return res.status(400).json({ status: 'error', message: 'Provide ?name= and &location=' });
    }
    const result = await pool.query(
      `UPDATE character_state
       SET location = $1, updated_at = NOW()
       FROM characters c
       WHERE character_state.character_id = c.id AND c.name = $2
       RETURNING c.name, character_state.location`,
      [location, name]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: `Character "${name}" not found.` });
    }
    res.json({ status: 'ok', updated: result.rows[0] });
  } catch (err) {
    console.error('Move character failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI Society server running on port ${PORT}`);
});
