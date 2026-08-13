// aiDecision.js — Step 5, upgraded in Step 9.5 to use multi-provider fallback
//
// Builds a compact context payload for ONE character and asks an AI provider
// (with automatic fallback across 4 providers) for a structured JSON decision.
// This keeps API usage cheap: we only send this character's own traits +
// their most relevant memories + the current situation — never the whole
// world history.

const { getDecisionWithFallback } = require('./aiProviders');

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

// keys = { gemini, groq, openrouter, cohere }
async function getCharacterDecision(character, relevantMemories, relationships, situation, availableActions, keys) {
  const prompt = buildPrompt(character, relevantMemories, relationships, situation, availableActions);
  const { decision, providerUsed } = await getDecisionWithFallback(prompt, keys);
  return { ...decision, _provider: providerUsed };
}

module.exports = { getCharacterDecision, buildPrompt };
