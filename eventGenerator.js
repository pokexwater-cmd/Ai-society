// eventGenerator.js — Step 7
//
// Picks a random event from a small template pool. Templates get filled in
// with a random character and location. Kept deliberately simple for v1 —
// no AI needed just to invent an event.

const TEMPLATES = [
  {
    describe: (actor) => `${actor.name} secretly took some coins from the shared stall.`,
    location: 'Market',
    type: 'theft'
  },
  {
    describe: (actor) => `${actor.name} was seen helping a stranger carry heavy goods.`,
    location: 'Market',
    type: 'kindness'
  },
  {
    describe: (actor) => `${actor.name} loudly argued with a merchant over prices.`,
    location: 'Market',
    type: 'conflict'
  },
  {
    describe: (actor) => `${actor.name} shared a rumor about someone in town.`,
    location: 'Tavern',
    type: 'gossip'
  },
  {
    describe: (actor) => `${actor.name} found a small pouch of coins on the ground and kept it.`,
    location: 'Town Square',
    type: 'theft'
  },
  {
    describe: (actor) => `${actor.name} offered to fix a broken cart for free.`,
    location: 'Town Square',
    type: 'kindness'
  }
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generates one random event involving a random character from the list.
 * @param {array} allCharacters - [{ id, name }, ...]
 */
function generateRandomEvent(allCharacters) {
  const template = pickRandom(TEMPLATES);
  const actor = pickRandom(allCharacters);

  return {
    description: template.describe(actor),
    location: template.location,
    peopleInvolved: [actor.id],
    type: template.type
  };
}

module.exports = { generateRandomEvent };
