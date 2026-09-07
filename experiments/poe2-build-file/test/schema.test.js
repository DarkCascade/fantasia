'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateBuild } = require('../src/schema');

test('a minimal build with just a name is valid', () => {
  const { valid, errors } = validateBuild({ name: 'Test Build' });
  assert.equal(valid, true, JSON.stringify(errors));
});

test('name is required', () => {
  const { valid, errors } = validateBuild({ author: 'Someone' });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.message.includes('required')));
});

test('an unknown top-level field is rejected (additionalProperties: false)', () => {
  const { valid } = validateBuild({ name: 'x', totallyMadeUp: true });
  assert.equal(valid, false);
});

test('"Trinket1" is accepted as an inventory_id (real-file correction)', () => {
  const { valid, errors } = validateBuild({
    name: 'x',
    inventory_slots: [{ inventory_id: 'Trinket1', slot_x: 0, slot_y: 0 }],
  });
  assert.equal(valid, true, JSON.stringify(errors));
});

test('an inventory_id outside the enum is rejected', () => {
  const { valid } = validateBuild({
    name: 'x',
    inventory_slots: [{ inventory_id: 'Offhand1', slot_x: 0, slot_y: 0 }],
  });
  assert.equal(valid, false);
});

test('a gem id path with singular or plural "Gem(s)" both match the pattern', () => {
  const { valid, errors } = validateBuild({
    name: 'x',
    skills: [
      { id: 'Metadata/Items/Gems/SkillGemFlameblast' },
      { id: 'Metadata/Items/Gem/SupportGemBurgeonTwo' },
    ],
  });
  assert.equal(valid, true, JSON.stringify(errors));
});

// The strongest possible confidence check: does our schema accept a real
// file that Path of Exile 2 itself already reads correctly in-game,
// completely unmodified?
test('a real, in-game-tested .build file validates against our schema', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'gemling-example.build'), 'utf8')
  );
  const { valid, errors } = validateBuild(fixture);
  assert.equal(valid, true, JSON.stringify(errors, null, 2));
});
