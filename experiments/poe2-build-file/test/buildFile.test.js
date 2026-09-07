'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assembleBuildFile } = require('../src/buildFile');

test('assembles a minimal valid build from just a name', () => {
  const { build, validation } = assembleBuildFile({ name: 'Bare Minimum' });
  assert.deepEqual(build, { name: 'Bare Minimum' });
  assert.equal(validation.valid, true);
});

test('resolves ascendancy by display name and infers the start class from it', () => {
  const { build, validation } = assembleBuildFile({
    name: 'Gemling Test',
    ascendancy: 'Gemling Legionnaire',
    passives: { keystones: ['Avatar of Fire'] },
  });
  assert.equal(build.ascendancy, 'Mercenary3');
  assert.ok(build.passives.some((p) => p.id === 'passive_keystone_avatar_of_fire'));
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('resolves skills and support gems by name, including a support tier', () => {
  const { build, validation } = assembleBuildFile({
    name: 'Skill Test',
    skills: [{ name: 'Flameblast', levelInterval: [90, 100], supports: ['Burgeon II', 'Concentrated Area'] }],
  });
  assert.equal(build.skills[0].id, 'Metadata/Items/Gems/SkillGemFlameblast');
  assert.deepEqual(build.skills[0].level_interval, [90, 100]);
  assert.deepEqual(
    build.skills[0].support_skills.map((s) => s.id),
    ['Metadata/Items/Gem/SupportGemBurgeonTwo', 'Metadata/Items/Gems/SupportGemConcentratedEffect']
  );
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

test('assembles gear hints, including the Trinket1 slot', () => {
  const { build, validation } = assembleBuildFile({
    name: 'Gear Test',
    gear: [{ inventoryId: 'Trinket1', slotX: 2, uniqueName: 'Rite of Passage' }],
  });
  assert.deepEqual(build.inventory_slots[0], {
    inventory_id: 'Trinket1',
    slot_x: 2,
    slot_y: 0,
    unique_name: 'Rite of Passage',
  });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});

// Round-trip against the real example: rebuild its passive-selection intent
// (start as Gemling Legionnaire, reach the same first ascendancy notable
// and the "Avatar of Fire"-style targets aren't present in that file, so
// this checks a smaller, honest slice — the ascendancy id and one resolved
// gem — rather than claiming to reproduce Maxroll's exact 101-node route,
// which a different equally-valid path could legitimately diverge from.
test('a synthetic build built from the real example\'s ascendancy and a skill/support pair validates cleanly', () => {
  const { build, validation } = assembleBuildFile({
    name: 'Flameblast Oil Grenade Gemling (recreated)',
    author: 'Cptn Garbage',
    ascendancy: 'Gemling Legionnaire',
    skills: [
      {
        name: 'Flameblast',
        levelInterval: [90, 100],
        supports: ['Burgeon II', 'Concentrated Area', 'Considered Casting', 'Searing Flame II', 'Ignite III'],
      },
    ],
  });
  assert.equal(build.ascendancy, 'Mercenary3');
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));
});
