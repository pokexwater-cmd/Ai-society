// eventEngine.js — Step 4
//
// Takes a "ground truth" event and figures out, per character, what THEY
// personally end up believing happened. This is what makes characters have
// different knowledge of the same event.
//
// Rules for v1 (kept deliberately simple):
// - Characters physically AT the event's location witness it directly and
//   get the true description.
// - Characters NOT at the location have a chance to hear a rumor instead —
//   a rumor may be accurate, vague, or wrong about who was involved.
// - Some characters may hear nothing at all this turn (info hasn't spread yet).

const RUMOR_HEAR_CHANCE = 0.6;   // chance a non-witness hears about it at all
const RUMOR_ACCURATE_CHANCE = 0.5; // if they hear about it, chance it's accurate vs distorted

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Processes one event against the full character list and returns
 * an array of { character_id, memory_text, is_accurate, source } —
 * one entry per character who ends up with SOME memory of this event.
 * Characters who hear nothing are simply left out.
 *
 * @param {object} event - { description, location, peopleInvolved: [character_id,...] }
 * @param {array} allCharacters - [{ id, name, location }, ...] current state of every character
 */
function resolveEventKnowledge(event, allCharacters) {
  const results = [];

  for (const character of allCharacters) {
    const wasPresent = character.location === event.location;

    if (wasPresent) {
      // Direct witness — accurate memory, high importance
      results.push({
        character_id: character.id,
        memory_text: event.description,
        is_accurate: true,
        source: 'witnessed'
      });
      continue;
    }

    // Not present — maybe they hear a rumor
    const hearsAboutIt = Math.random() < RUMOR_HEAR_CHANCE;
    if (!hearsAboutIt) continue; // no memory created this turn

    const isAccurate = Math.random() < RUMOR_ACCURATE_CHANCE;

    if (isAccurate) {
      results.push({
        character_id: character.id,
        memory_text: `Heard that: ${event.description}`,
        is_accurate: true,
        source: 'rumor_accurate'
      });
    } else {
      // Distort the rumor: if there were multiple people involved,
      // rumor might blame/credit the wrong one.
      let distorted = event.description;
      if (event.peopleInvolved && event.peopleInvolved.length > 1) {
        const otherCharacters = allCharacters.filter(
          c => !event.peopleInvolved.includes(c.id) && c.id !== character.id
        );
        if (otherCharacters.length > 0) {
          const scapegoat = pickRandom(otherCharacters);
          distorted = `Heard a rumor (possibly wrong) that ${scapegoat.name} was involved in: ${event.description}`;
        } else {
          distorted = `Heard a vague, possibly wrong rumor about: ${event.description}`;
        }
      } else {
        distorted = `Heard a vague, possibly wrong rumor about: ${event.description}`;
      }

      results.push({
        character_id: character.id,
        memory_text: distorted,
        is_accurate: false,
        source: 'rumor_distorted'
      });
    }
  }

  return results;
}

module.exports = { resolveEventKnowledge };
