// actionResolver.js — Step 6
//
// Takes a structured decision (from aiDecision.js) and actually applies its
// consequences to the world: relationship changes, mood changes, and a new
// memory recording what the character DID (as opposed to what they KNEW
// before deciding). This is what makes actions have real, lasting effects.

const RELATIONSHIP_CHANGE = {
  accuse: -20,     // accusing someone drops trust/affinity between accuser and target
  ally: 15,        // making an alliance boosts trust/affinity both ways
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Applies a character's decision to the world via direct DB queries.
 * @param {object} pool - pg connection pool
 * @param {object} character - the deciding character's row (id, name, mood, ...)
 * @param {object} decision - { action, target, emotion, reason_summary }
 * @param {array} allCharacters - full character list (to resolve target name -> id)
 * @param {number} currentTurn
 */
async function applyDecision(pool, character, decision, allCharacters, currentTurn) {
  const action = (decision.action || '').toLowerCase();
  const targetCharacter = decision.target
    ? allCharacters.find(c => c.name.toLowerCase() === decision.target.toLowerCase())
    : null;

  const effects = { relationshipChanges: [], moodChange: null };

  // 1. Update mood based on the emotion Gemini reported
  if (decision.emotion) {
    await pool.query(
      `UPDATE character_state SET mood = $1, updated_at = NOW() WHERE character_id = $2`,
      [decision.emotion, character.id]
    );
    effects.moodChange = decision.emotion;
  }

  // 2. Action-specific world effects
  if (action.includes('accuse') && targetCharacter) {
    await adjustRelationship(pool, character.id, targetCharacter.id, RELATIONSHIP_CHANGE.accuse);
    await adjustRelationship(pool, targetCharacter.id, character.id, RELATIONSHIP_CHANGE.accuse);
    effects.relationshipChanges.push({
      between: [character.name, targetCharacter.name],
      change: RELATIONSHIP_CHANGE.accuse
    });

    // The accused character gets their own memory of being accused —
    // this is a NEW piece of knowledge for them, created by this action.
    await pool.query(
      `INSERT INTO memories (character_id, event_description, importance, emotion, people_involved, turn_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        targetCharacter.id,
        `${character.name} accused me of being involved in the missing coins.`,
        75,
        'hurt',
        [character.id],
        currentTurn
      ]
    );
  }

  if (action.includes('alliance') && targetCharacter) {
    await adjustRelationship(pool, character.id, targetCharacter.id, RELATIONSHIP_CHANGE.ally);
    await adjustRelationship(pool, targetCharacter.id, character.id, RELATIONSHIP_CHANGE.ally);
    effects.relationshipChanges.push({
      between: [character.name, targetCharacter.name],
      change: RELATIONSHIP_CHANGE.ally
    });

    await pool.query(
      `INSERT INTO memories (character_id, event_description, importance, emotion, people_involved, turn_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        targetCharacter.id,
        `${character.name} proposed an alliance with me.`,
        60,
        'hopeful',
        [character.id],
        currentTurn
      ]
    );
  }

  // 3. Always record what the ACTING character did, as a new memory of
  // their own action (so future decisions can reference "I already tried X")
  await pool.query(
    `INSERT INTO memories (character_id, event_description, importance, emotion, people_involved, turn_number)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      character.id,
      `I chose to ${decision.action}${targetCharacter ? ' (targeting ' + targetCharacter.name + ')' : ''}. ${decision.reason_summary || ''}`,
      55,
      decision.emotion || 'neutral',
      targetCharacter ? [targetCharacter.id] : [],
      currentTurn
    ]
  );

  return effects;
}

async function adjustRelationship(pool, fromId, toId, delta) {
  await pool.query(
    `UPDATE relationships
     SET trust = LEAST(100, GREATEST(0, trust + $1)),
         affinity = LEAST(100, GREATEST(0, affinity + $1)),
         updated_at = NOW()
     WHERE character_id = $2 AND target_character_id = $3`,
    [delta, fromId, toId]
  );
}

module.exports = { applyDecision };
