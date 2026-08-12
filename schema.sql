-- AI Society Simulator — Step 2: Core tables
-- Run this once to set up the database structure.

-- Characters: static-ish identity (personality, values, fears, goals)
CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  personality TEXT NOT NULL,          -- short description, e.g. "curious, risk-taking, low empathy"
  values_priority TEXT NOT NULL,      -- e.g. "power > money > friendship > safety"
  fears TEXT NOT NULL,                -- e.g. "losing control, being humiliated"
  goals TEXT NOT NULL,                -- e.g. "become powerful, gain influence"
  skills TEXT,                        -- e.g. "persuasion, trading"
  created_at TIMESTAMP DEFAULT NOW()
);

-- Character state: things that change often (location, money, mood)
CREATE TABLE IF NOT EXISTS character_state (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  location TEXT NOT NULL DEFAULT 'Town Square',
  money INTEGER NOT NULL DEFAULT 50,
  mood TEXT NOT NULL DEFAULT 'neutral',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Relationships: how each character feels about every other character
CREATE TABLE IF NOT EXISTS relationships (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  target_character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  trust INTEGER NOT NULL DEFAULT 50,   -- 0-100
  affinity INTEGER NOT NULL DEFAULT 50, -- 0-100 (like/dislike)
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(character_id, target_character_id)
);

-- Memories: what a SPECIFIC character personally knows/believes
-- (this is what makes knowledge different per character)
CREATE TABLE IF NOT EXISTS memories (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  event_description TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 50,  -- 0-100
  emotion TEXT,                             -- e.g. "distrust", "gratitude"
  people_involved INTEGER[] DEFAULT '{}',   -- array of character ids referenced
  turn_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- World events: ground-truth log of what actually happened (not per-character belief)
CREATE TABLE IF NOT EXISTS world_events (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  people_involved INTEGER[] DEFAULT '{}',
  turn_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- World state: single-row table tracking global simulation state
CREATE TABLE IF NOT EXISTS world_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_turn INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Ensure the single world_state row exists
INSERT INTO world_state (id, current_turn)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;
