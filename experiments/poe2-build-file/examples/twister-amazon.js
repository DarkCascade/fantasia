#!/usr/bin/env node
'use strict';

// Twister Amazon — a levels 1-50 Build Planner file for a first-time PoE2
// player (0.5.5 data). Run: `node examples/twister-amazon.js [out.build]`.
//
// Why these choices (all checked against data/raw, not guessed):
//
// - Skill: Twister. Of the 30 released skill gems engravable from a level-1
//   Uncut Skill Gem (skill_gems.json `crafting_level: 1`), it has the highest
//   ceiling that doesn't come from supports: a twister that consumes a
//   Whirling Slash Whirlwind deals 80% more damage per Whirlwind stage (3.4x
//   at the 3-stage max) and spawns an extra twister, and twisters pierce
//   everything and re-hit the same enemy every 0.66s for 3s. Its gem-20
//   Attack Damage is 232%; the best single-hit rival, Rolling Slam, is
//   272% + 543% across a longer two-part animation. It was also top of the
//   0.5.5 league-starter lists at the time this was written.
// - Supports: Retreat is free "more" damage here because Whirling Slash is
//   the melee hit it asks for; Brutality is pure "more" for an all-physical
//   spear build; Prolonged Duration buys each twister more re-hits; Rapid
//   Attacks just stacks Whirlwind stages faster. Four supports, two skills.
// - Ascendancy: Amazon over Spirit Walker. Spirit Walker's Twister payoff
//   (Primal Bounty) is spent by timing dodge rolls; Amazon's first four
//   points are passive: Predatory Instinct (50% more damage vs Rare/Unique)
//   feeding In for the Kill (40% skill speed while one is near).
// - Tree: 65 points = 49 from levelling to 50 + 16 from the Act 1-4 quest
//   rewards. Routed in levelling order (computeAllocationPath `ordered`),
//   never through a mastery hub (can't be allocated).
// - Gear affixes: only ones mods.json says can roll on that base by item
//   level 50 (e.g. "+# to Level of all Projectile Skills" exists on spears
//   and amulets and levels Twister).

const path = require('path');
const { passives, gems, validateBuild, writeBuildFile } = require('../src');

const GOLD = (t) => `<rgb(242, 191, 67)>{${t}}`;
const TEAL = (t) => `<rgb(27, 162, 155)>{${t}}`;
const B = (t) => `<b>{${t}}`;

// ---------------------------------------------------------------- passives

// Ordered targets — the notables worth pathing for. Everything between them
// is filled in by the router.
const TREE_TARGETS = [
  'ranger_huntress_notable2', // Honed Instincts
  'projectiles23', //            Clean Shot
  'ranger_huntress_notable1', // Blur
  'ranged32', //                 Heavy Ammunition
  'ranged31', //                 Careful Aim
  'life_on_kill14', //           Life from Death
  'blind10', //                  Disorientation
  'evasion39', //                Catlike Agility
  'attack_speed60_', //          Agile Succession
  'evasion5', //                 High Alert
  'spear13', //                  Precise Point
  'spear18', //                  Roll and Strike
  'attack46', //                 Imbibed Power
];

// Why each notable (targets and the ones picked up en route) is worth it.
const WHY = {
  ranger_huntress_notable2: 'Attack speed means faster Whirling Slash stacks and more Twisters.',
  projectiles23: 'Twister is a projectile; take it for the damage (Twister already pierces everything).',
  flasks21: 'On the way to Blur. More flask recovery, and sometimes a free flask use.',
  ranger_huntress_notable1: 'Movement speed and evasion. Faster campaign, fewer hits taken.',
  ranged32: 'The biggest projectile-damage notable near you: +40%.',
  ranged31: 'More projectile damage plus accuracy (missed attacks deal nothing).',
  shadow_monk_notable2: 'On the way to Life from Death. Movement speed and mana regeneration.',
  life_on_kill14: 'Your main sustain: every kill heals you. Twister kills packs at once.',
  blind10: `Both ${GOLD('Twister')} and ${GOLD('Whirling Slash')} Blind what they hit, so this is always on.`,
  evasion39: 'Evasion is your armour-class defence as a Dexterity character.',
  attack_speed60_: 'Attack speed plus evasion whenever you are hitting something.',
  evasion5: 'Big evasion boost while you are at full life. Stops chip damage from snowballing.',
  jewel_slot1960: 'Socket any jewel with life, attack speed or projectile/spear damage.',
  spear9: 'Twisters are spear projectiles: +40% while nothing is right next to you.',
  spear13: 'Spear damage and accuracy.',
  spear18: 'Spear damage and attack speed. Your main damage cluster is done.',
  attack46: 'Drink a flask before a boss fight: +25% damage and attack speed while it lasts.',
};

