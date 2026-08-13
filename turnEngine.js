// turnEngine.js — Step 7
//
// Runs one full turn:
// 1. Generate an event
// 2. Resolve who knows what (witness/rumor) — writes memories
// 3. Only characters who gained a NEW memory this turn get an AI decision
//    (this is the API-cost control: unaffected characters cost nothing)
// 4. Apply each decision's effects
// 5. Return a summary for the event log

const { generateRandomEvent } = require('./eventGenerator');
const { resolveEventKnowledge } = require('./eventEngine');
const { getCharacterDecision } = require('./aiDecision');
const { applyDecision } = require('./actionResolver');

const DEFAULT_ACTIONS = ['investigate', 'accuse someone', 'ignore it', 'protect himself', 'make an alliance', 'try to recover the money'];

async function runTurn(pool, keys) {
  const summary = { turn: null, event: null, affected_characters: [], decisions: [] };

  // 1. Advance turn counter
  const turnResult = await pool.query(
    `UPDATE world_state SET current_turn = current_turn + 1 WHERE id = 1 RETURNING current_turn`
  );
  const currentTurn = turnResult.rows[0].current_turn;
  summary.turn = currentTurn;

  // 2. Get current character + location state
  const charStateResult = await pool.query(`
    SELECT c.id, c.name, c.personality, c.values_priority, c.fears, c.goals, c.skills,
           s.location, s.money, s.mood
    FROM characters c JOIN character_state s ON s.character_id = c.id
  `);
  const allCharacters = charStateResult.rows;

  if (allCharacters.length === 0) {
    throw new Error('No characters found — run /seed first.');
  }

  // 3. Generate this turn's event
  const event = generateRandomEvent(allCharacters);
  summary.event = event;

  await pool.query(
    `INSERT INTO world_events (description, people_involved, turn_number) VALUES ($1, $2, $3)`,
    [event.description, event.peopleInvolved, currentTurn]
  );

  // 4. Resolve who knows what — writes memories, returns list of affected character IDs
  const knowledgeResults = resolveEventKnowledge(event, allCharacters);

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

  const affectedIds = [...new Set(knowledgeResults.map(r => r.character_id))];
  summary.affected_characters = affectedIds.map(id => allCharacters.find(c => c.id === id)?.name);

  // 5. Only affected characters get an AI decision — this is the cost control.
  for (const charId of affectedIds) {
    const character = allCharacters.find(c => c.id === charId);
    if (!character) continue;

    const memResult = await pool.query(
      `SELECT event_description, emotion, importance
       FROM memories WHERE character_id = $1
       ORDER BY importance DESC, created_at DESC LIMIT 8`,
      [character.id]
    );

    const relResult = await pool.query(
      `SELECT r.trust, r.affinity, c2.name AS target_name
       FROM relationships r JOIN characters c2 ON c2.id = r.target_character_id
       WHERE r.character_id = $1`,
      [character.id]
    );

    const situation = `Recent event: ${event.description}`;

    try {
      const decision = await getCharacterDecision(
        character, memResult.rows, relResult.rows, situation, DEFAULT_ACTIONS, keys
      );
      const effects = await applyDecision(pool, character, decision, allCharacters, currentTurn);

      summary.decisions.push({ character: character.name, decision, effects });
    } catch (err) {
      console.error(`Decision failed for ${character.name}:`, err.message);
      summary.decisions.push({ character: character.name, error: err.message });
    }
  }

  return summary;
}

module.exports = { runTurn };
