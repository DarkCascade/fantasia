'use strict';

const fs = require('fs');
const path = require('path');

let _index = null;
function loadIndex() {
  if (!_index) {
    _index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'index', 'gems.json'), 'utf8'));
  }
  return _index;
}

// Support gems come in tiers, each a distinct entry with its own id and a
// Roman-numeral display name ("Brutality" tier 1 has no suffix; "Burgeon
// II", "Ignite III" are tiers 2/3) — so an exact case-insensitive match on
// `name` naturally picks the right tier as long as the caller asks for it
// by its full displayed name. No separate tier parameter needed.
function findGemsByName(name, { category } = {}) {
  const index = loadIndex();
  const needle = name.trim().toLowerCase();
  const matches = [];
  for (const [id, g] of Object.entries(index)) {
    if (g.name && g.name.toLowerCase() === needle) {
      if (category && g.category !== category) continue;
      matches.push({ id, ...g });
    }
  }
  return matches;
}

function resolveGemId(name, opts = {}) {
  const matches = findGemsByName(name, opts);
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new Error(`No gem named "${name}" found${opts.category ? ` in category ${opts.category}` : ''}.`);
  }
  throw new Error(
    `"${name}" matches ${matches.length} gems — ambiguous. Pass { category: 'active'|'support'|'meta' } to narrow it: ` +
      matches.map((m) => `${m.id} (${m.category})`).join(', ')
  );
}

module.exports = { loadIndex, findGemsByName, resolveGemId };
