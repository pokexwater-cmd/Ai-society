-- AI Society Simulator — Step 3: Seed starting characters
-- Safe to run once. Running it twice will create duplicates (we'll add
-- protection for that in a later step) — for now, just run it a single time.

-- 1. Captain K
INSERT INTO characters (name, personality, values_priority, fears, goals, skills)
VALUES (
  'Captain K',
  'Jokey, extremely smart, lazy — enjoys life and rarely takes things too seriously',
  'chai > relaxed enjoyment > close relationships',
  'Losing the people close to him',
  'End evil',
  'Very intelligent, good at almost anything'
);

-- 2. Alisha
INSERT INTO characters (name, personality, values_priority, fears, goals, skills)
VALUES (
  'Alisha',
  'Serious, brave, principled',
  'making the world better > family > safety',
  'Losing the people close to her',
  'Make the world a better place; give her grandparents a good life',
  'Good at judging and reading people'
);

-- 3. Karlos
INSERT INTO characters (name, personality, values_priority, fears, goals, skills)
VALUES (
  'Karlos',
  'Serious, calm, thinks before speaking',
  'his father''s legacy > personal competence > caution',
  'Facing a big problem he cannot solve',
  'Fulfill his father''s dream',
  'Very intelligent, broadly skilled'
);

-- Starting state (location, money, mood) for each — using subqueries so we
-- don't have to hardcode IDs.
INSERT INTO character_state (character_id, location, money, mood)
SELECT id, 'Town Square', 100, 'relaxed' FROM characters WHERE name = 'Captain K';

INSERT INTO character_state (character_id, location, money, mood)
SELECT id, 'Town Square', 15000, 'determined' FROM characters WHERE name = 'Alisha';

INSERT INTO character_state (character_id, location, money, mood)
SELECT id, 'Town Square', 230, 'calm' FROM characters WHERE name = 'Karlos';

-- Starting relationships — every character gets a row toward every OTHER character.
-- Default trust/affinity = 50 (neutral), except Alisha → Captain K, which starts higher.

-- Captain K's relationships
INSERT INTO relationships (character_id, target_character_id, trust, affinity)
SELECT c1.id, c2.id, 50, 50
FROM characters c1, characters c2
WHERE c1.name = 'Captain K' AND c2.name != 'Captain K';

-- Alisha's relationships (higher affinity toward Captain K)
INSERT INTO relationships (character_id, target_character_id, trust, affinity)
SELECT c1.id, c2.id, 50, CASE WHEN c2.name = 'Captain K' THEN 75 ELSE 50 END
FROM characters c1, characters c2
WHERE c1.name = 'Alisha' AND c2.name != 'Alisha';

-- Karlos's relationships
INSERT INTO relationships (character_id, target_character_id, trust, affinity)
SELECT c1.id, c2.id, 50, 50
FROM characters c1, characters c2
WHERE c1.name = 'Karlos' AND c2.name != 'Karlos';
