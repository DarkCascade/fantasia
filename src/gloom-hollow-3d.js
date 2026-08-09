/*
 * Gloom Hollow 3D — the Gloom Hollow arena rebuilt in three.js.
 *
 * Same game as src/gloom-hollow.js, same tuning constants, same feel: a square
 * 9x9 arena with a wall ring and four pillars, an exile who never aims (an
 * auto-attack on a 1.25s cooldown flings a homing bolt at the nearest monster
 * in range, so the only decision is where to stand), a frost nova on a
 * cooldown, and escalating waves of grunts and brutes that aggro, chase and
 * telegraph their swings. What changed is the renderer: instead of projecting a
 * diamond grid onto a Phaser canvas by hand, the arena is real geometry on a
 * ground plane and an orthographic camera looks at it from the classic ARPG
 * angle. Grid coordinates (gx, gz) ARE world coordinates — one tile is one
 * unit — so all the isometric projection math the 2D version needs (isoX/isoY,
 * screenToGrid, the circle-to-ellipse blast ring) simply disappears here, and
 * the depth buffer does the sorting that setDepth(screenY) used to.
 *
 * Everything is still built at runtime from primitives (boxes, spheres, cones,
 * cylinders) — no external art — and three.js is vendored locally, so the site
 * stays self-contained and offline-capable. three is a 670 KB ES module, so it
 * is imported on demand the first time this game is launched rather than being
 * loaded on every visit to the menu.
 *
 * The HUD (life / nova orbs, virtual stick, banners, damage numbers, death
 * screen) is a plain HTML/CSS overlay rather than drawn geometry — three has no
 * equivalent of Phaser's text and graphics objects, and DOM text stays crisp at
 * any canvas resolution.
 *
 * Created on demand via window.launchGloomHollow3D() so the menu stays first.
 */