// Level when point #k is available: (level - 1) level-up points plus
// roughly 4 quest points per act, acts ending around levels 12/24/36/48.
function levelForPoint(k) {
  for (let lvl = 1; lvl <= 100; lvl++) {
    if (lvl - 1 + Math.min(16, Math.floor(lvl / 3)) >= k) return lvl;
  }
  return 100;
}

function buildPassives() {
  const index = passives.loadIndex();
  const route = passives.computeAllocationPath('ranger596', TREE_TARGETS, { ordered: true });
  if (route.length !== 65) throw new Error(`expected 65 points for levels 1-50, got ${route.length}`);

  const out = route.map((id, i) => {
    const n = index.nodes[id];
    const next = route[i + 1] ? index.nodes[route[i + 1]].name : null;
    const lvl = levelForPoint(i + 1);
    const lines = [B(`<m>{Point ${i + 1} of 65}`) + `  <s>{(around level ${lvl})}`];
    if (n.isGenericAttribute) {
      lines.push('Choose ' + TEAL('Dexterity') + '. Pick Strength instead only if a spear or armour upgrade needs it.');
    } else if (WHY[id]) {
      lines.push(WHY[id]);
    }
    if (next) lines.push(`<i>{<s>{Next: ${next}}}`);
    return { id, level_interval: [lvl, 100], additional_text: lines.join('\n') };
  });
  return out;
}

// Amazon: Start is free; points 1-2 from the Act 2 Trial of the Sekhemas,
// 3-4 from the Act 3 Trial of Chaos. Path verified adjacent in the tree:
// Start - Small3 - Notable3 - Small4_ - Notable4.
function buildAscendancy() {
  const trial1 = 'Trial of the Sekhemas (Act 2)';
  const trial2 = 'Trial of Chaos (Act 3)';
  return [
    { id: 'AscendancyHuntress1Start', additional_text: B('Amazon') + '\nYour ascendancy. Its first four points are below.' },
    { id: 'AscendancyHuntress1Small3', additional_text: B('<m>{Ascendancy point 1}') + ` - ${trial1}\n4% skill speed, on the way to Predatory Instinct.` },
    {
      id: 'AscendancyHuntress1Notable3',
      additional_text:
        B('<m>{Ascendancy point 2: Predatory Instinct}') + ` - ${trial1}\n` +
        'Rare and Unique enemies (every boss) get an Open Weakness, and you deal 50% more damage to them. Nothing to activate.',
    },
    { id: 'AscendancyHuntress1Small4_', additional_text: B('<m>{Ascendancy point 3}') + ` - ${trial2}\n4% skill speed, on the way to In for the Kill.` },
    {
      id: 'AscendancyHuntress1Notable4',
      additional_text:
        B('<m>{Ascendancy point 4: In for the Kill}') + ` - ${trial2}\n` +
        '40% skill speed and 20% movement speed while an Open-Weakness enemy is near. Predatory Instinct makes every Rare and boss one.',
    },
  ];
}

// ------------------------------------------------------------------- gems

function support(name, text) {
  return { id: gems.resolveGemId(name, { category: 'support' }), additional_text: text };
}

