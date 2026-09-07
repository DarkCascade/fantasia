'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gems = require('../src/gems');

test('resolves an active skill gem by its plain name', () => {
  assert.equal(gems.resolveGemId('Flameblast', { category: 'active' }), 'Metadata/Items/Gems/SkillGemFlameblast');
});

test('resolves a specific support gem tier by its Roman-numeral display name', () => {
  // Confirms the tier suffix ("Two"/"Three" in the id) maps to a Roman
  // numeral in the display name ("II"/"III"), and that matching the full
  // displayed name picks the exact tier rather than the base gem.
  assert.equal(gems.resolveGemId('Burgeon II'), 'Metadata/Items/Gem/SupportGemBurgeonTwo');
  assert.equal(gems.resolveGemId('Ignite III'), 'Metadata/Items/Gems/SupportGemIgnitionThree');
});

test('a meta/trigger gem not in Active or Support Skill Gem.json is still found', () => {
  assert.equal(gems.resolveGemId('Cast on Dodge'), 'Metadata/Items/Gems/SkillGemCastOnDodge');
});

test('an unknown gem name throws', () => {
  assert.throws(() => gems.resolveGemId('Not A Real Gem'), /no gem named/i);
});

test('a name shared by a normal gem and a unique-item-granted variant is genuinely ambiguous', () => {
  // "Herald of Ash" is both the regular purchasable gem and a distinct
  // "UniqueSkillGem..." entry some unique item grants — same display name
  // *and* the same category (both "active"), so category alone can't
  // disambiguate this particular pair. resolveGemId must refuse to guess
  // rather than silently pick one; findGemsByName + picking by id is the
  // documented escape hatch for cases like this.
  const matches = gems.findGemsByName('Herald of Ash');
  assert.equal(matches.length, 2);
  assert.throws(() => gems.resolveGemId('Herald of Ash'), /ambiguous/i);
  assert.throws(() => gems.resolveGemId('Herald of Ash', { category: 'active' }), /ambiguous/i);
  assert.ok(matches.some((m) => m.id === 'Metadata/Items/Gems/SkillGemHeraldOfAsh'));
});