(function () {
  "use strict";

  // three is loaded lazily (see ensureThree). Resolve its URL against this
  // script's own src so it works from the repo root and from the /fantasia/
  // Pages subpath alike, rather than depending on the document's base URL.
  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  var THREE_URL = new URL("../vendor/three.module.min.js", SELF_SRC || window.location.href).href;
  var THREE = null;

  /* ---------- arena ---------- */

  const GRID = 9; // GRID x GRID square level, one world unit per tile
  const WALL_H = 1.1; // how far the perimeter ring rises above the floor
  const PILLAR_H = 2.1;

  // Blocked interior tiles (pillars). Keys are "i,j" tile indices.
  const PILLARS = [
    [2, 2],
    [6, 2],
    [2, 6],
    [6, 6],
  ];

  /* ---------- tuning (identical to the 2D original) ---------- */

  const BODY_R = 0.34; // collision radius, in tiles
  const MOVE_SLACK = 1.5; // how far off the floor a walk order may land, in tiles
  const SPREAD = 1.0; // how far apart monsters keep from each other, in tiles
  const PLAYER_SPREAD = 0.85; // ...and from the player, so nobody hides the exile

  const PLAYER_HP = 120;
  const PLAYER_SPEED = 3.4; // tiles / second
  const PLAYER_RANGE = 4.2; // tiles the auto-attack reaches
  const PLAYER_CD = 1250; // ms between auto-attacks
  const PLAYER_DMG = [15, 22];

  const BOLT_SPEED = 11; // tiles / second — crosses the full range in ~0.4s
  const BOLT_HIT_R = 0.3; // tiles: close enough to the target to count as an impact
  const BOLT_MAX_MS = 1600; // fuse, so a bolt can never outlive its flight
  const BOLT_LIFT = 0.78; // world units above the floor (roughly torso height)

  const NOVA_CD = 6000;
  const NOVA_RADIUS = 2.4;
  const NOVA_DMG = [18, 26];
  const NOVA_FX_MS = 520;
  const NOVA_SHARDS = 12;

  const FLASK_CHANCE = 0.4;
  const FLASK_HEAL = 22;

  // ---------- gold ----------
  // A kill drops 0-3 coins, weighted hard toward nothing: most monsters are
  // worth killing for survival, not for loot, and a three-coin drop should
  // feel like a small event. Index = number of pieces, value = relative
  // weight, so the odds are 62% / 22% / 11% / 5% and the mean drop is ~0.59.
  const GOLD_DROP_WEIGHTS = [62, 22, 11, 5];
  const GOLD_SCATTER = 0.45; // tiles the pieces spread around the corpse
  // Deliberately much looser than the flask's 0.55: walking near a coin should
  // collect it, not walking exactly over it. That's most of a tile of slack on
  // either side, so gold reads as "swept up in passing".
  const GOLD_PICKUP_R = 0.95;

  // ---------- boons ----------
  // Clearing a wave is a decision, not just a breather: OFFER_SIZE cards drawn
  // from BOON_POOL, one pick, then the next wave lands. Drawing rather than
  // offering the whole pool is what makes two runs differ — you play the build
  // the hollow keeps handing you, not the one you'd always pick.
  const OFFER_SIZE = 3;

  const UP_ATTACK = 1; // added to both ends of the damage roll
  const UP_HASTE = 0.05; // 5% more attacks per second, i.e. cooldown / 1.05
  const UP_DEFENSE = 1; // flat damage subtracted from every blow that lands
  const UP_LIFE = 15; // added to max life — and healed on the spot, so it's never a dead pick
  const UP_MOVE = 0.08; // 8% faster on foot, multiplicative
  const UP_RANGE = 0.4; // tiles added to the auto-attack's reach
  const UP_NOVA_CD = 0.12; // 12% off the nova's cooldown, multiplicative
  const UP_NOVA_DMG = 6; // added to both ends of the nova roll
  const UP_LEECH = 2; // life clawed back per kill

  // A blow always lands for at least this much. Defense stacks for as long as a
  // run does, and monster damage only climbs to WAVE_SCALE_CAP, so without a
  // floor a deep defensive run would eventually be untouchable by grunts.
  const MIN_HIT = 1;
  // Haste compounds, so the cooldown approaches zero but never usefully gets
  // there; this is where it stops, about 5x the starting attack rate.
  const PLAYER_CD_FLOOR = 250;
  const NOVA_CD_FLOOR = 1800; // as above, for the nova
  // Move speed is capped because stepToward only tests the *destination* of a
  // step: make the steps long enough and a body could hop clean over a pillar.
  // Six stacks is ~1.59x, which at the 50ms frame clamp is a 0.28-tile step —
  // nowhere near the ~1.7 tiles it would take to skip a blocked tile.
  const UP_MOVE_MAX = 6;
  // Range is capped just at the grunt's aggro radius (5.0). Monsters aggro on
  // distance alone — being shot doesn't provoke them — so a reach longer than
  // their notice range would mean killing things that never wake up.
  const UP_RANGE_MAX = 2;

  // Cooldowns after `stacks` picks. Recomputed from the count rather than
  // divided in place each time, so the value never drifts and a reset is just
  // stacks = 0.
  function playerCooldown(stacks) {
    return Math.max(PLAYER_CD_FLOOR, PLAYER_CD / Math.pow(1 + UP_HASTE, stacks));
  }

  function novaCooldown(stacks) {
    return Math.max(NOVA_CD_FLOOR, NOVA_CD * Math.pow(1 - UP_NOVA_CD, stacks));
  }

  function playerSpeed(stacks) {
    return PLAYER_SPEED * Math.pow(1 + UP_MOVE, stacks);
  }

  // The pool the offer is drawn from. Each boon knows how to apply itself, how
  // to describe the value it changes (so a card can show "1.25s → 1.19s" rather
  // than an abstract percentage), and — where it has a ceiling — when it should
  // stop being offered, so a maxed boon doesn't crowd out a useful one.
  //   cls  = accent colour: atk offense, spd speed, def survival, arc the nova
  //   show = the stat as it stands, or as it would stand with `n` more stacks
  const BOON_POOL = [
    {
      id: "attack",
      cls: "atk",
      name: "+1 Attack",
      show: (p, n) => p.dmg[0] + p.attack + n * UP_ATTACK + "–" + (p.dmg[1] + p.attack + n * UP_ATTACK) + " damage",
      apply: (p) => {
        p.attack += UP_ATTACK;
      },
    },
    {
      id: "haste",
      cls: "spd",
      name: "+5% Attack Speed",
      show: (p, n) => (playerCooldown(p.stacks.haste + n) / 1000).toFixed(2) + "s between shots",
      avail: (p) => p.cd > PLAYER_CD_FLOOR,
      apply: (p) => {
        p.cd = playerCooldown(p.stacks.haste + 1);
      },
    },
    {
      id: "defense",
      cls: "def",
      name: "+1 Defense",
      show: (p, n) => p.defense + n * UP_DEFENSE + " damage blocked",
      apply: (p) => {
        p.defense += UP_DEFENSE;
      },
    },
    {
      id: "life",
      cls: "def",
      name: "+15 Max Life",
      show: (p, n) => p.maxHp + n * UP_LIFE + " max life",
      apply: (p) => {
        // Heal by the same amount, so taking it mid-run is worth something
        // immediately rather than only widening an empty globe.
        p.maxHp += UP_LIFE;
        p.hp = Math.min(p.maxHp, p.hp + UP_LIFE);
      },
    },
    {
      id: "move",
      cls: "spd",
      name: "+8% Move Speed",
      show: (p, n) => playerSpeed(p.stacks.move + n).toFixed(2) + " tiles/sec",
      avail: (p) => p.stacks.move < UP_MOVE_MAX,
      apply: (p) => {
        p.speed = playerSpeed(p.stacks.move + 1);
      },
    },
    {
      id: "range",
      cls: "atk",
      name: "+0.4 Attack Range",
      show: (p, n) => (p.range + n * UP_RANGE).toFixed(1) + " tiles of reach",
      avail: (p) => p.stacks.range < UP_RANGE_MAX,
      apply: (p) => {
        p.range += UP_RANGE;
      },
    },
    {
      id: "novacd",
      cls: "arc",
      name: "-12% Nova Cooldown",
      show: (p, n) => (novaCooldown(p.stacks.novacd + n) / 1000).toFixed(1) + "s nova cooldown",
      avail: (p) => p.novaCd > NOVA_CD_FLOOR,
      apply: (p) => {
        p.novaCd = novaCooldown(p.stacks.novacd + 1);
      },
    },
    {
      id: "novadmg",
      cls: "arc",
      name: "+6 Nova Damage",
      show: (p, n) =>
        NOVA_DMG[0] + p.novaDmg + n * UP_NOVA_DMG + "–" + (NOVA_DMG[1] + p.novaDmg + n * UP_NOVA_DMG) + " nova damage",
      apply: (p) => {
        p.novaDmg += UP_NOVA_DMG;
      },
    },
    {
      id: "leech",
      cls: "def",
      name: "+2 Life per Kill",
      show: (p, n) => p.leech + n * UP_LEECH + " life per kill",
      apply: (p) => {
        p.leech += UP_LEECH;
      },
    },
  ];

  const MONSTERS = {
    grunt: {
      key: "grunt",
      name: "Grunt",
      hp: 30,
      speed: 2.0,
      range: 1.0,
      cd: 1200,
      dmg: [4, 7],
      aggro: 5.0,
      barY: 1.35,
    },
    brute: {
      key: "brute",
      name: "Brute",
      hp: 62,
      speed: 1.35,
      range: 1.15,
      cd: 1800,
      dmg: [8, 12],
      aggro: 5.5,
      barY: 1.8,
    },
  };

  // ---------- waves ----------
  // Both axes of difficulty (how many monsters, how tough each one is) climb a
  // fixed amount per wave, capped so a long run gets brutal rather than
  // literally unbounded. Same numbers as the 2D game.
  const WAVE_BASE_MONSTERS = 3;
  const WAVE_MAX_MONSTERS = 8;
  const WAVE_COUNT_GROWTH_EVERY = 2; // waves per +1 monster
  const WAVE_BRUTE_FRAC_BASE = 0.15;
  const WAVE_BRUTE_FRAC_PER_WAVE = 0.05;
  const WAVE_MAX_BRUTE_FRAC = 0.6;
  const WAVE_HP_SCALE = 0.06;
  const WAVE_DMG_SCALE = 0.04;
  const WAVE_SCALE_CAP = 20;
  const WAVE_BREATHER_MS = 2600;
  const WAVE_INTRO_MS = 1600;
  const WAVE_CLEAR_HEAL = 14;

  const SPAWN_PLAYER_CLEARANCE = 2.2; // tiles a fresh spawn must clear from the player
  const SPAWN_MONSTER_CLEARANCE = 0.9; // ...and from each other
  const SPAWN_ATTEMPTS = 40; // random tries before pickSpawnPoint relaxes the clearances

  // Its own best-run entry: the 3D arena plays close to the 2D one but not
  // identically (the camera changes what you can read at a glance), so the two
  // keep separate records rather than one overwriting the other.
  const BEST_KEY = "gloom-hollow-3d-best";

  const MONSTER_WINDUP_MS = 350;
  const MONSTER_WINDUP_SCALE = 1.16;
  const SWING_LUNGE = 0.19; // world units an attacker lunges forward mid-swing
  const MONSTER_PULLBACK = 0.11; // ...and pulls back during the wind-up
  const MONSTER_TELL_COLOR = 0xff5a3c; // warning red — still lands if you're here when it resolves
  const MONSTER_TELL_SAFE_COLOR = 0x6fe08a; // green once you've stepped outside its range
  const KNOCKBACK_DIST = 0.4; // tiles the player is shoved back on a landed hit

  /* ---------- camera ---------- */

  // Classic ARPG three-quarter view: 45 degrees around, looking down steeply
  // enough that the floor reads as a floor and bodies never hide each other.
  //
  // The pitch adapts to the viewport, though. Seen from the flat angle the
  // arena's footprint is about twice as wide as it is tall, so on a portrait
  // phone — where the frustum has to be sized to fit that width — it would end
  // up a postage stamp with empty bands above and below. Looking down more
  // steeply squares the footprint back up and buys most of that height back,
  // without ever cropping the arena.
  const CAM_Y_WIDE = 1.25; // height component of the view direction on a wide viewport...
  const CAM_Y_TALL = 3.4; // ...and on a tall one, where the view is much closer to top-down
  const CAM_ASPECT_FLAT = 1.35; // at or above this viewport aspect, use CAM_Y_WIDE
  const CAM_ASPECT_STEEP = 0.5; // at or below this one, use CAM_Y_TALL
  const CAM_DIST = 34;
  const VIEW_MARGIN = 1.06; // slack around the measured arena bounds

  // The arena's bounding box, whose projected extent decides the zoom: the
  // floor plus its wall ring, as tall as a pillar.
  const ARENA_BOX = { min: -1, max: GRID + 1, top: PILLAR_H };

  const JOY_THROW = 34; // px the stick's knob travels for full deflection
  const JOY_DEAD = 0.25; // fraction of the throw treated as centred

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function randInt(lo, hi) {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // How many monsters a wave spawns, and what fraction are brutes. A pure
  // function of the wave number, so nothing else has to agree about the ramp.
  function waveComposition(wave) {
    const total = Math.min(
      WAVE_MAX_MONSTERS,
      WAVE_BASE_MONSTERS + Math.floor((wave - 1) / WAVE_COUNT_GROWTH_EVERY)
    );
    const frac = Math.min(WAVE_MAX_BRUTE_FRAC, WAVE_BRUTE_FRAC_BASE + wave * WAVE_BRUTE_FRAC_PER_WAVE);
    let brutes = Math.round(total * frac);
    // Keep at least one grunt once there's room for variety — an all-brute
    // wave is the same monster over and over, not "tougher".
    if (total > 1) brutes = Math.min(brutes, total - 1);
    brutes = clamp(brutes, 0, total);
    return { grunts: total - brutes, brutes: brutes, total: total };
  }

  // Multiplier applied to a monster's hp/dmg for the wave it spawns in.
  function waveStatScale(wave) {
    const w = Math.min(wave, WAVE_SCALE_CAP);
    return { hp: 1 + (w - 1) * WAVE_HP_SCALE, dmg: 1 + (w - 1) * WAVE_DMG_SCALE };
  }

  // How many coins a kill leaves behind. Weighted pick over GOLD_DROP_WEIGHTS,
  // returning the index — i.e. the number of pieces.
  function rollGoldDrop() {
    let total = 0;
    GOLD_DROP_WEIGHTS.forEach((w) => {
      total += w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < GOLD_DROP_WEIGHTS.length; i++) {
      r -= GOLD_DROP_WEIGHTS[i];
      if (r < 0) return i;
    }
    return 0; // only reachable on a floating-point hair; no drop is the safe default
  }

  // Fisher-Yates, in place — only used so a wave doesn't visibly spawn as "all
  // the grunts, then all the brutes".
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* ---------- HUD markup + styles ---------- */

  const CSS = `
#gh3-root{position:absolute;inset:0;overflow:hidden;background:#07060f;
  font-family:Arial,Helvetica,sans-serif;color:#fff;
  user-select:none;-webkit-user-select:none;touch-action:none;}
#gh3-root canvas{display:block;width:100%;height:100%;}
.gh3-vignette{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 38%,rgba(0,0,0,.6) 100%);}
.gh3-hud{position:absolute;inset:0;pointer-events:none;}
.gh3-title{position:absolute;top:12px;left:0;right:0;text-align:center;
  font-size:22px;font-weight:bold;letter-spacing:.05em;text-shadow:0 2px 6px #000,0 0 4px #241c3a;}
.gh3-title span{color:#9fd8ff;}
.gh3-hint{position:absolute;top:44px;left:0;right:0;text-align:center;padding:0 14px;
  font-size:12px;line-height:1.5;color:#b9c4e8;text-shadow:0 1px 3px #000;
  transition:opacity .8s ease;}
.gh3-stats{position:absolute;top:88px;right:14px;text-align:right;
  font-size:14px;font-weight:bold;color:#ffe7a3;text-shadow:0 1px 3px #000;}
.gh3-stats small{display:block;margin-top:2px;font-size:12px;font-weight:normal;color:#8fa0c8;}
/* Gold purse: the count with a little minted coin in front of it. */
.gh3-gold{display:block;margin-top:3px;font-size:15px;color:#ffd23f;
  text-shadow:0 1px 3px #000;transform-origin:100% 50%;}
.gh3-gold::before{content:"";display:inline-block;width:11px;height:11px;margin-right:5px;
  vertical-align:-1px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#fff3b0 0%,#ffd23f 45%,#a5610f 100%);
  box-shadow:0 0 5px rgba(255,210,63,.6);}
/* A one-shot pulse when the purse grows, so a pickup registers even if you
   were looking at the other end of the arena. */
.gh3-gold.is-bumped{animation:gh3-bump .32s ease-out;}
@keyframes gh3-bump{
  0%{transform:scale(1);}
  35%{transform:scale(1.28);color:#fff3b0;}
  100%{transform:scale(1);}
}
.gh3-menu{position:absolute;top:12px;left:12px;pointer-events:auto;cursor:pointer;
  font:bold 18px Arial,Helvetica,sans-serif;color:#fff;background:#3a3358;border:0;
  border-radius:9px;padding:8px 16px;box-shadow:0 3px 0 rgba(0,0,0,.5);}
.gh3-banner{position:absolute;top:36%;left:0;right:0;text-align:center;padding:0 14px;
  font-size:30px;font-weight:bold;color:#ffd23f;text-shadow:0 3px 10px #000;
  opacity:0;transition:opacity .22s ease;}
.gh3-orbs{position:absolute;right:18px;bottom:20px;display:flex;flex-direction:column-reverse;
  gap:12px;align-items:center;}
.gh3-orb{position:relative;width:74px;height:74px;border-radius:50%;overflow:hidden;
  box-sizing:border-box;border:3px solid #6b5a2f;background:#150a0d;pointer-events:auto;
  cursor:pointer;box-shadow:0 5px 14px rgba(0,0,0,.6);}
.gh3-orb-fill{position:absolute;left:0;right:0;bottom:0;height:100%;}
.gh3-orb--life .gh3-orb-fill{background:linear-gradient(180deg,#e2494c 0%,#8f1f24 100%);}
.gh3-orb--nova{border-color:#4a5570;background:#0a1220;}
.gh3-orb--nova .gh3-orb-fill{background:linear-gradient(180deg,#57b0e6 0%,#1d4a78 100%);}
.gh3-orb--ready{border-color:#ffd23f;box-shadow:0 0 14px rgba(255,210,63,.55),0 5px 14px rgba(0,0,0,.6);}
.gh3-orb-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:bold;text-shadow:0 1px 3px #000;}
.gh3-stickpad{position:absolute;left:0;bottom:0;width:190px;height:190px;
  pointer-events:auto;touch-action:none;}
.gh3-stick{position:absolute;left:22px;bottom:22px;width:104px;height:104px;border-radius:50%;
  box-sizing:border-box;border:3px solid rgba(74,85,112,.9);background:rgba(13,16,32,.4);}
.gh3-stick.is-active{border-color:#ffd23f;background:rgba(13,16,32,.62);}
.gh3-knob{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;
  border-radius:50%;box-sizing:border-box;background:#2f5fa8;border:2px solid #9fd8ff;opacity:.75;}
.gh3-stick.is-active .gh3-knob{opacity:1;}
.gh3-pop{position:absolute;left:0;top:0;font-size:16px;font-weight:bold;white-space:nowrap;
  text-shadow:0 2px 4px #000;transition:transform .62s ease-out,opacity .62s ease-out;}
/* Build line under the purse — only shown once there's a build to show. */
.gh3-build{display:none;margin-top:4px;font-size:11px;font-weight:normal;color:#c9d2ee;
  text-shadow:0 1px 3px #000;}
.gh3-build.is-shown{display:block;}
/* Between-waves boon picker. */
.gh3-upgrade{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;
  justify-content:center;gap:8px;padding:16px;text-align:center;
  background:rgba(4,3,12,.74);pointer-events:auto;}
.gh3-upgrade.is-open{display:flex;}
.gh3-upgrade h3{font-size:23px;color:#ffd23f;letter-spacing:.04em;text-shadow:0 3px 8px #000;}
.gh3-upgrade-sub{margin-bottom:8px;font-size:13px;color:#b9c4e8;text-shadow:0 1px 3px #000;}
.gh3-cards{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
/* Wide enough for the longest name in the pool ("-12% Nova Cooldown") to stay
   on one line — a card whose title wraps sits its note lower than its
   neighbours' and the row looks ragged. */
.gh3-card{position:relative;overflow:hidden;width:196px;padding:17px 12px 14px;box-sizing:border-box;
  font-family:inherit;color:#fff;text-align:center;cursor:pointer;
  border:2px solid rgba(255,224,138,.32);border-radius:14px;
  background:linear-gradient(180deg,rgba(38,34,72,.96) 0%,rgba(15,13,34,.96) 100%);
  box-shadow:0 6px 18px rgba(0,0,0,.55);transition:transform .08s ease,border-color .15s ease;}
/* Guarded, or a tap on a touchscreen leaves one card stuck in the hover look. */
@media (hover:hover){.gh3-card:hover{border-color:#ffd23f;transform:translateY(-3px);}}
.gh3-card:active{transform:translateY(1px);}
/* A coloured tab along the top edge, so the three read apart at a glance. */
.gh3-card::before{content:"";position:absolute;left:50%;top:0;width:58px;height:4px;
  margin-left:-29px;border-radius:0 0 4px 4px;}
.gh3-card--atk::before{background:#e2494c;}
.gh3-card--spd::before{background:#57b0e6;}
.gh3-card--def::before{background:#6fe08a;}
.gh3-card--arc::before{background:#b98cf0;}
.gh3-card-name{display:block;font-size:16px;font-weight:bold;}
.gh3-card--atk .gh3-card-name{color:#ff9a8f;}
.gh3-card--spd .gh3-card-name{color:#9fd8ff;}
.gh3-card--def .gh3-card-name{color:#a8f0bd;}
.gh3-card--arc .gh3-card-name{color:#dcc4ff;}
.gh3-card-note{display:block;margin-top:8px;font-size:12px;line-height:1.45;color:#c9d2ee;}
.gh3-card-key{position:absolute;top:5px;right:9px;font-size:11px;color:#8fa0c8;}
.gh3-death{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;
  justify-content:center;gap:14px;background:rgba(0,0,0,.62);pointer-events:auto;text-align:center;}
.gh3-death.is-open{display:flex;}
.gh3-death h2{font-size:40px;color:#d43b3b;text-shadow:0 3px 8px #000;letter-spacing:.04em;}
/* The boon list can run long on a deep run, so give it room to wrap. */
.gh3-death p{max-width:min(560px,88vw);font-size:15px;line-height:1.7;color:#e6ecff;
  text-shadow:0 1px 3px #000;}
.gh3-btn{font:bold 18px Arial,Helvetica,sans-serif;color:#fff;border:0;border-radius:11px;
  padding:12px 26px;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.5);}
.gh3-btn--again{background:#2f5a8a;}
.gh3-btn--menu{background:#3a3358;}
.gh3-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#ffe7a3;font-size:15px;letter-spacing:.24em;text-transform:uppercase;}
@media (max-width:520px){
  .gh3-title{font-size:18px;}
  /* Stacked, not overlapping: the menu button owns the top-left corner, then
     the hint (three lines at this width), then the score line. */
  .gh3-hint{top:54px;font-size:11px;}
  .gh3-stats{top:118px;font-size:13px;}
  .gh3-orb{width:64px;height:64px;}
  .gh3-banner{font-size:24px;}
  /* Three cards side by side don't fit a phone; stack them into rows big
     enough to be a comfortable thumb target. */
  .gh3-upgrade h3{font-size:19px;}
  .gh3-cards{flex-direction:column;gap:10px;}
  .gh3-card{width:min(320px,86vw);padding:12px;}
  .gh3-card-key{display:none;}
}
`;

  const HUD_HTML = `
<div class="gh3-vignette"></div>
<div class="gh3-hud">
  <div class="gh3-title">GLOOM HOLLOW <span>3D</span></div>
  <div class="gh3-hint" data-gh3="hint">WASD/arrows or the stick to walk &bull; click the floor to move, a monster to close in<br>You auto-fire at the nearest foe &bull; NOVA orb (or Space) to blast</div>
  <div class="gh3-stats"><span data-gh3="stats"></span><span class="gh3-gold" data-gh3="gold">0</span><span class="gh3-build" data-gh3="build"></span><small data-gh3="best"></small></div>
  <button class="gh3-menu" type="button" data-gh3="menu">&#8801;</button>
  <div class="gh3-banner" data-gh3="banner"></div>
  <div class="gh3-pops" data-gh3="pops"></div>
  <div class="gh3-orbs">
    <div class="gh3-orb gh3-orb--nova" data-gh3="novaOrb">
      <div class="gh3-orb-fill" data-gh3="novaFill"></div>
      <div class="gh3-orb-label" data-gh3="novaLabel">NOVA</div>
    </div>
    <div class="gh3-orb gh3-orb--life">
      <div class="gh3-orb-fill" data-gh3="lifeFill"></div>
      <div class="gh3-orb-label" data-gh3="lifeLabel"></div>
    </div>
  </div>
  <div class="gh3-stickpad" data-gh3="stickPad">
    <div class="gh3-stick" data-gh3="stick"><div class="gh3-knob" data-gh3="knob"></div></div>
  </div>
  <div class="gh3-upgrade" data-gh3="upgrade">
    <h3 data-gh3="upgradeTitle"></h3>
    <div class="gh3-upgrade-sub">The hollow offers a boon — take one</div>
    <!-- Filled in from the draw each time the picker opens; see offerUpgrades. -->
    <div class="gh3-cards">
      <button class="gh3-card" type="button" data-gh3="card0">
        <span class="gh3-card-key">1</span>
        <span class="gh3-card-name" data-gh3="name0"></span>
        <span class="gh3-card-note" data-gh3="note0"></span>
      </button>
      <button class="gh3-card" type="button" data-gh3="card1">
        <span class="gh3-card-key">2</span>
        <span class="gh3-card-name" data-gh3="name1"></span>
        <span class="gh3-card-note" data-gh3="note1"></span>
      </button>
      <button class="gh3-card" type="button" data-gh3="card2">
        <span class="gh3-card-key">3</span>
        <span class="gh3-card-name" data-gh3="name2"></span>
        <span class="gh3-card-note" data-gh3="note2"></span>
      </button>
    </div>
  </div>
  <div class="gh3-death" data-gh3="death">
    <h2>YOU DIED</h2>
    <p data-gh3="summary"></p>
    <button class="gh3-btn gh3-btn--again" type="button" data-gh3="again">&#9656; Enter Again</button>
    <button class="gh3-btn gh3-btn--menu" type="button" data-gh3="toMenu">&#8801; Menu</button>
  </div>
</div>`;

  /* ---------- the game ---------- */

  class Hollow3D {
    constructor(root) {
      this.root = root;
      this.el = {};
      root.querySelectorAll("[data-gh3]").forEach((n) => {
        this.el[n.getAttribute("data-gh3")] = n;
      });

      this.listeners = []; // [target, type, fn, opts], unbound on teardown
      this.setupRenderer();
      this.bindInput();
      this.startRun();

      // The controls hint has done its job after the first wave or so; fade it
      // out rather than leaving text across the top of the arena all run.
      this.hintTimer = setTimeout(() => {
        this.el.hint.style.opacity = "0";
      }, 9000);

      this.lastFrame = performance.now();
      this.tick = this.tick.bind(this);
      this.raf = requestAnimationFrame(this.tick);
    }

    /* ---------- renderer, camera, lights ---------- */

    setupRenderer() {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.canvas = this.renderer.domElement;
      this.root.insertBefore(this.canvas, this.root.firstChild);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x07060f);
      // The far side of the arena fades into the gloom, which is most of why
      // the place reads as a hollow rather than a lit box.
      this.scene.fog = new THREE.Fog(0x07060f, CAM_DIST - 6, CAM_DIST + 26);

      // Everything the run creates goes under `world`, so wiping a run is one
      // pass over its children instead of bookkeeping every object separately.
      // The lights and the camera live outside it and survive a restart.
      this.world = new THREE.Group();
      this.scene.add(this.world);

      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
      this.camHome = new THREE.Vector3();
      // Screen-space movement (stick + keys) has to be expressed on the ground
      // plane, so the camera's right/forward axes are pulled out of its matrix
      // whenever it is (re)placed — see aimCamera.
      this.camRight = new THREE.Vector3();
      this.camFwd = new THREE.Vector3();

      const c = GRID / 2;
      this.scene.add(new THREE.AmbientLight(0x5566a0, 1.1));
      const sun = new THREE.DirectionalLight(0xffe0bb, 1.5);
      sun.position.set(c + 7, 14, c + 3);
      sun.target.position.set(c, 0, c);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -9;
      sun.shadow.camera.right = 9;
      sun.shadow.camera.top = 9;
      sun.shadow.camera.bottom = -9;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 40;
      sun.shadow.bias = -0.0015;
      this.scene.add(sun, sun.target);
      // A cold rim from the opposite side, so the far faces aren't pure black.
      const rim = new THREE.DirectionalLight(0x6f8fd8, 0.5);
      rim.position.set(c - 8, 6, c - 6);
      this.scene.add(rim);

      this.raycaster = new THREE.Raycaster();
      this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      this.tmpV = new THREE.Vector3();
      this.tmpV2 = new THREE.Vector3();

      this.resize();
      const onResize = () => this.resize();
      this.listen(window, "resize", onResize);
      this.listen(window, "orientationchange", onResize);
    }

    // Point the camera at the arena from the angle this viewport shape wants,
    // and refresh everything derived from where it ended up.
    aimCamera(aspect) {
      const t = clamp((CAM_ASPECT_FLAT - aspect) / (CAM_ASPECT_FLAT - CAM_ASPECT_STEEP), 0, 1);
      const y = CAM_Y_WIDE + (CAM_Y_TALL - CAM_Y_WIDE) * t;
      const c = GRID / 2;
      const len = Math.hypot(1, y, 1);
      this.camera.position.set(c + CAM_DIST / len, (y * CAM_DIST) / len, c + CAM_DIST / len);
      this.camera.lookAt(c, 0, c);
      this.camera.updateMatrixWorld();
      this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
      this.camHome.copy(this.camera.position);

      this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
      this.camRight.y = 0;
      this.camRight.normalize();
      this.camFwd.set(0, 1, 0).cross(this.camRight).normalize();
    }

    // Half-extents, in camera space, of the box the whole arena lives in.
    // Measured rather than derived: the projected footprint depends on the
    // pitch, which now moves with the viewport.
    arenaHalfExtents() {
      let hx = 0;
      let hy = 0;
      [ARENA_BOX.min, ARENA_BOX.max].forEach((x) => {
        [0, ARENA_BOX.top].forEach((y) => {
          [ARENA_BOX.min, ARENA_BOX.max].forEach((z) => {
            this.tmpV.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
            hx = Math.max(hx, Math.abs(this.tmpV.x));
            hy = Math.max(hy, Math.abs(this.tmpV.y));
          });
        });
      });
      return { x: hx * VIEW_MARGIN, y: hy * VIEW_MARGIN };
    }

    resize() {
      const w = Math.max(1, this.root.clientWidth);
      const h = Math.max(1, this.root.clientHeight);
      this.renderer.setSize(w, h, false);
      const aspect = w / h;
      this.aimCamera(aspect);
      // Contain: the smallest frustum that still holds the whole arena at this
      // aspect, so nothing is ever cropped off the edge of a phone.
      const half = this.arenaHalfExtents();
      let hw = half.x;
      let hh = half.y;
      if (hw / hh < aspect) {
        hw = hh * aspect;
      } else {
        hh = hw / aspect;
      }
      this.camera.left = -hw;
      this.camera.right = hw;
      this.camera.top = hh;
      this.camera.bottom = -hh;
      this.camera.updateProjectionMatrix();
    }

    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    }

    /* ---------- scene bookkeeping ---------- */

    add(obj) {
      this.world.add(obj);
      return obj;
    }

    // Take an object out of the world and free its GPU-side buffers. Shared
    // geometry (the floor slabs, the wall blocks) gets disposed once per user,
    // which is harmless — dispose() only ever frees what is still allocated.
    drop(obj) {
      this.world.remove(obj);
      obj.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
    }

    /* ---------- small geometry helpers ---------- */

    // Fresh material per body rather than one shared per colour: hit flashes
    // poke at emissive per body, and a shared material would flash the whole
    // wave at once.
    lambert(color, opts) {
      return new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts || {}));
    }

    box(w, h, d, color, opts) {
      return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.lambert(color, opts));
    }

    ball(r, color, opts, seg) {
      return new THREE.Mesh(new THREE.SphereGeometry(r, seg || 12, seg || 10), this.lambert(color, opts));
    }

    cone(r, h, color, opts, seg) {
      return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 10), this.lambert(color, opts));
    }

    cyl(rt, rb, h, color, opts, seg) {
      return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), this.lambert(color, opts));
    }

    // Flat-on-the-floor ring, used for the nova wave, the attack telegraphs and
    // the target marker. In 3D a circle of radius R is just a circle of radius
    // R — none of the 2D version's circle-to-ellipse projection is needed.
    groundRing(inner, outer, color, opacity) {
      const geo = new THREE.RingGeometry(inner, outer, 64);
      geo.rotateX(-Math.PI / 2);
      return new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: opacity === undefined ? 1 : opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
    }

    groundDisc(r, color, opacity) {
      const geo = new THREE.CircleGeometry(r, 48);
      geo.rotateX(-Math.PI / 2);
      return new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: opacity === undefined ? 1 : opacity,
          depthWrite: false,
        })
      );
    }

    castShadows(group) {
      group.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      return group;
    }

    /* ---------- models ---------- */

    // The arena: a checkered floor of shallow slabs, a wall ring around it, and
    // four braziered pillars standing on the blocked interior tiles.
    buildArena() {
      const arena = new THREE.Group();

      const tileGeo = new THREE.BoxGeometry(0.97, 0.22, 0.97);
      const tileA = this.lambert(0x3b3a56);
      const tileB = this.lambert(0x343352);
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          if (this.blocked[i + "," + j]) continue;
          const t = new THREE.Mesh(tileGeo, (i + j) % 2 === 0 ? tileA : tileB);
          t.position.set(i + 0.5, -0.11, j + 0.5);
          t.receiveShadow = true;
          arena.add(t);
        }
      }

      const wallGeo = new THREE.BoxGeometry(1, WALL_H, 1);
      const wallMat = this.lambert(0x413f5f);
      for (let i = -1; i <= GRID; i++) {
        [[i, -1], [i, GRID], [-1, i], [GRID, i]].forEach((p) => {
          const w = new THREE.Mesh(wallGeo, wallMat);
          w.position.set(p[0] + 0.5, WALL_H / 2 - 0.22, p[1] + 0.5);
          w.castShadow = true;
          w.receiveShadow = true;
          arena.add(w);
        });
      }

      // Pillars, each capped with a cold brazier that really does light the
      // floor around it — four small point lights are what keep the arena from
      // being one flat wash of directional light.
      PILLARS.forEach((p) => {
        const shaft = this.box(0.86, PILLAR_H, 0.86, 0x4a4869);
        shaft.position.set(p[0] + 0.5, PILLAR_H / 2 - 0.22, p[1] + 0.5);
        shaft.castShadow = true;
        shaft.receiveShadow = true;
        arena.add(shaft);

        const cap = this.box(1.02, 0.18, 1.02, 0x565482);
        cap.position.set(p[0] + 0.5, PILLAR_H - 0.22, p[1] + 0.5);
        cap.castShadow = true;
        arena.add(cap);

        const flame = this.ball(0.16, 0x9fd8ff, { emissive: 0x6fb8ff });
        flame.position.set(p[0] + 0.5, PILLAR_H - 0.02, p[1] + 0.5);
        arena.add(flame);

        const lamp = new THREE.PointLight(0x7fc8ff, 6, 6.5, 2);
        lamp.position.copy(flame.position);
        arena.add(lamp);
      });

      this.arena = this.add(arena);
    }

    // The exile: a hooded figure in a blue cloak with a glowing focus at the
    // head of a staff. Built facing +Z, like every body here, so a heading maps
    // straight onto rotation.y.
    makeExile() {
      const g = new THREE.Group();
      const cloak = this.cone(0.36, 0.95, 0x2f5fa8, {}, 10);
      cloak.position.y = 0.475;
      g.add(cloak);
      const tabard = this.cone(0.2, 0.72, 0x4b83d6, {}, 8);
      tabard.position.set(0, 0.36, 0.13);
      g.add(tabard);
      const hood = this.ball(0.22, 0x27508c);
      hood.position.y = 1.02;
      g.add(hood);
      const face = this.ball(0.16, 0x120f1e);
      face.position.set(0, 0.99, 0.11);
      g.add(face);
      [-0.075, 0.075].forEach((x) => {
        const eye = this.ball(0.035, 0x9fd8ff, { emissive: 0x9fd8ff }, 8);
        eye.position.set(x, 1.0, 0.21);
        g.add(eye);
      });
      const staff = this.cyl(0.04, 0.04, 1.25, 0x6f4a2f, {}, 8);
      staff.position.set(0.3, 0.6, 0.06);
      staff.rotation.z = -0.12;
      g.add(staff);
      const focus = this.ball(0.11, 0xbfe6ff, { emissive: 0x8fd0ff });
      focus.position.set(0.37, 1.24, 0.06);
      g.add(focus);
      this.castShadows(g);
      // A cold personal light, so the exile stays readable in the darkest
      // corner of the hollow.
      const glow = new THREE.PointLight(0x6fa8ff, 5, 5, 2);
      glow.position.set(0, 1.1, 0);
      g.add(glow);
      return g;
    }

    // Grunt: a lean bone-pale thing with red eyes and long ears.
    makeGrunt() {
      const g = new THREE.Group();
      const body = this.cyl(0.24, 0.3, 0.58, 0x8f9b7e, {}, 10);
      body.position.y = 0.29;
      g.add(body);
      const head = this.ball(0.22, 0xc3ceae);
      head.position.y = 0.75;
      g.add(head);
      [-1, 1].forEach((s) => {
        const ear = this.cone(0.07, 0.34, 0xa9b596, {}, 6);
        ear.position.set(s * 0.19, 0.88, -0.04);
        ear.rotation.z = s * 0.85;
        g.add(ear);
        const arm = this.cyl(0.06, 0.05, 0.42, 0xa9b596, {}, 6);
        arm.position.set(s * 0.28, 0.36, 0.04);
        arm.rotation.z = s * 0.22;
        g.add(arm);
        const claw = this.cone(0.07, 0.18, 0xdfe6d2, {}, 6);
        claw.position.set(s * 0.32, 0.11, 0.06);
        claw.rotation.x = Math.PI;
        g.add(claw);
        const eye = this.ball(0.05, 0xff4a3d, { emissive: 0xff2a1d }, 8);
        eye.position.set(s * 0.09, 0.78, 0.19);
        g.add(eye);
      });
      this.castShadows(g);
      return g;
    }

    // Brute: a bulky horned demon, wider and slower than it is tall.
    makeBrute() {
      const g = new THREE.Group();
      const body = this.box(0.66, 0.72, 0.5, 0x8c3327);
      body.position.y = 0.5;
      g.add(body);
      const chest = this.box(0.42, 0.4, 0.2, 0xa8493a);
      chest.position.set(0, 0.62, 0.2);
      g.add(chest);
      const head = this.ball(0.26, 0x9c3b2d);
      head.position.y = 1.05;
      g.add(head);
      [-1, 1].forEach((s) => {
        const horn = this.cone(0.08, 0.36, 0xe8dcc0, {}, 6);
        horn.position.set(s * 0.2, 1.24, -0.02);
        horn.rotation.z = s * 0.55;
        g.add(horn);
        const eye = this.ball(0.055, 0xffd23f, { emissive: 0xffb020 }, 8);
        eye.position.set(s * 0.1, 1.08, 0.22);
        g.add(eye);
        const arm = this.cyl(0.1, 0.09, 0.52, 0x8c3327, {}, 8);
        arm.position.set(s * 0.42, 0.52, 0.02);
        arm.rotation.z = s * 0.18;
        g.add(arm);
        const leg = this.cyl(0.11, 0.1, 0.3, 0x76281e, {}, 8);
        leg.position.set(s * 0.17, 0.15, 0);
        g.add(leg);
      });
      const maw = this.box(0.26, 0.07, 0.08, 0x2a0d09);
      maw.position.set(0, 0.96, 0.22);
      g.add(maw);
      this.castShadows(g);
      return g;
    }

    // Health bar: two unlit planes that billboard to the camera every frame.
    // depthTest is off so a bar is never swallowed by the body in front of it,
    // and neither plane is transparent — three draws the whole transparent
    // queue after the opaque one, so a see-through backing would be painted
    // over its own fill no matter what renderOrder said.
    makeBar() {
      const g = new THREE.Group();
      const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.78, 0.11),
        new THREE.MeshBasicMaterial({ color: 0x1a0b0b, depthTest: false })
      );
      // Origin at the bar's left edge, so scale.x reads directly as hp ratio.
      const fgGeo = new THREE.PlaneGeometry(0.74, 0.075);
      fgGeo.translate(0.37, 0, 0.001);
      const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0xd4453f, depthTest: false }));
      fg.position.x = -0.37;
      bg.renderOrder = 20;
      fg.renderOrder = 21;
      g.add(bg, fg);
      g.userData.fill = fg;
      return g;
    }

    // A coin, stood on its edge so it catches the light and turns edge-on as it
    // spins — a flat disc on the floor would be nearly invisible from this
    // camera angle. Emissive, because most of the arena floor is very dark.
    makeCoin() {
      const g = new THREE.Group();
      const face = this.cyl(0.145, 0.145, 0.045, 0xffcc44, { emissive: 0x6a4700 }, 16);
      face.rotation.x = Math.PI / 2;
      face.position.y = 0.19;
      g.add(face);
      this.castShadows(g);
      return g;
    }

    makeFlask() {
      const g = new THREE.Group();
      const glass = this.cyl(0.11, 0.13, 0.24, 0x8fd0e8, { emissive: 0x1a4a5c, transparent: true, opacity: 0.9 }, 10);
      glass.position.y = 0.16;
      g.add(glass);
      const fluid = this.cyl(0.09, 0.11, 0.15, 0xe2394c, { emissive: 0x7a1420 }, 10);
      fluid.position.y = 0.12;
      g.add(fluid);
      const cork = this.cyl(0.05, 0.05, 0.09, 0xd8c48a, {}, 8);
      cork.position.y = 0.32;
      g.add(cork);
      this.castShadows(g);
      return g;
    }

    /* ---------- run setup ---------- */

    startRun() {
      this.over = false;
      this.now = performance.now();
      this.wave = 0; // beginWave(1) sets this before the first frame renders
      this.kills = 0;
      this.gold = 0;
      this.monsters = [];
      this.flasks = [];
      this.coins = [];
      this.bolts = [];
      this.fx = [];
      this.timers = [];
      this.novaReadyAt = 0;
      this.blocked = Object.create(null);
      PILLARS.forEach((p) => {
        this.blocked[p[0] + "," + p[1]] = true;
      });

      // One geometry and one material for every bolt in the run: they're all
      // identical and nothing animates them per-instance.
      this.boltGeo = new THREE.ConeGeometry(0.1, 0.42, 8);
      this.boltGeo.rotateX(Math.PI / 2); // point along +Z, like every other body here
      this.boltMat = new THREE.MeshLambertMaterial({ color: 0xbfe6ff, emissive: 0x7fc8ff });
      this.burstGeo = new THREE.SphereGeometry(1, 10, 8);
      this.burstMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true });

      this.buildArena();
      this.buildPlayer();
      this.startBest = this.loadBest();
      this.el.death.classList.remove("is-open");
      // buildPlayer() makes a fresh player, so the boons reset with it; this is
      // just the picker's own UI state, which outlives a run.
      this.closeUpgrades();
      this.refreshHud();
      this.beginWave(1);
    }

    buildPlayer() {
      const model = this.add(this.makeExile());
      this.player = {
        model: model,
        gx: 4.5,
        gz: 4.5,
        hp: PLAYER_HP,
        maxHp: PLAYER_HP,
        speed: PLAYER_SPEED,
        range: PLAYER_RANGE,
        cd: PLAYER_CD,
        nextAttack: 0,
        dmg: PLAYER_DMG, // base roll; the boons below ride on top of it
        attack: 0, // flat damage added to every bolt
        defense: 0, // flat damage subtracted from every blow that lands
        novaCd: NOVA_CD,
        novaDmg: 0, // flat damage added to both ends of the nova roll
        leech: 0, // life clawed back per kill
        // How many times each boon has been taken. The multiplicative ones
        // (haste, move) are recomputed from their count rather than scaled in
        // place, and the whole map drives the build line and the end summary.
        stacks: BOON_POOL.reduce((acc, b) => {
          acc[b.id] = 0;
          return acc;
        }, {}),
        moveTo: null,
        target: null,
        barY: 1.45,
        lunge: { x: 0, z: 0 },
        facing: 0,
      };
      this.place(this.player);

      // Ring on the ground under whatever the player is walking toward.
      this.targetRing = this.add(this.groundRing(0.4, 0.5, 0xffd23f, 0.9));
      this.targetRing.position.y = 0.04;
      this.targetRing.visible = false;
    }

    place(entity) {
      entity.model.position.set(entity.gx + entity.lunge.x, 0, entity.gz + entity.lunge.z);
      entity.model.rotation.y = entity.facing;
      if (entity.bar) {
        entity.bar.position.set(entity.gx, entity.barY, entity.gz);
        entity.bar.quaternion.copy(this.camera.quaternion);
      }
    }

    /* ---------- level queries ---------- */

    isBlocked(gx, gz) {
      if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return true;
      return !!this.blocked[Math.floor(gx) + "," + Math.floor(gz)];
    }

    // A body of radius r can stand here only if none of its corners overlap a
    // wall or leave the arena.
    canStand(gx, gz, r) {
      return (
        !this.isBlocked(gx - r, gz - r) &&
        !this.isBlocked(gx + r, gz - r) &&
        !this.isBlocked(gx - r, gz + r) &&
        !this.isBlocked(gx + r, gz + r)
      );
    }

    /* ---------- waves ---------- */

    // Random floor tile that isn't a wall/pillar (canStand — never relaxed)
    // and, best-effort, isn't on top of the player or another monster from this
    // same spawn. The clearances degrade in stages rather than ever looping
    // forever on a crowded board.
    pickSpawnPoint(placed) {
      for (let relax = 0; relax < 2; relax++) {
        for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
          const gx = BODY_R + Math.random() * (GRID - 2 * BODY_R);
          const gz = BODY_R + Math.random() * (GRID - 2 * BODY_R);
          if (!this.canStand(gx, gz, BODY_R)) continue;
          if (dist(gx, gz, this.player.gx, this.player.gz) < SPAWN_PLAYER_CLEARANCE) continue;
          if (relax === 0 && placed.some((p) => dist(gx, gz, p.gx, p.gz) < SPAWN_MONSTER_CLEARANCE)) continue;
          return { gx: gx, gz: gz };
        }
      }
      // Random sampling kept missing — sweep the grid methodically instead,
      // giving up the player clearance only in the very last pass, since only
      // the wall/pillar check is load-bearing for correctness.
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const gx = i + 0.5;
          const gz = j + 0.5;
          if (!this.canStand(gx, gz, BODY_R)) continue;
          if (dist(gx, gz, this.player.gx, this.player.gz) < SPAWN_PLAYER_CLEARANCE) continue;
          return { gx: gx, gz: gz };
        }
      }
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          if (this.canStand(i + 0.5, j + 0.5, BODY_R)) return { gx: i + 0.5, gz: j + 0.5 };
        }
      }
      return { gx: GRID / 2, gz: GRID / 2 }; // unreachable on this fixed 9x9 layout
    }

    spawnMonsters(wave) {
      const comp = waveComposition(wave);
      const scale = waveStatScale(wave);
      const order = [];
      for (let i = 0; i < comp.grunts; i++) order.push("grunt");
      for (let i = 0; i < comp.brutes; i++) order.push("brute");
      shuffle(order);

      this.monsters = [];
      const placed = [];
      order.forEach((type) => {
        const def = MONSTERS[type];
        const spot = this.pickSpawnPoint(placed);
        const model = this.add(type === "brute" ? this.makeBrute() : this.makeGrunt());
        const maxHp = Math.round(def.hp * scale.hp);
        const m = {
          def: def,
          model: model,
          gx: spot.gx,
          gz: spot.gz,
          hp: maxHp,
          maxHp: maxHp,
          speed: def.speed,
          range: def.range,
          cd: def.cd,
          nextAttack: 0,
          dmg: [Math.round(def.dmg[0] * scale.dmg), Math.round(def.dmg[1] * scale.dmg)],
          alive: true,
          barY: def.barY,
          lunge: { x: 0, z: 0 },
          facing: 0,
          windingUp: false,
          windupEndsAt: 0,
        };
        m.bar = this.add(this.makeBar());
        m.tell = this.makeTelegraph(def.range);
        this.add(m.tell.group);
        this.place(m);
        this.drawBar(m);
        this.monsters.push(m);
        placed.push({ gx: m.gx, gz: m.gz });

        // Monsters rise out of the floor rather than blinking in, so a wave
        // landing behind you still reads as an event. place() only ever sets
        // x/z, so the climb has y to itself.
        model.position.y = -1.6;
        this.addFx(360, (t) => {
          model.position.y = -1.6 * (1 - t);
        });
      });
    }

    // Set the current wave, spawn it, and signpost it.
    beginWave(wave) {
      this.wave = wave;
      this.spawnMonsters(wave);
      this.banner("WAVE " + wave, WAVE_INTRO_MS);
      this.refreshHud();
    }

    // All monsters in the current wave are dead. Breathe, heal a little, then
    // hand the player a choice — the next wave doesn't land until they've taken
    // a boon (see chooseUpgrade). The run's only exit is still death.
    onWaveCleared() {
      if (this.over) return;
      this.clearFlasks();
      this.clearCoins();
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + WAVE_CLEAR_HEAL);
      this.refreshHud();
      this.offerUpgrades();
    }

    /* ---------- between-wave boons ---------- */

    // Draw the offer: OFFER_SIZE distinct boons, uniformly at random from
    // whichever ones still have something to give. Filtering on `avail` first
    // is what keeps a maxed-out boon (haste at its floor, range at its cap)
    // from taking one of the three slots and quietly shrinking the real choice
    // to two.
    drawOffer() {
      return shuffle(BOON_POOL.filter((b) => !b.avail || b.avail(this.player))).slice(0, OFFER_SIZE);
    }

    // Open the picker. Nothing schedules the next wave here — chooseUpgrade
    // does, so the wave genuinely waits on the player rather than on a timer
    // that happens to be longer than they took.
    offerUpgrades() {
      this.offer = this.drawOffer();
      // Every boon capped out at once can't happen with this pool (four of the
      // nine have no ceiling at all), but an empty offer would strand the run
      // behind a picker with nothing to pick, so fall through to the wave.
      if (!this.offer.length) {
        this.nextWaveAfterChoice();
        return;
      }

      this.choosing = true;
      // A wave cleared fast enough can still have its own "WAVE n" banner
      // fading in the middle of the screen — right where the picker's heading
      // goes. Drop it rather than letting the two overlap.
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.el.banner.style.opacity = "0";
      this.el.upgradeTitle.textContent = "WAVE " + this.wave + " CLEARED";
      for (let i = 0; i < 3; i++) {
        const card = this.el["card" + i];
        const boon = this.offer[i];
        if (!boon) {
          card.style.display = "none";
          continue;
        }
        card.style.display = "";
        // Rebuild the class list rather than toggling: which accent a slot
        // wears changes every draw.
        card.className = "gh3-card gh3-card--" + boon.cls;
        this.el["name" + i].textContent = boon.name;
        // Both the current value and what it becomes. Showing only one is the
        // trap: "+8% move speed" says nothing on its own, "3.40 → 3.67
        // tiles/sec" says what you're buying.
        this.el["note" + i].innerHTML =
          boon.show(this.player, 0) + "<br>&#8595; " + boon.show(this.player, 1);
      }
      this.el.upgrade.classList.add("is-open");
    }

    // Take the boon in slot `index` and let the next wave come. Guarded on
    // `choosing` so a double-tap (or a key and a click landing together) can't
    // spend one wave's choice twice, and on `over` because the picker is torn
    // down on death.
    chooseUpgrade(index) {
      if (!this.choosing || this.over) return;
      const boon = this.offer[index];
      if (!boon) return; // an empty slot — leave the picker open rather than eating the choice
      boon.apply(this.player);
      this.player.stacks[boon.id]++;
      this.choosing = false;
      this.el.upgrade.classList.remove("is-open");
      this.refreshHud();
      this.nextWaveAfterChoice();
    }

    nextWaveAfterChoice() {
      this.banner("WAVE " + (this.wave + 1) + " INCOMING", WAVE_BREATHER_MS);
      this.after(WAVE_BREATHER_MS, () => {
        if (this.over) return;
        this.beginWave(this.wave + 1);
      });
    }

    closeUpgrades() {
      this.choosing = false;
      this.offer = [];
      this.el.upgrade.classList.remove("is-open");
    }

    // What the run ended up built out of, e.g. "+1 Attack ×3, +15 Max Life ×2".
    // Pool order, not pick order, so two runs with the same build read the same.
    boonSummary() {
      const taken = BOON_POOL.filter((b) => this.player.stacks[b.id] > 0).map(
        (b) => b.name + (this.player.stacks[b.id] > 1 ? " ×" + this.player.stacks[b.id] : "")
      );
      return taken.length ? taken.join(", ") : "none";
    }

    /* ---------- tiny tween / timer plumbing ---------- */
    // Phaser's tweens and delayedCall aren't here, and a tween library would be
    // more than this needs: every animation in the game is "run onUpdate(t)
    // from 0 to 1 over N ms, then clean up".

    addFx(ms, onUpdate, onComplete) {
      const fx = { start: this.now, ms: ms, onUpdate: onUpdate, onComplete: onComplete };
      this.fx.push(fx);
      return fx;
    }

    after(ms, fn) {
      this.timers.push({ at: this.now + ms, fn: fn });
    }

    // Yo-yo shape for swings: 0 -> 1 -> 0 across the whole duration.
    static pingPong(t) {
      return t < 0.5 ? t * 2 : (1 - t) * 2;
    }

    runFx() {
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const fx = this.fx[i];
        const t = Math.min(1, (this.now - fx.start) / fx.ms);
        fx.onUpdate(t);
        if (t >= 1) {
          this.fx.splice(i, 1);
          if (fx.onComplete) fx.onComplete();
        }
      }
      for (let i = this.timers.length - 1; i >= 0; i--) {
        if (this.now >= this.timers[i].at) {
          const fn = this.timers[i].fn;
          this.timers.splice(i, 1);
          fn();
        }
      }
    }

    /* ---------- HUD ---------- */

    banner(text, ms) {
      const b = this.el.banner;
      b.textContent = text;
      b.style.opacity = "1";
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => {
        b.style.opacity = "0";
      }, Math.max(220, ms - 220));
    }

    refreshHud() {
      const p = this.player;
      this.el.lifeFill.style.height = clamp(p.hp / p.maxHp, 0, 1) * 100 + "%";
      this.el.lifeLabel.textContent = Math.max(0, Math.round(p.hp)) + "/" + p.maxHp;

      const charge = this.novaCharge();
      this.el.novaFill.style.height = charge * 100 + "%";
      this.el.novaOrb.classList.toggle("gh3-orb--ready", charge >= 1);
      this.el.novaLabel.textContent =
        charge >= 1 ? "NOVA" : Math.ceil(((this.novaReadyAt - this.now) / 1000) * 10) / 10 + "s";

      this.el.stats.textContent = "Wave " + this.wave + "  ·  Slain " + this.kills;
      this.el.gold.textContent = this.gold;
      // The build line stays hidden until there's a build, and only lists the
      // stats that actually moved — with nine boons in the pool, printing all
      // of them would be a paragraph in the corner of a phone.
      const s = p.stacks;
      const parts = [];
      if (s.attack) parts.push("Atk " + (p.dmg[0] + p.attack) + "–" + (p.dmg[1] + p.attack));
      if (s.haste) parts.push((p.cd / 1000).toFixed(2) + "s");
      if (s.range) parts.push("Rng " + p.range.toFixed(1));
      if (s.defense) parts.push("Def " + p.defense);
      if (s.life) parts.push("Life " + p.maxHp);
      if (s.leech) parts.push("Leech " + p.leech);
      if (s.move) parts.push("Spd " + p.speed.toFixed(1));
      if (s.novacd || s.novadmg) {
        parts.push("Nova " + (p.novaCd / 1000).toFixed(1) + "s" + (s.novadmg ? "/+" + p.novaDmg : ""));
      }
      this.el.build.classList.toggle("is-shown", parts.length > 0);
      this.el.build.textContent = parts.join("  ·  ");
      this.el.best.textContent =
        this.startBest.wave > 0 ? "Best: Wave " + this.startBest.wave + " (" + this.startBest.kills + ")" : "Best: —";
    }

    // Replay the purse's pulse. Removing the class and forcing a reflow before
    // re-adding it is what makes the animation restart on back-to-back pickups
    // — otherwise the second coin of a pair changes nothing the browser can see.
    bumpGold() {
      const el = this.el.gold;
      el.classList.remove("is-bumped");
      void el.offsetWidth;
      el.classList.add("is-bumped");
    }

    novaCharge() {
      const left = this.novaReadyAt - this.now;
      if (left <= 0) return 1;
      return 1 - left / this.player.novaCd;
    }

    drawBar(m) {
      const ratio = clamp(m.hp / m.maxHp, 0, 1);
      m.bar.userData.fill.scale.x = Math.max(0.0001, ratio);
      m.bar.userData.fill.material.color.setHex(ratio > 0.4 ? 0xd4453f : 0xf0a020);
      m.bar.visible = m.alive;
    }

    // Floating damage number: a DOM element parked over the projected world
    // point. DOM text stays crisp whatever the canvas resolution is, and the
    // browser animates the float for free.
    popNumber(gx, y, gz, value, color) {
      this.tmpV.set(gx, y, gz).project(this.camera);
      const px = (this.tmpV.x * 0.5 + 0.5) * this.root.clientWidth;
      const py = (-this.tmpV.y * 0.5 + 0.5) * this.root.clientHeight;
      const el = document.createElement("div");
      el.className = "gh3-pop";
      el.textContent = value;
      el.style.color = color;
      el.style.transform = "translate(" + (px - 18) + "px," + py + "px)";
      this.el.pops.appendChild(el);
      // Next frame, so the transition has a start value to animate away from.
      requestAnimationFrame(() => {
        el.style.transform = "translate(" + (px - 18) + "px," + (py - 34) + "px)";
        el.style.opacity = "0";
      });
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 700);
    }

    /* ---------- input ---------- */

    bindInput() {
      this.keys = Object.create(null);
      this.joy = { active: false, pointerId: -1, dx: 0, dy: 0, cx: 0, cy: 0 };
      this.holdMove = false;
      this.holdPointerId = -1;

      this.listen(this.root, "contextmenu", (e) => e.preventDefault());

      // World pointer: the canvas takes it, and captures the pointer so a drag
      // that wanders over the HUD keeps steering the walk.
      this.listen(this.canvas, "pointerdown", (e) => {
        if (this.over) return;
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          /* capture is a convenience; the game still works without it */
        }
        if (e.button === 2) {
          this.castNova();
          return;
        }
        // Tapping a living monster is a move order that closes until it's in
        // firing range; anywhere else on the floor is a plain walk order, held
        // for as long as the pointer stays down.
        const hit = this.monsterAtPointer(e);
        if (hit) {
          this.player.target = hit;
          this.player.moveTo = null;
          this.holdMove = false;
          return;
        }
        if (this.setMoveTarget(e)) {
          this.holdMove = true;
          this.holdPointerId = e.pointerId;
        }
      });
      this.listen(this.canvas, "pointermove", (e) => {
        // Hold to keep walking toward the pointer — the main way to move on a
        // touchscreen, where repeated taps are awkward.
        if (this.holdMove && e.pointerId === this.holdPointerId) this.setMoveTarget(e);
      });
      const endWorld = (e) => {
        if (this.holdMove && e.pointerId === this.holdPointerId) {
          this.holdMove = false;
          this.holdPointerId = -1;
        }
      };
      this.listen(this.canvas, "pointerup", endWorld);
      this.listen(this.canvas, "pointercancel", endWorld);

      // Virtual stick. Its pad is a generous invisible square around the
      // visible ring, so a left thumb doesn't have to land precisely — and
      // because it's a separate element from the canvas, stick and nova orb
      // work as two thumbs at once for free.
      const stick = this.el.stick;
      this.listen(this.el.stickPad, "pointerdown", (e) => {
        if (this.over) return;
        e.preventDefault();
        try {
          this.el.stickPad.setPointerCapture(e.pointerId);
        } catch (err) {
          /* as above */
        }
        const r = stick.getBoundingClientRect();
        this.joy.active = true;
        this.joy.pointerId = e.pointerId;
        this.joy.cx = r.left + r.width / 2;
        this.joy.cy = r.top + r.height / 2;
        this.player.target = null;
        this.player.moveTo = null;
        this.holdMove = false;
        stick.classList.add("is-active");
        this.moveJoystick(e.clientX, e.clientY);
      });
      this.listen(this.el.stickPad, "pointermove", (e) => {
        if (this.joy.active && e.pointerId === this.joy.pointerId) this.moveJoystick(e.clientX, e.clientY);
      });
      const endJoy = (e) => {
        if (!this.joy.active || e.pointerId !== this.joy.pointerId) return;
        this.joy.active = false;
        this.joy.pointerId = -1;
        this.joy.dx = 0;
        this.joy.dy = 0;
        this.el.knob.style.transform = "";
        stick.classList.remove("is-active");
      };
      this.listen(this.el.stickPad, "pointerup", endJoy);
      this.listen(this.el.stickPad, "pointercancel", endJoy);

      // The nova orb doubles as the cast button, so the skill is reachable by
      // thumb with no keyboard in sight.
      this.listen(this.el.novaOrb, "pointerdown", (e) => {
        e.preventDefault();
        this.castNova();
      });

      this.listen(window, "keydown", (e) => {
        this.keys[e.code] = true;
        // 1/2/3 pick a boon while the picker is up — the cards are the touch
        // path, these are the desktop one.
        if (this.choosing) {
          for (let i = 0; i < 3; i++) {
            if (e.code === "Digit" + (i + 1) || e.code === "Numpad" + (i + 1)) {
              e.preventDefault();
              this.chooseUpgrade(i);
              return;
            }
          }
        }
        if (e.code === "Space") {
          e.preventDefault();
          this.castNova();
        }
      });
      this.listen(window, "keyup", (e) => {
        this.keys[e.code] = false;
      });
      // A key held while the tab loses focus would otherwise stay "down"
      // forever and walk the exile into a wall on return.
      this.listen(window, "blur", () => {
        this.keys = Object.create(null);
      });

      // The three card slots are fixed; which boon sits in each one is decided
      // per draw, so the handlers pick by slot index.
      for (let i = 0; i < 3; i++) {
        const slot = i;
        this.listen(this.el["card" + slot], "click", () => this.chooseUpgrade(slot));
      }

      this.listen(this.el.menu, "click", () => this.toMenu());
      this.listen(this.el.toMenu, "click", () => this.toMenu());
      this.listen(this.el.again, "click", () => this.restart());
    }

    moveJoystick(clientX, clientY) {
      let dx = clientX - this.joy.cx;
      let dy = clientY - this.joy.cy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_THROW) {
        dx = (dx / len) * JOY_THROW;
        dy = (dy / len) * JOY_THROW;
      }
      this.el.knob.style.transform = "translate(" + dx + "px," + dy + "px)";
      this.joy.dx = dx / JOY_THROW;
      this.joy.dy = dy / JOY_THROW;
    }

    // Screen-space direction implied by whichever movement keys are held right
    // now, WASD and the arrows both working and freely mixable. Two keys on the
    // same axis cancel rather than fight — a real hand can hold both.
    keysHeading() {
      const k = this.keys;
      const dx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      const dy = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
      if (dx === 0 && dy === 0) return null;
      return { dx: dx, dy: dy };
    }

    // Pointer event -> the point on the arena floor under it.
    pointerToGround(e) {
      const r = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpV2);
      return hit ? { gx: hit.x, gz: hit.z } : null;
    }

    // Order a walk to the floor point under the pointer. A point just off the
    // floor is pulled back onto it — that keeps dragging along the rim working
    // — but a click out in the void is ignored rather than clamped to a corner.
    setMoveTarget(e) {
      const g = this.pointerToGround(e);
      if (!g) return false;
      if (g.gx < -MOVE_SLACK || g.gz < -MOVE_SLACK || g.gx > GRID + MOVE_SLACK || g.gz > GRID + MOVE_SLACK) {
        return false;
      }
      const gx = clamp(g.gx, BODY_R, GRID - BODY_R);
      const gz = clamp(g.gz, BODY_R, GRID - BODY_R);
      if (!this.canStand(gx, gz, BODY_R)) return false;
      this.player.target = null;
      this.player.moveTo = { gx: gx, gz: gz };
      return true;
    }

    // Which living monster, if any, is under the pointer.
    monsterAtPointer(e) {
      const living = this.monsters.filter((m) => m.alive);
      if (!living.length) return null;
      const r = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const hits = this.raycaster.intersectObjects(
        living.map((m) => m.model),
        true
      );
      if (!hits.length) return null;
      let node = hits[0].object;
      while (node) {
        const owner = living.find((m) => m.model === node);
        if (owner) return owner;
        node = node.parent;
      }
      return null;
    }

    /* ---------- nova ---------- */

    // A ground shockwave sized to the real blast radius. In 3D that's simply a
    // ring of radius NOVA_RADIUS — no projection to compensate for.
    spawnNovaFx(cx, cz) {
      const group = new THREE.Group();
      group.position.set(cx, 0.05, cz);
      const bloom = this.groundDisc(1, 0x8fd8ff, 0.34);
      const wave = this.groundRing(0.86, 1, 0x9fe8ff, 1);
      const trail = this.groundRing(0.9, 1, 0x4aa8e0, 0.6);
      trail.position.y = -0.01;
      group.add(bloom, wave, trail);

      const shards = [];
      for (let i = 0; i < NOVA_SHARDS; i++) {
        const a = ((i + Math.random() * 0.6) / NOVA_SHARDS) * Math.PI * 2;
        const s = this.box(0.34, 0.03, 0.07, 0xdff4ff, { emissive: 0xbfe6ff, transparent: true });
        s.rotation.y = -a;
        s.userData.angle = a;
        shards.push(s);
        group.add(s);
      }
      this.add(group);

      this.addFx(
        NOVA_FX_MS,
        (t) => {
          // Radius and opacity ride separate curves: the wave springs out fast
          // and is near full size early, while the light holds and only drops
          // away at the end.
          const grow = 1 - Math.pow(1 - t, 3);
          const fade = 1 - Math.pow(t, 2.2);
          const r = Math.max(0.001, NOVA_RADIUS * grow);
          wave.scale.setScalar(r);
          wave.material.opacity = Math.min(1, fade * 1.4);

          const b = Math.max(0, 1 - t * 2.4);
          bloom.scale.setScalar(r);
          bloom.material.opacity = 0.34 * b;

          const lagT = Math.max(0, (t - 0.2) / 0.8);
          const lag = 1 - Math.pow(1 - lagT, 3);
          trail.scale.setScalar(Math.max(0.001, NOVA_RADIUS * lag));
          trail.material.opacity = (1 - Math.pow(lagT, 2)) * 0.6;

          shards.forEach((s) => {
            const d = r * 1.08;
            s.position.set(Math.cos(s.userData.angle) * d, 0.06, Math.sin(s.userData.angle) * d);
            s.scale.x = 0.4 + (1 - grow) * 1.6;
            s.material.opacity = fade;
          });
        },
        () => this.drop(group)
      );
    }

    castNova() {
      if (this.over || this.now < this.novaReadyAt) return;
      this.novaReadyAt = this.now + this.player.novaCd;
      this.spawnNovaFx(this.player.gx, this.player.gz);
      this.shakeCamera(0.1, 170);

      this.monsters.forEach((m) => {
        if (!m.alive) return;
        if (dist(m.gx, m.gz, this.player.gx, this.player.gz) <= NOVA_RADIUS) {
          const bonus = this.player.novaDmg;
          this.hurtMonster(m, randInt(NOVA_DMG[0] + bonus, NOVA_DMG[1] + bonus), "#8fd8ff");
        }
      });
      this.refreshHud();
    }

    // A short camera jolt. The camera never moves otherwise, so the shake is an
    // offset from its resting spot rather than something that accumulates.
    shakeCamera(amount, ms) {
      this.addFx(
        ms,
        (t) => {
          const a = amount * (1 - t);
          this.camera.position.set(
            this.camHome.x + (Math.random() - 0.5) * a * 2,
            this.camHome.y + (Math.random() - 0.5) * a * 2,
            this.camHome.z + (Math.random() - 0.5) * a * 2
          );
        },
        () => this.camera.position.copy(this.camHome)
      );
    }

    /* ---------- attacks ---------- */

    // Fire at the closest monster within reach. This runs every frame in every
    // control scheme — walking, standing, chasing a tapped monster — so the
    // attack really is automatic: the player only decides where to stand.
    autoAttack() {
      const p = this.player;
      if (this.now < p.nextAttack) return;
      let best = null;
      let bestD = p.range;
      this.monsters.forEach((m) => {
        if (!m.alive) return;
        const d = dist(m.gx, m.gz, p.gx, p.gz);
        if (d <= bestD) {
          bestD = d;
          best = m;
        }
      });
      if (!best) return;
      p.nextAttack = this.now + p.cd;
      this.faceToward(p, best.gx - p.gx, best.gz - p.gz);
      this.swing(p, best);
      this.fireBolt(best);
    }

    // Bolts home on their target for as long as it lives, so an auto-attack the
    // player didn't aim can't be dodged by a monster wandering sideways
    // mid-flight. The damage roll happens at launch — it's the shot that was
    // fired, not the impact, that decides how hard it hits — and the last known
    // target point is remembered, so a bolt whose target dies still has
    // somewhere to fly before it fizzles.
    fireBolt(m) {
      const p = this.player;
      const b = {
        model: this.add(new THREE.Mesh(this.boltGeo, this.boltMat)),
        gx: p.gx,
        gz: p.gz,
        target: m,
        tx: m.gx,
        tz: m.gz,
        dmg: randInt(p.dmg[0] + p.attack, p.dmg[1] + p.attack),
        expiresAt: this.now + BOLT_MAX_MS,
      };
      this.placeBolt(b, m.gx - p.gx, m.gz - p.gz);
      this.bolts.push(b);
    }

    // Bolts share one geometry and one material, so they are removed from the
    // world without disposing anything — see dropBolt.
    dropBolt(b) {
      this.world.remove(b.model);
    }

    placeBolt(b, dx, dz) {
      b.model.position.set(b.gx, BOLT_LIFT, b.gz);
      if (dx || dz) b.model.rotation.y = Math.atan2(dx, dz);
    }

    updateBolts(dt) {
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i];
        if (b.target) {
          if (b.target.alive) {
            b.tx = b.target.gx;
            b.tz = b.target.gz;
          } else {
            b.target = null; // died in flight — fly on to where it was and fizzle
          }
        }
        const dx = b.tx - b.gx;
        const dz = b.tz - b.gz;
        const d = Math.hypot(dx, dz);
        const step = BOLT_SPEED * dt;
        if (d <= step + BOLT_HIT_R || this.now >= b.expiresAt) {
          this.resolveBolt(b);
          this.bolts.splice(i, 1);
          continue;
        }
        b.gx += (dx / d) * step;
        b.gz += (dz / d) * step;
        this.placeBolt(b, dx, dz);
      }
    }

    // End of flight: a live target takes the hit, anything else is a fizzle.
    // Either way the shard bursts and the object goes away.
    resolveBolt(b) {
      const hit = !!(b.target && b.target.alive);
      this.boltBurst(b.gx, b.gz, hit);
      this.dropBolt(b);
      if (hit) this.hurtMonster(b.target, b.dmg, "#ffe7a3");
    }

    // A quick spark where the shard came apart — bright and big for a hit,
    // smaller and dimmer for a fizzle, so the two read differently at a glance.
    // The material is cloned per burst because its opacity is animated.
    boltBurst(gx, gz, hit) {
      const s = new THREE.Mesh(this.burstGeo, this.burstMat.clone());
      s.position.set(gx, BOLT_LIFT, gz);
      this.add(s);
      this.addFx(
        hit ? 180 : 130,
        (t) => {
          s.scale.setScalar((hit ? 0.16 : 0.1) * (1 + t * (hit ? 2.2 : 1.2)));
          s.material.opacity = (hit ? 0.95 : 0.55) * (1 - t);
        },
        () => {
          this.world.remove(s);
          s.material.dispose(); // the geometry is shared; only the clone is ours
        }
      );
    }

    // Drop every bolt still in the air. The sim stops once the fight is over,
    // so without this the last shots of a run would hang in mid-air under the
    // death screen forever.
    clearBolts() {
      this.bolts.forEach((b) => this.dropBolt(b));
      this.bolts = [];
    }

    // A monster commits to a swing: it locks in place (see the update loop's
    // early return for winding-up monsters — it can't close distance while it
    // winds up) and telegraphs for MONSTER_WINDUP_MS before landMonsterAttack
    // decides whether the blow actually connects. The cadence still ticks from
    // the moment it *decides* to swing, so the wind-up gives a reactive player
    // a window without slowing the monster down.
    monsterAttack(m) {
      if (this.over) return;
      m.windingUp = true;
      m.windupEndsAt = this.now + MONSTER_WINDUP_MS;
      m.nextAttack = this.now + m.cd;
      m.tell.group.visible = true;

      // Pull back away from the target and swell up — a tell big enough to read
      // from across the room, against the dark floor. The guard matters: a
      // monster killed (or a fight ended) mid-wind-up has already had its scale
      // and stance reset by cancelWindup, and this must not put them back.
      const dx = this.player.gx - m.gx;
      const dz = this.player.gz - m.gz;
      const len = Math.hypot(dx, dz) || 1;
      this.addFx(MONSTER_WINDUP_MS, (t) => {
        if (!m.windingUp) return;
        const e = Math.sin((t * Math.PI) / 2); // ease-out
        m.lunge.x = (-dx / len) * MONSTER_PULLBACK * e;
        m.lunge.z = (-dz / len) * MONSTER_PULLBACK * e;
        m.model.scale.setScalar(1 + (MONSTER_WINDUP_SCALE - 1) * e);
      });
    }

    // Per-monster ground tell: a ring at its actual reach, plus a beam toward
    // the player that flips from warning-red to safe-green the instant they
    // step outside it.
    makeTelegraph(range) {
      const group = new THREE.Group();
      const ring = this.groundRing(range - 0.07, range + 0.07, MONSTER_TELL_COLOR, 0.85);
      ring.position.y = 0.03;
      const beamGeo = new THREE.PlaneGeometry(1, 0.16);
      beamGeo.rotateX(-Math.PI / 2);
      beamGeo.translate(0.5, 0, 0); // origin at the monster's end, running along +X
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: MONSTER_TELL_COLOR,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      beam.position.y = 0.035;
      group.add(ring, beam);
      group.visible = false;
      return { group: group, ring: ring, beam: beam };
    }

    // Redrawn every frame of the wind-up, so the beam — and the hit/miss read
    // it gives — tracks the player's live position even though the monster
    // itself is holding still.
    drawTelegraph(m) {
      const t = clamp((this.now - (m.windupEndsAt - MONSTER_WINDUP_MS)) / MONSTER_WINDUP_MS, 0, 1);
      const inRange = dist(m.gx, m.gz, this.player.gx, this.player.gz) <= m.range;
      const color = inRange ? MONSTER_TELL_COLOR : MONSTER_TELL_SAFE_COLOR;
      const g = m.tell;
      g.group.position.set(m.gx, 0, m.gz);
      g.ring.material.color.setHex(color);
      g.ring.material.opacity = 0.5 + t * 0.45;
      g.beam.material.color.setHex(color);
      g.beam.material.opacity = 0.45 + t * 0.45;

      const dx = this.player.gx - m.gx;
      const dz = this.player.gz - m.gz;
      const len = Math.hypot(dx, dz);
      g.beam.scale.x = Math.max(0.001, len);
      g.beam.rotation.y = Math.atan2(-dz, dx);
    }

    // The wind-up is over. The blow only lands if the player is still inside
    // range at this exact moment — otherwise it's a clean whiff. The monster
    // follows through on the swing either way; only the outcome differs.
    landMonsterAttack(m) {
      m.windingUp = false;
      m.tell.group.visible = false;
      m.model.scale.setScalar(1);
      this.swing(m, this.player);

      if (dist(m.gx, m.gz, this.player.gx, this.player.gz) > m.range) {
        this.popNumber(this.player.gx, this.player.barY, this.player.gz, "MISS", "#9fb4d8");
        return;
      }

      // Defense comes off the roll, but a blow never lands for nothing —
      // MIN_HIT is what keeps a deep defensive run in a fight it can still
      // lose. A partly-blocked hit pops in a cooler colour, so the boon is
      // visibly doing something on every swing that connects.
      const roll = randInt(m.dmg[0], m.dmg[1]);
      const dmg = Math.max(MIN_HIT, roll - this.player.defense);
      this.player.hp = Math.max(0, this.player.hp - dmg);
      this.popNumber(this.player.gx, this.player.barY, this.player.gz, dmg, dmg < roll ? "#ffa48a" : "#ff6b6b");
      this.flash(this.player.model, 0x992222);
      this.knockback(this.player, m);
      this.shakeCamera(0.07, 120);
      this.refreshHud();
      if (this.player.hp <= 0) this.endGame();
    }

    // Shove `entity` a short distance straight away from `attacker` on a landed
    // hit. Clamped through canStand — if the shove would land in a wall it's
    // dropped rather than clamped into the obstacle.
    knockback(entity, attacker) {
      const dx = entity.gx - attacker.gx;
      const dz = entity.gz - attacker.gz;
      const len = Math.hypot(dx, dz);
      let ux, uz;
      if (len > 0.0001) {
        ux = dx / len;
        uz = dz / len;
      } else {
        // (Near-)coincident with the attacker — no line to push along. Shove
        // away from the arena centre instead of pushing nobody.
        const cx = entity.gx - GRID / 2;
        const cz = entity.gz - GRID / 2;
        const clen = Math.hypot(cx, cz);
        ux = clen > 0.0001 ? cx / clen : 1;
        uz = clen > 0.0001 ? cz / clen : 0;
      }
      const nx = clamp(entity.gx + ux * KNOCKBACK_DIST, BODY_R, GRID - BODY_R);
      const nz = clamp(entity.gz + uz * KNOCKBACK_DIST, BODY_R, GRID - BODY_R);
      if (this.canStand(nx, nz, BODY_R)) {
        entity.gx = nx;
        entity.gz = nz;
      }
    }

    // A short lunge toward the victim: a monster's swing, and the exile's
    // throwing motion as a bolt leaves. The offset lives on the entity (not the
    // model) so per-frame placement and the animation never fight over it.
    swing(attacker, victim) {
      const dx = victim.gx - attacker.gx;
      const dz = victim.gz - attacker.gz;
      const len = Math.hypot(dx, dz) || 1;
      this.addFx(
        180,
        (t) => {
          const e = Hollow3D.pingPong(t) * SWING_LUNGE;
          attacker.lunge.x = (dx / len) * e;
          attacker.lunge.z = (dz / len) * e;
        },
        () => {
          attacker.lunge.x = 0;
          attacker.lunge.z = 0;
        }
      );
    }

    // Briefly tint every material in a body. Materials are per-instance (see
    // lambert()), so this only flashes the body that was hit.
    flash(group, color) {
      const saved = [];
      group.traverse((o) => {
        if (o.isMesh && o.material.emissive) {
          saved.push([o.material, o.material.emissive.getHex()]);
          o.material.emissive.setHex(color);
        }
      });
      this.after(90, () => {
        saved.forEach((s) => s[0].emissive.setHex(s[1]));
      });
    }

    hurtMonster(m, dmg, color) {
      m.hp -= dmg;
      this.popNumber(m.gx, m.barY, m.gz, dmg, color);
      this.flash(m.model, 0xaa3333);
      if (m.hp <= 0) {
        m.hp = 0;
        this.killMonster(m);
      }
      this.drawBar(m);
    }

    // Drop a monster's wind-up (tell, swell, pull-back) without resolving it —
    // for one that dies mid-swing, or one left hanging when the fight ends.
    cancelWindup(m) {
      m.windingUp = false;
      m.tell.group.visible = false;
      m.model.scale.setScalar(1);
      m.lunge.x = 0;
      m.lunge.z = 0;
    }

    killMonster(m) {
      m.alive = false;
      m.bar.visible = false;
      this.cancelWindup(m);
      this.kills++;
      if (this.player.target === m) this.player.target = null;
      // Topple and sink, then free the body. Waves repeat indefinitely, so a
      // corpse left in the scene would pile up for the length of the run.
      const model = m.model;
      this.addFx(
        340,
        (t) => {
          model.rotation.x = (t * Math.PI) / 2;
          model.position.y = -0.55 * t;
          model.scale.setScalar(1 - t * 0.25);
        },
        () => {
          this.drop(model);
          this.drop(m.bar);
          this.drop(m.tell.group);
        }
      );
      if (Math.random() < FLASK_CHANCE) this.dropFlask(m.gx, m.gz);
      this.dropGold(m.gx, m.gz);
      // Leech: the kill itself pays, which is what makes the boon a survival
      // pick rather than a flat heal — it rewards killing faster.
      const p = this.player;
      if (p.leech > 0 && p.hp < p.maxHp) {
        const healed = Math.min(p.leech, p.maxHp - p.hp);
        p.hp += healed;
        this.popNumber(p.gx, p.barY, p.gz, "+" + healed, "#7dd87d");
      }
      this.refreshHud();
      if (this.monsters.every((e) => !e.alive)) {
        this.after(500, () => this.onWaveCleared());
      }
    }

    dropFlask(gx, gz) {
      const model = this.add(this.makeFlask());
      model.position.set(gx, 0, gz);
      this.flasks.push({ model: model, gx: gx, gz: gz, born: this.now });
    }

    // Scatter this kill's coins — usually none — around the corpse, keeping
    // every piece on ground the player can actually walk onto. A corpse next
    // to a pillar has most of its scatter arc inside the pillar, so several
    // angles are tried before falling back to the corpse's own spot, which a
    // monster standing there had to satisfy canStand to reach. The drop is
    // never silently swallowed.
    dropGold(gx, gz) {
      const pieces = rollGoldDrop();
      for (let i = 0; i < pieces; i++) {
        let cx = gx;
        let cz = gz;
        for (let tries = 0; tries < 8; tries++) {
          const a = Math.random() * Math.PI * 2;
          const d = GOLD_SCATTER * (0.35 + Math.random() * 0.65);
          const nx = gx + Math.cos(a) * d;
          const nz = gz + Math.sin(a) * d;
          if (this.canStand(nx, nz, BODY_R)) {
            cx = nx;
            cz = nz;
            break;
          }
        }
        const model = this.add(this.makeCoin());
        model.position.set(cx, 0, cz);
        model.rotation.y = Math.random() * Math.PI * 2;
        this.coins.push({ model: model, gx: cx, gz: cz, born: this.now });
      }
    }

    // Destroy any flasks left over from the wave that just ended, so an
    // unclaimed one doesn't sit on the floor for the rest of the run.
    clearFlasks() {
      this.flasks.forEach((f) => this.drop(f.model));
      this.flasks = [];
    }

    // Coins are swept at a wave boundary for the same reason flasks are: waves
    // repeat forever, so anything left on the floor accumulates for the length
    // of the run. It also gives the loot a deadline — gold you don't walk over
    // before the wave dies is gold you didn't earn.
    clearCoins() {
      this.coins.forEach((c) => this.drop(c.model));
      this.coins = [];
    }

    /* ---------- movement ---------- */

    // Turn toward a heading a fraction of the way each frame, taking the short
    // way round, so a body never spins the long way to face a new target.
    faceToward(entity, dx, dz) {
      if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return;
      let diff = Math.atan2(dx, dz) - entity.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      entity.facing += diff * 0.35;
    }

    // Step toward (tx, tz). If the straight line is blocked, fan out to wider
    // headings until one is walkable — a cheap stand-in for pathfinding that is
    // enough to round the pillars instead of grinding against a corner. The
    // side that worked is remembered so the entity commits to one way around
    // rather than jittering between them.
    // Returns true when the destination is reached (or is unreachable).
    stepToward(entity, tx, tz, dt) {
      const dx = tx - entity.gx;
      const dz = tz - entity.gz;
      const d = Math.hypot(dx, dz);
      if (d < 0.02) return true;

      const step = Math.min(entity.speed * dt, d);
      const base = Math.atan2(dz, dx);
      const side = entity.detour || 1;
      const offsets = [0];
      [0.5, 1.05, 1.6, 2.2].forEach((a) => offsets.push(a * side, -a * side));

      let moved = false;
      for (let i = 0; i < offsets.length; i++) {
        const ang = base + offsets[i];
        const nx = entity.gx + Math.cos(ang) * step;
        const nz = entity.gz + Math.sin(ang) * step;
        if (!this.canStand(nx, nz, BODY_R)) continue;
        entity.gx = nx;
        entity.gz = nz;
        if (offsets[i] !== 0) entity.detour = offsets[i] > 0 ? 1 : -1;
        moved = true;
        break;
      }

      this.faceToward(entity, dx, dz);
      return !moved || d - step < 0.02;
    }

    // Walk the player along a screen-space direction at up to `scale` (0..1) of
    // full speed — shared by the stick (analog) and the keyboard (all or
    // nothing). The direction is rotated into world space by the camera's own
    // ground axes, so "up" always means "away from the viewer" whatever the
    // camera angle is. Aiming far past the player lets stepToward just walk the
    // heading, keeping its wall-collision and detour handling.
    driveHeading(p, dt, dx, dy, scale) {
      this.tmpV.copy(this.camRight).multiplyScalar(dx).addScaledVector(this.camFwd, -dy);
      const len = Math.hypot(this.tmpV.x, this.tmpV.z);
      if (len < 0.0001) return;
      this.stepToward(p, p.gx + (this.tmpV.x / len) * 10, p.gz + (this.tmpV.z / len) * 10, dt * scale);
    }

    // Keep bodies from stacking into one unreadable clump: monsters push each
    // other apart, and they never crowd inside the player.
    separate() {
      const living = this.monsters.filter((m) => m.alive);
      for (let i = 0; i < living.length; i++) {
        for (let j = i + 1; j < living.length; j++) {
          this.pushApart(living[i], living[j], SPREAD, 0.5);
        }
      }
      living.forEach((m) => this.pushApart(this.player, m, PLAYER_SPREAD, 0));
    }

    // Separate a and b to `min` tiles apart. `aShare` is how much of the
    // correction a takes (0 = b moves the whole way). A winding-up entity holds
    // its exact spot — being shoved could push a monster out of its own range
    // for a whiff the player didn't earn — but the guarantee still holds, so
    // its share is handed to the other side rather than dropped.
    pushApart(a, b, min, aShare) {
      const dx = b.gx - a.gx;
      const dz = b.gz - a.gz;
      const d = Math.hypot(dx, dz);
      if (d < 0.0001 || d >= min) return;
      const gap = min - d;
      const ux = dx / d;
      const uz = dz / d;

      let shareA = a.windingUp ? 0 : aShare;
      let shareB = b.windingUp ? 0 : 1 - aShare;
      if (a.windingUp && !b.windingUp) shareB = 1;
      if (b.windingUp && !a.windingUp) shareA = 1;

      if (shareA > 0) {
        const ax = a.gx - ux * gap * shareA;
        const az = a.gz - uz * gap * shareA;
        if (this.canStand(ax, az, BODY_R)) {
          a.gx = ax;
          a.gz = az;
        }
      }
      if (shareB > 0) {
        const bx = b.gx + ux * gap * shareB;
        const bz = b.gz + uz * gap * shareB;
        if (this.canStand(bx, bz, BODY_R)) {
          b.gx = bx;
          b.gz = bz;
        }
      }
    }

    /* ---------- frame ---------- */

    tick(ts) {
      this.raf = requestAnimationFrame(this.tick);
      const delta = Math.min(ts - this.lastFrame, 50);
      this.lastFrame = ts;
      this.now = ts;

      // Effects and timers keep running past death, so the last kill's animation
      // and the corpse cleanup still finish under the end screen.
      this.runFx();
      if (!this.over) this.update(delta / 1000);
      this.renderer.render(this.scene, this.camera);
    }

    update(dt) {
      const p = this.player;

      // The stick outranks any walk order while it's pushed; the keyboard does
      // the same whenever a movement key is down, deferring to the stick if —
      // implausibly — both are active, since a hand drives one at a time.
      const throwLen = this.joy.active ? Math.hypot(this.joy.dx, this.joy.dy) : 0;
      const onStick = throwLen > JOY_DEAD;
      const keysDir = onStick ? null : this.keysHeading();
      if (onStick) {
        p.target = null;
        p.moveTo = null;
        this.driveHeading(p, dt, this.joy.dx, this.joy.dy, Math.min(1, (throwLen - JOY_DEAD) / (1 - JOY_DEAD)));
      } else if (keysDir) {
        p.target = null;
        p.moveTo = null;
        this.driveHeading(p, dt, keysDir.dx, keysDir.dy, 1);
      }

      // Tapping a monster is purely a movement order — close until it's inside
      // auto-attack range — since which monster gets shot is autoAttack's call.
      // Both branches are dead while the stick or the keys are driving.
      if (p.target && !p.target.alive) p.target = null;
      if (p.target) {
        if (dist(p.gx, p.gz, p.target.gx, p.target.gz) > p.range) {
          this.stepToward(p, p.target.gx, p.target.gz, dt);
        }
      } else if (p.moveTo) {
        if (this.stepToward(p, p.moveTo.gx, p.moveTo.gz, dt)) p.moveTo = null;
      }
      this.autoAttack();

      // Monsters: aggro, chase, swing.
      this.monsters.forEach((m) => {
        // A monster earlier in this same pass can land the killing blow and end
        // the run mid-forEach — re-check, so a later one can't start a wind-up
        // that no future frame would ever resolve.
        if (this.over || !m.alive) return;
        if (m.windingUp) {
          // Committed to the swing: it holds its ground instead of closing
          // distance, so the tell is the only thing moving.
          this.drawTelegraph(m);
          if (this.now >= m.windupEndsAt) this.landMonsterAttack(m);
          return;
        }
        const d = dist(m.gx, m.gz, p.gx, p.gz);
        if (d > m.def.aggro) return;
        if (d > m.range) {
          this.stepToward(m, p.gx, p.gz, dt);
        } else {
          this.faceToward(m, p.gx - m.gx, p.gz - m.gz);
          if (this.now >= m.nextAttack) this.monsterAttack(m);
        }
      });
      this.separate();

      // Bolts move after everything else, so they home on where their target
      // actually ended this frame rather than a stale position.
      this.updateBolts(dt);

      // Flask pickups, bobbing gently while they wait.
      for (let i = this.flasks.length - 1; i >= 0; i--) {
        const f = this.flasks[i];
        f.model.position.y = 0.08 + Math.sin((this.now - f.born) / 260) * 0.06;
        f.model.rotation.y += dt * 1.6;
        if (dist(f.gx, f.gz, p.gx, p.gz) < 0.55) {
          p.hp = Math.min(p.maxHp, p.hp + FLASK_HEAL);
          this.popNumber(f.gx, 0.8, f.gz, "+" + FLASK_HEAL, "#7dd87d");
          this.drop(f.model);
          this.flasks.splice(i, 1);
          this.refreshHud();
        }
      }

      // Gold, spinning on the spot. The pickup radius is wide on purpose (see
      // GOLD_PICKUP_R) — brushing past a coin claims it.
      for (let i = this.coins.length - 1; i >= 0; i--) {
        const c = this.coins[i];
        c.model.position.y = Math.sin((this.now - c.born) / 300) * 0.04;
        c.model.rotation.y += dt * 2.6;
        if (dist(c.gx, c.gz, p.gx, p.gz) < GOLD_PICKUP_R) {
          this.gold++;
          this.popNumber(c.gx, 0.85, c.gz, "+1", "#ffd23f");
          this.drop(c.model);
          this.coins.splice(i, 1);
          this.bumpGold();
          this.refreshHud();
        }
      }

      // Re-place every living body, and keep the health bars facing the camera.
      this.place(p);
      this.monsters.forEach((m) => {
        if (m.alive) {
          this.place(m);
          this.drawBar(m);
        }
      });

      if (p.target) {
        this.targetRing.visible = true;
        this.targetRing.position.set(p.target.gx, 0.04, p.target.gz);
      } else {
        this.targetRing.visible = false;
      }
      this.refreshHud();
    }

    /* ---------- end ---------- */

    // There is no clearing the hollow — this only fires on death. A run's score
    // is how far the waves pushed you, with total kills as the tiebreaker.
    endGame() {
      if (this.over) return;
      this.over = true;
      this.player.target = null;
      this.player.moveTo = null;
      // The sim stops here, so anything mid-wind-up would otherwise be frozen
      // forever: swelled scale, pulled-back stance, a telegraph ring stuck on
      // its last frame.
      this.monsters.forEach((m) => {
        if (m.windingUp) this.cancelWindup(m);
      });
      this.clearFlasks();
      this.clearCoins();
      this.clearBolts();
      // Dying with the picker open is possible in principle (a bolt still in
      // the air can finish the last monster, and the wave-cleared delay runs
      // either way) — the death screen wins.
      this.closeUpgrades();
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.el.banner.style.opacity = "0";

      const isBest =
        this.wave > this.startBest.wave || (this.wave === this.startBest.wave && this.kills > this.startBest.kills);
      this.saveBest();

      this.el.summary.innerHTML =
        "Wave reached: " +
        this.wave +
        "<br>Monsters slain: " +
        this.kills +
        "<br>Gold collected: " +
        this.gold +
        "<br>Boons: " +
        this.boonSummary() +
        "<br>" +
        (isBest ? "★ New Best!" : "Best: Wave " + this.startBest.wave + " (" + this.startBest.kills + ")");
      this.el.death.classList.add("is-open");
    }

    // Persistent best run, the same loadX/saveX-plus-try/catch idiom the other
    // Fantasia games use for their high scores.
    loadBest() {
      try {
        const raw = JSON.parse(localStorage.getItem(BEST_KEY));
        if (raw && Number.isFinite(raw.wave) && Number.isFinite(raw.kills)) return raw;
      } catch (e) {
        /* storage unavailable, or a value from before this shape existed */
      }
      return { wave: 0, kills: 0 };
    }

    saveBest() {
      try {
        if (this.wave > this.startBest.wave || (this.wave === this.startBest.wave && this.kills > this.startBest.kills)) {
          localStorage.setItem(BEST_KEY, JSON.stringify({ wave: this.wave, kills: this.kills }));
        }
      } catch (e) {
        /* storage may be unavailable; ignore */
      }
    }

    toMenu() {
      if (typeof window.returnToMenu === "function") window.returnToMenu();
    }

    // Start a fresh run in the same renderer: wipe everything the last run put
    // in the world, then build it again. Cheaper — and far less likely to lose
    // the WebGL context — than tearing the canvas down and remaking it.
    restart() {
      this.clearWorld();
      this.startRun();
    }

    clearWorld() {
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.el.banner.style.opacity = "0";
      this.fx = [];
      this.timers = [];
      this.bolts = [];
      this.flasks = [];
      this.coins = [];
      this.monsters = [];
      this.el.gold.classList.remove("is-bumped");
      this.camera.position.copy(this.camHome);
      // Everything a run creates lives under `world`, including effects still
      // mid-flight whose own cleanup will never run now.
      while (this.world.children.length) this.drop(this.world.children[0]);
      [this.boltGeo, this.boltMat, this.burstGeo, this.burstMat].forEach((r) => {
        if (r) r.dispose();
      });
      this.boltGeo = this.boltMat = this.burstGeo = this.burstMat = null;
      this.el.pops.innerHTML = "";
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      clearTimeout(this.hintTimer);
      this.clearWorld();
      this.listeners.forEach((l) => l[0].removeEventListener(l[1], l[2], l[3]));
      this.listeners = [];
      this.renderer.dispose();
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
  }

  /* ---------- boot ---------- */

  function injectStyle() {
    if (document.getElementById("gh3-style")) return;
    const s = document.createElement("style");
    s.id = "gh3-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // three is a 670 KB ES module, so it's fetched the first time this game is
  // picked rather than on every visit to the Fantasia menu.
  function ensureThree() {
    if (THREE) return Promise.resolve(THREE);
    return import(THREE_URL).then((mod) => {
      THREE = mod;
      return mod;
    });
  }

  function launchGloomHollow3D() {
    if (window.gloom3DGame) return window.gloom3DGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "gh3-root";
    root.innerHTML = '<div class="gh3-loading">Entering the hollow…</div>' + HUD_HTML;
    document.getElementById("game-container").appendChild(root);

    // The handle exists before three has finished loading, so returning to the
    // menu mid-load tears the right things down — and stops the game from ever
    // starting — instead of leaving an orphan canvas behind.
    const handle = {
      root: root,
      game: null,
      cancelled: false,
      destroy: function () {
        this.cancelled = true;
        if (this.game) {
          this.game.destroy();
          this.game = null;
        }
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.gloom3DGame = handle;

    ensureThree()
      .then(() => {
        if (handle.cancelled) return;
        const loading = root.querySelector(".gh3-loading");
        if (loading) loading.remove();
        handle.game = new Hollow3D(root);
      })
      .catch((err) => {
        const loading = root.querySelector(".gh3-loading");
        if (loading) loading.textContent = "Could not load three.js";
        console.error("Gloom Hollow 3D failed to start:", err);
      });

    return handle;
  }

  window.launchGloomHollow3D = launchGloomHollow3D;
})();
