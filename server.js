const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
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

app.listen(PORT, () => {
  console.log(`AI Society server running on port ${PORT}`);
});