function buildSkills() {
  return [
    {
      id: gems.resolveGemId('Twister', { category: 'active' }),
      level_interval: [1, 100],
      additional_text:
        B(GOLD('Twister') + ': your damage skill') + '\n' +
        'Engrave it from your first Uncut Skill Gem.\n' +
        B('Rotation:') + ` ${GOLD('Whirling Slash')} x3, then ${GOLD('Twister')} before you step out of the Whirlwind.\n` +
        'A twister that touches your Whirlwind eats it: +80% more damage per stage (3 stages = 3.4x) and one extra twister.\n' +
        'Against weak packs, plain Twister is fine. Against Rares and bosses, always feed it a full 3-stage Whirlwind.',
      support_skills: [
        support('Brutality I', B('Support #1') + ' - 25% more Physical damage. Your spear is all physical; this is free damage.\nUpgrade: Brutality II (30%), then Brutality III.'),
        support('Brutality II', B('Brutality upgrade') + ' - engrave when your Uncut Support Gem is level 2+. Replaces Brutality I.'),
        support('Brutality III', B('Brutality upgrade') + ' - engrave from a level 5 Uncut Support Gem. Also ignores some enemy physical reduction.'),
        support('Retreat I', B('Support #2') + ` - 20% more projectile damage if you landed a melee hit in the last 8s. ${GOLD('Whirling Slash')} is that melee hit.\nUpgrade: Retreat II.`),
        support('Retreat II', B('Retreat upgrade') + ' - 25%. Skip Retreat III: its window drops to 2 seconds.'),
        support('Prolonged Duration I', B('Support #3') + ' - twisters last 30% longer, so each one hits more times.\nUpgrade: Prolonged Duration II.'),
        support('Prolonged Duration II', B('Prolonged Duration upgrade') + ' - 35% longer.'),
      ],
    },
    {
      id: gems.resolveGemId('Whirling Slash', { category: 'active' }),
      level_interval: [1, 100],
      additional_text:
        B(GOLD('Whirling Slash') + ': the setup skill') + '\n' +
        'Engrave it from your second Uncut Skill Gem. Its damage does not matter; the Whirlwind it leaves does.\n' +
        'Each use adds a stage (max 3). Walking out of the Whirlwind collapses it, so throw your Twister first.\n' +
        'The Whirlwind also Slows and Blinds enemies inside it, which keeps you safe while you set up.',
      support_skills: [
        support('Rapid Attacks I', B('Its only support') + ' - faster slashes, so you reach 3 stages sooner.\nUpgrade: Rapid Attacks II, then III.'),
        support('Rapid Attacks II', B('Rapid Attacks upgrade') + ' - 25% attack speed.'),
        support('Rapid Attacks III', B('Rapid Attacks upgrade') + ' - 35% attack speed. Its 50% less damage doesn\'t matter: Whirling Slash is only here for the Whirlwind.'),
      ],
    },
  ];
}

// ------------------------------------------------------------------- gear

const RES = 'Fire / Cold / Lightning Resistance';

function slot(inventory_id, slot_x, text) {
  return { inventory_id, slot_x, slot_y: 0, additional_text: text };
}

function affixes(title, list, footer) {
  return B(title) + '\n' + list.map((a, i) => `${i + 1}. ${a}`).join('\n') + (footer ? '\n' + footer : '');
}

