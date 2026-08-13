const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const { resolveEventKnowledge } = require('./eventEngine');
const { getCharacterDecision } = require('./aiDecision');
const { applyDecision } = require('./actionResolver');
const { runTurn } = require('./turnEngine');
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

// TEST ROUTE for Step 5: gets ONE character's AI decision about the coin
// theft situation, using their own memories + relationships. Does NOT apply
// the result to the world yet — just logs what Gemini decided.
// Usage: /test-decision?name=Karlos
app.get('/test-decision', async (req, res) => {
  try {
    const name = req.query.name || 'Karlos';

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ status: 'error', message: 'Server missing GEMINI_API_KEY' });
    }

    // Get the character's own data
    const charResult = await pool.query(
      `SELECT c.*, s.location, s.money, s.mood
       FROM characters c JOIN character_state s ON s.character_id = c.id
       WHERE c.name = $1`,
      [name]
    );
    if (charResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: `Character "${name}" not found.` });
    }
    const character = charResult.rows[0];

    // Get this character's memories (v1: just their most recent/important ones)
    const memResult = await pool.query(
      `SELECT event_description, emotion, importance
       FROM memories WHERE character_id = $1
       ORDER BY importance DESC, created_at DESC LIMIT 8`,
      [character.id]
    );

    // Get this character's relationships with named targets
    const relResult = await pool.query(
      `SELECT r.trust, r.affinity, c2.name AS target_name
       FROM relationships r
       JOIN characters c2 ON c2.id = r.target_character_id
       WHERE r.character_id = $1`,
      [character.id]
    );

    const situation = `100 coins were reported missing from the shared market stall this morning.`;
    const availableActions = ['investigate', 'accuse someone', 'ignore it', 'protect himself', 'make an alliance', 'try to recover the money'];

    const decision = await getCharacterDecision(
      character,
      memResult.rows,
      relResult.rows,
      situation,
      availableActions,
      process.env.GEMINI_API_KEY
    );

    res.json({
      status: 'ok',
      character: character.name,
      memories_used: memResult.rows,
      relationships_used: relResult.rows,
      decision
    });
  } catch (err) {
    console.error('Test decision failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// TEST ROUTE for Step 6: gets a character's AI decision AND applies its
// effects to the world (relationships, mood, memories) — not just logging.
// Usage: /test-apply?name=Karlos
app.get('/test-apply', async (req, res) => {
  try {
    const name = req.query.name || 'Karlos';

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ status: 'error', message: 'Server missing GEMINI_API_KEY' });
    }

    const charResult = await pool.query(
      `SELECT c.*, s.location, s.money, s.mood
       FROM characters c JOIN character_state s ON s.character_id = c.id
       WHERE c.name = $1`,
      [name]
    );
    if (charResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: `Character "${name}" not found.` });
    }
    const character = charResult.rows[0];

    const allCharResult = await pool.query('SELECT id, name FROM characters');
    const allCharacters = allCharResult.rows;

    const memResult = await pool.query(
      `SELECT event_description, emotion, importance
       FROM memories WHERE character_id = $1
       ORDER BY importance DESC, created_at DESC LIMIT 8`,
      [character.id]
    );

    const relResult = await pool.query(
      `SELECT r.trust, r.affinity, c2.name AS target_name
       FROM relationships r
       JOIN characters c2 ON c2.id = r.target_character_id
       WHERE r.character_id = $1`,
      [character.id]
    );

    const turnResult = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
    const currentTurn = turnResult.rows[0].current_turn;

    const situation = `100 coins were reported missing from the shared market stall this morning.`;
    const availableActions = ['investigate', 'accuse someone', 'ignore it', 'protect himself', 'make an alliance', 'try to recover the money'];

    const decision = await getCharacterDecision(
      character, memResult.rows, relResult.rows, situation, availableActions, process.env.GEMINI_API_KEY
    );

    const effects = await applyDecision(pool, character, decision, allCharacters, currentTurn);

    res.json({ status: 'ok', character: character.name, decision, effects_applied: effects });
  } catch (err) {
    console.error('Test apply failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// View all relationships, so you can confirm they changed after an action.
app.get('/relationships', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c1.name AS from_character, c2.name AS to_character, r.trust, r.affinity
      FROM relationships r
      JOIN characters c1 ON c1.id = r.character_id
      JOIN characters c2 ON c2.id = r.target_character_id
      ORDER BY c1.name, c2.name
    `);
    res.json({ status: 'ok', relationships: result.rows });
  } catch (err) {
    console.error('Fetching relationships failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// THE REAL TURN ROUTE — Step 7.
// Runs one full automatic turn: generates an event, figures out who's
// affected, only calls AI for those characters, applies their decisions.
app.get('/run-turn', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ status: 'error', message: 'Server missing GEMINI_API_KEY' });
    }
    const summary = await runTurn(pool, process.env.GEMINI_API_KEY);
    res.json({ status: 'ok', summary });
  } catch (err) {
    console.error('Run turn failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Recent world events, for the live event log in the UI.
app.get('/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, description, turn_number, created_at
      FROM world_events
      ORDER BY turn_number DESC, created_at DESC
      LIMIT 30
    `);
    res.json({ status: 'ok', events: result.rows });
  } catch (err) {
    console.error('Fetching events failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ===== PLAYER INTERVENTIONS (Step 9) — "god mode" actions =====
// All of these use POST since they change world state, not just view it.

// Give or take money. Body: { name, amount } — amount can be negative.
app.post('/intervene/money', async (req, res) => {
  try {
    const { name, amount } = req.body;
    if (!name || amount === undefined) {
      return res.status(400).json({ status: 'error', message: 'Provide name and amount.' });
    }
    const result = await pool.query(
      `UPDATE character_state
       SET money = GREATEST(0, money + $1), updated_at = NOW()
       FROM characters c
       WHERE character_state.character_id = c.id AND c.name = $2
       RETURNING c.name, character_state.money`,
      [amount, name]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: `Character "${name}" not found.` });
    }
    res.json({ status: 'ok', updated: result.rows[0] });
  } catch (err) {
    console.error('Intervene money failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Move a character. Body: { name, location }
app.post('/intervene/move', async (req, res) => {
  try {
    const { name, location } = req.body;
    if (!name || !location) {
      return res.status(400).json({ status: 'error', message: 'Provide name and location.' });
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
    console.error('Intervene move failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Trigger a custom event with player-written text. Body: { description, location }
// Goes through the same witness/rumor resolution as automatic events.
app.post('/intervene/event', async (req, res) => {
  try {
    const { description, location } = req.body;
    if (!description || !location) {
      return res.status(400).json({ status: 'error', message: 'Provide description and location.' });
    }

    const charResult = await pool.query(`
      SELECT c.id, c.name, s.location
      FROM characters c JOIN character_state s ON s.character_id = c.id
    `);
    const allCharacters = charResult.rows;

    const turnResult = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
    const currentTurn = turnResult.rows[0].current_turn;

    const event = { description, location, peopleInvolved: [] };

    await pool.query(
      `INSERT INTO world_events (description, people_involved, turn_number) VALUES ($1, $2, $3)`,
      [event.description, event.peopleInvolved, currentTurn]
    );

    const knowledgeResults = resolveEventKnowledge(event, allCharacters);
    for (const entry of knowledgeResults) {
      await pool.query(
        `INSERT INTO memories (character_id, event_description, importance, emotion, people_involved, turn_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.character_id, entry.memory_text, entry.is_accurate ? 70 : 40,
         entry.source === 'witnessed' ? 'concern' : 'suspicion', event.peopleInvolved, currentTurn]
      );
    }

    res.json({ status: 'ok', event, affected: knowledgeResults.map(r => r.character_id) });
  } catch (err) {
    console.error('Intervene event failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Give a character a SECRET memory only they know. Body: { name, memoryText }
app.post('/intervene/secret', async (req, res) => {
  try {
    const { name, memoryText } = req.body;
    if (!name || !memoryText) {
      return res.status(400).json({ status: 'error', message: 'Provide name and memoryText.' });
    }
    const charResult = await pool.query('SELECT id FROM characters WHERE name = $1', [name]);
    if (charResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: `Character "${name}" not found.` });
    }
    const characterId = charResult.rows[0].id;

    const turnResult = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
    const currentTurn = turnResult.rows[0].current_turn;

    await pool.query(
      `INSERT INTO memories (character_id, event_description, importance, emotion, people_involved, turn_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [characterId, memoryText, 80, 'secret', [], currentTurn]
    );

    res.json({ status: 'ok', message: `Secret memory given to ${name}.` });
  } catch (err) {
    console.error('Intervene secret failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI Society server running on port ${PORT}`);
});
