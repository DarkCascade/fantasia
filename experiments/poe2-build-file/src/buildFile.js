'use strict';

const passives = require('./passives');
const gems = require('./gems');
const { validateBuild } = require('./schema');

// Turns a build description given in plain display names into a validated
// .build JSON object: passive notables/keystones are resolved to ids and
// connected to the class start via computeAllocationPath (so the caller
// names *what* to take, not the filler nodes needed to reach it); skills
// and support gems are resolved by name (with tier baked into the name,
// e.g. "Ignite III"); gear is a thin pass-through since unique_name is
// already a plain string in the schema.
//
// Spec shape (all top-level fields except `name` optional):
//   {
//     name, author, link, description,
//     ascendancy: 'Mercenary3' | 'Gemling Legionnaire',
//     passives: {
//       startClass: 'Mercenary',       // inferred from `ascendancy` if omitted
//       notables: ['Essence of Virtue', ...],   // resolved via resolveAscendancyId's ascendancyId scope
//       keystones: ['Avatar of Fire', ...],     // resolved tree-wide
//       ids: ['jewel_slot1975', ...],           // pass-through ids already known
//       levelInterval: [65, 100],               // applied to every resolved/pass-through passive unless overridden per-entry (see below)
//     },
//     skills: [
//       { name: 'Flameblast', levelInterval: [90,100], additionalText: '...',
//         supports: ['Burgeon II', { name: 'Concentrated Effect', levelInterval: [1,100] }] }
//     ],
//     gear: [
//       { inventoryId: 'Amulet1', slotX: 0, slotY: 0, uniqueName: '...', additionalText: '...', levelInterval: [...] }
//     ],
//   }
//
// Returns { build, validation } — validation is schema.validateBuild's
// result, so a caller can inspect .valid / .errors before writing the file.
function assembleBuildFile(spec) {
  const build = { name: spec.name };
  if (spec.author) build.author = spec.author;
  if (spec.link) build.link = spec.link;
  if (spec.description) build.description = spec.description;

  let ascendancyInfo = null;
  if (spec.ascendancy) {
    ascendancyInfo = passives.resolveAscendancyId(spec.ascendancy);
    build.ascendancy = ascendancyInfo.id;
  }

  if (spec.passives) {
    build.passives = assemblePassives(spec.passives, ascendancyInfo);
  }

  if (spec.skills) {
    build.skills = spec.skills.map(assembleSkill);
  }

  if (spec.gear) {
    build.inventory_slots = spec.gear.map(assembleGearHint);
  }

  return { build, validation: validateBuild(build) };
}

function assemblePassives(p, ascendancyInfo) {
  const startClass = p.startClass || (ascendancyInfo && ascendancyInfo.className);
  if (!startClass) {
    throw new Error('passives.startClass is required when no top-level `ascendancy` is given to infer it from.');
  }
  const startId = passives.getClassStartNodeId(startClass);

  const targetIds = [];
  for (const name of p.notables || []) {
    targetIds.push(passives.resolvePassiveId(name, { ascendancyId: ascendancyInfo && ascendancyInfo.id }));
  }
  for (const name of p.keystones || []) {
    targetIds.push(passives.resolvePassiveId(name));
  }

  const pathIds = targetIds.length ? passives.computeAllocationPath(startId, targetIds) : [];
  const allIds = [...pathIds, ...(p.ids || [])];

  return allIds.map((id) => {
    const entry = { id };
    if (p.levelInterval) entry.level_interval = p.levelInterval;
    return entry;
  });
}

function assembleSkill(s) {
  if (typeof s === 'string') return { id: gems.resolveGemId(s, { category: 'active' }) };
  const entry = { id: gems.resolveGemId(s.name, { category: s.category || 'active' }) };
  if (s.levelInterval) entry.level_interval = s.levelInterval;
  if (s.additionalText) entry.additional_text = s.additionalText;
  if (s.supports) entry.support_skills = s.supports.map(assembleSupport);
  return entry;
}

function assembleSupport(sup) {
  if (typeof sup === 'string') return { id: gems.resolveGemId(sup, { category: 'support' }) };
  const entry = { id: gems.resolveGemId(sup.name, { category: 'support' }) };
  if (sup.levelInterval) entry.level_interval = sup.levelInterval;
  if (sup.additionalText) entry.additional_text = sup.additionalText;
  return entry;
}

function assembleGearHint(g) {
  const entry = { inventory_id: g.inventoryId, slot_x: g.slotX ?? 0, slot_y: g.slotY ?? 0 };
  if (g.levelInterval) entry.level_interval = g.levelInterval;
  if (g.uniqueName) entry.unique_name = g.uniqueName;
  if (g.additionalText) entry.additional_text = g.additionalText;
  return entry;
}

module.exports = { assembleBuildFile };