function buildGear() {
  return [
    slot('Weapon1', 0, affixes('Spear (main hand) + Buckler (off hand)', [
      '% increased Physical Damage (up to 110-134%)',
      'Adds # to # Physical Damage',
      '+# to Level of all Projectile Skills (levels Twister)',
      '% increased Attack Speed',
      'Dexterity / Accuracy',
    ], 'Upgrade whenever a spear shows higher Physical DPS. Skip Fire/Cold/Lightning damage: Brutality removes it.\n' +
       'Buckler: maximum Life, % Evasion, resistances.')),
    slot('Helm1', 0, affixes('Helmet (Evasion base)', [
      '+# to maximum Life',
      '% increased Evasion Rating (or the Evasion + Life hybrid)',
      RES,
      'Dexterity / Accuracy',
    ])),
    slot('BodyArmour1', 0, affixes('Body Armour (Evasion base)', [
      '+# to maximum Life',
      '% increased Evasion Rating / +# to Evasion Rating',
      RES,
      'Stun Threshold',
    ], 'Your biggest single source of defence. Upgrade it often.')),
    slot('Gloves1', 0, affixes('Gloves (Evasion base)', [
      'Adds # to # Physical Damage to Attacks',
      '% increased Attack Speed',
      '+# to maximum Life',
      RES,
      'Life gained per enemy killed / Life Leech',
    ])),
    slot('Boots1', 0, affixes('Boots (Evasion base)', [
      '% increased Movement Speed (the most important stat on boots)',
      '+# to maximum Life',
      RES,
      '% increased Evasion Rating',
    ], 'Never replace boots with Movement Speed for a pair without it.')),
    slot('Amulet1', 0, affixes('Amulet', [
      '+# to Level of all Projectile Skills (levels Twister)',
      '+# to maximum Life',
      RES,
      'Dexterity / Accuracy',
    ])),
    slot('Belt1', 0, affixes('Belt', [
      '+# to maximum Life',
      RES,
      '+# Charm Slot(s) (charms only work in belt charm slots)',
      'Strength (if gear needs it)',
      'Flask recovery / charges',
    ], 'Invoking, Sinew and Forking belts (level 32+) come with a charm slot built in.')),
    slot('Ring1', 0, affixes('Ring', [
      'Adds # to # Physical Damage to Attacks',
      '+# to maximum Life',
      RES,
      'Accuracy / Dexterity',
    ], 'Rings are the easiest place to fix a missing resistance.')),
    slot('Ring2', 0, affixes('Ring', [
      'Adds # to # Physical Damage to Attacks',
      '+# to maximum Life',
      RES,
      'Accuracy / Dexterity',
    ], 'Rings are the easiest place to fix a missing resistance.')),
    slot('Flask1', 0, B('Life Flask') + '\nSwap to a bigger base as they drop (Medium 4, Greater 10, Grand 16, Giant 23, Colossal 30, Gargantuan 40, Transcendent 50).\nDrinking it also turns on Imbibed Power.'),
    slot('Flask1', 1, B('Mana Flask') + '\nSame upgrade path as the life flask. Use it when Whirling Slash x3 + Twister empties your mana.'),
    slot('Charm1', 0, B('Charm: Stone Charm') + ' (from level 8)\nUsed automatically when you are Stunned. Bosses stun a lot. Needs a charm slot on your belt.'),
    slot('Charm1', 1, B('Charm: Thawing Charm') + ' (from level 12)\nUsed automatically when you are Frozen. Needs a second charm slot on your belt.'),
  ];
}

// ------------------------------------------------------------------ build

function buildTwisterAmazon() {
  const build = {
    name: 'Twister Amazon - New Player 1-50',
    author: 'DarkCascade',
    description:
      B('Huntress > Amazon, levels 1-50, patch 0.5.5') + '\n' +
      `Two skills, four supports. ${GOLD('Whirling Slash')} three times to build a Whirlwind, then ${GOLD('Twister')} to fling spinning blades that eat the Whirlwind for 3.4x damage.\n` +
      'Stay a few steps back, let the twisters do the work, dodge-roll out of anything big.\n\n' +
      B('Checklist') + '\n' +
      '- Allocate passives in order: hover a node for its step and approximate level.\n' +
      '- Ascend at the Trial of the Sekhemas (Act 2) and the Trial of Chaos (Act 3).\n' +
      '- Keep your elemental resistances as high as you can; hover each gear slot for what to look for.\n' +
      '- Life and movement speed matter more than damage on armour. Your damage comes from the spear.',
    ascendancy: 'Huntress1',
    passives: [...buildPassives(), ...buildAscendancy()],
    skills: buildSkills(),
    inventory_slots: buildGear(),
  };
  return build;
}

module.exports = { buildTwisterAmazon, TREE_TARGETS, levelForPoint };

if (require.main === module) {
  const build = buildTwisterAmazon();
  const { valid, errors } = validateBuild(build);
  if (!valid) {
    console.error(JSON.stringify(errors, null, 2));
    process.exit(1);
  }
  const out = process.argv[2] || path.join(process.cwd(), `${build.name}.build`);
  writeBuildFile(build, out);
  console.log(`wrote ${out}`);
}
