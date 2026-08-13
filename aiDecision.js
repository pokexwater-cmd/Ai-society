// aiDecision.js — Step 5
//
// Builds a compact context payload for ONE character and asks Gemini for a
// structured JSON decision. This keeps API usage cheap: we only send this
// character's own traits + their most relevant memories + the current
// situation — never the whole world history.

const GEMINI_MODEL = 'gemini-3.6-flash';

function buildPrompt(character, relevantMemories, relationships, situation, availableActions) {
  const memoriesText = relevantMemories.length > 0
    ? relevantMemories.map(m => `- ${m.event_description} (emotion: ${m.emotion || 'neutral'})`).join('\n')
    : '- No relevant memories.';

  const relationshipsText = relationships.length > 0
    ? relationships.map(r => `- Trusts ${r.target_name}: ${r.trust}/100, feels ${r.affinity}/100 toward them`).join('\n')
    : '- No relationship data.';

  return `You are roleplaying a character's DECISION-MAKING inside a life simulation. Respond with ONLY valid JSON, no other text.

CHARACTER: ${character.name}
PERSONALITY: ${character.personality}
VALUES (priority order): ${character.values_priority}
GOALS: ${character.goals}
FEARS: ${character.fears}
SKILLS: ${character.skills}

RELATIONSHIPS:
${relationshipsText}

RELEVANT MEMORIES (what this character personally knows/believes):
${memoriesText}

CURRENT SITUATION:
${situation}

AVAILABLE ACTIONS:
${availableActions.join(', ')}

Choose the ONE action that best fits this character's personality, values, fears, goals, and what they actually know (not what you know as the narrator — only what's in their memories above).

Respond with ONLY this JSON structure, nothing else:
{
  "action": "one of the available actions",
  "target": "character name this action targets, or null if none",
  "emotion": "the character's current emotional reaction",
  "reason_summary": "one short, game-facing sentence explaining why (no chain-of-thought, just the gist)"
}`;
}

async function getCharacterDecision(character, relevantMemories, relationships, situation, availableActions, apiKey) {
  const prompt = buildPrompt(character, relevantMemories, relationships, situation, availableActions);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Gemini API error');
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Gemini sometimes wraps JSON in ```json fences — strip those if present
  const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('Could not parse Gemini response as JSON: ' + rawText);
  }

  return parsed;
}

module.exports = { getCharacterDecision, buildPrompt };
