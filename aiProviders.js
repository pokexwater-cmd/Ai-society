// aiProviders.js — Step 9.5 (resilience upgrade)
//
// Tries multiple AI providers in order until one succeeds. This solves the
// "hit a rate limit and the whole turn breaks" problem by falling back to a
// different provider instead of failing outright.
//
// Order: Gemini -> Groq -> OpenRouter -> Cohere
// Each provider has its own request/response shape; we normalize all of them
// down to a single plain-text response, then parse JSON the same way regardless
// of which provider produced it.

function cleanJsonText(rawText) {
  return rawText.replace(/```json/g, '').replace(/```/g, '').trim();
}

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Gemini error');
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callGroq(prompt, apiKey) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq error');
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenRouter(prompt, apiKey) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenRouter error');
  return data.choices?.[0]?.message?.content || '';
}

async function callCohere(prompt, apiKey) {
  const response = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'command-r-plus',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Cohere error');
  return data.message?.content?.[0]?.text || '';
}

/**
 * Tries each configured provider in order. Returns the FIRST successful
 * parsed JSON response. Throws only if ALL providers fail.
 *
 * @param {string} prompt
 * @param {object} keys - { gemini, groq, openrouter, cohere } — any may be undefined
 */
async function getDecisionWithFallback(prompt, keys) {
  const attempts = [
    { name: 'gemini', key: keys.gemini, fn: callGemini },
    { name: 'groq', key: keys.groq, fn: callGroq },
    { name: 'openrouter', key: keys.openrouter, fn: callOpenRouter },
    { name: 'cohere', key: keys.cohere, fn: callCohere }
  ];

  const errors = [];

  for (const attempt of attempts) {
    if (!attempt.key) {
      errors.push(`${attempt.name}: no API key configured`);
      continue;
    }
    try {
      const rawText = await attempt.fn(prompt, attempt.key);
      const cleaned = cleanJsonText(rawText);
      const parsed = JSON.parse(cleaned);
      return { decision: parsed, providerUsed: attempt.name };
    } catch (err) {
      errors.push(`${attempt.name}: ${err.message}`);
      // try next provider
    }
  }

  throw new Error('All providers failed: ' + errors.join(' | '));
}

module.exports = { getDecisionWithFallback };
