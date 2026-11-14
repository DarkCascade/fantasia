# PRD: Daily Dungeon (working title)

| | |
|---|---|
| **Status** | Draft v0.2 (rules settled; ready to split into issues) |
| **Owner** | Fantasia project |
| **Date** | 2026-11-14 |
| **Target** | A new game in the Fantasia menu, built as static HTML/CSS/JS (no backend) |
| **Issues** | Label [`daily-dungeon`](https://github.com/DarkCascade/fantasia/issues?q=label%3Adaily-dungeon). Milestone parents: M0 #7, M1 #15, M2 #19, M3 #26, M4 #30, M5 #33 |

**Relationship to Party Line.** `PRD-daily-party-builder.md` (*Party Line*) is
a competing take on the same goal, a fantasy dungeon-delve daily. Daily
Dungeon is the simpler, casual version and is the one being built first.
Party Line is parked as a possible deeper follow-up (§19). Its verification
approach is adopted here (§12). Its relics, mutators and turn-based combat are
deliberately **not**.

---

## 1. Summary

Daily Dungeon is a once-a-day browser puzzle that combines the tactical
optimization of an auto-battler with the one-and-done deduction loop of a
daily word game such as Wordle. Every player gets the same 5-room dungeon and
the same roster of adventurers. The player chooses four heroes and orders
them, then watches an automated run resolve room by room. Positioning is the
puzzle. Each day ends with a spoiler-free emoji grid that players can share.

## 2. Problem and Goals

**Problem.** Auto-battlers reward strong builds but are slow to learn and
hard to talk about. Daily word games are easy to share but have no tactical
depth. A daily game needs rules that are transparent, feedback that is
immediate, and an outcome that fits in a text message.

**Goals**

1. **Make party order the core decision.** A game where the only question is
   "is a Rogue in the party?" is a lock-and-key matching puzzle. Ordering has
   to decide the outcome. The levers for this are: rooms that hit different
   slots (§7.2), counters that only work from certain slots (§8), and
   rotation that moves heroes during the run (§7.3).
2. **Transparent rules.** Everything that affects a run is stated on screen,
   including exact times. The only hidden information is what Rooms 3 and 4
   contain, and that is revealed on a schedule (§11).
3. **Deduction over attempts.** Attempt 1 is exploration. Attempts 2 and 3 are
   optimization against information gathered earlier.
4. **Shareable in one glance.** The result fits in a short emoji grid that
   gives nothing away.
5. **Respect both casual and hardcore players.** A 1-star clear is a real
   win. A 3-star run is a real achievement.

## 3. Non-Goals (v1)

- No accounts, backend, leaderboards or friend systems. Everything is local.
- No real-time multiplayer or player-vs-player.
- No hero leveling, equipment or meta-progression. Each day stands alone.
- No paid content, ads or monetization.
- No procedural generation beyond the daily seed. Tomorrow's dungeon is
  generated from the date, not from the player's history.
- No archive mode for past dailies and no practice replays in v1 (§19).
- No relics, mutators or turn-based combat (those belong to Party Line).

## 4. Target Players

- **Daily-ritual players** who open a game once a day and share the result.
- **Tactics fans** who enjoy auto-battlers and want to tune a lineup.
- **Casual players** who want a short, satisfying session of under three
  minutes.

## 5. Core Loop

1. **Open the daily.** The player sees Rooms 1, 2 and 5 in full, a Rumor for
   Rooms 3 and 4 (§6.2), and today's roster of **5 or 6** heroes (§8).
2. **Build a party.** The player picks **4 heroes** and assigns each to a slot
   from **Slot 1 (Front)** to **Slot 4 (Back)**.
3. **Enter the dungeon.** The player presses **Enter Dungeon**. The run
   resolves automatically, room by room. The player can watch it at normal
   speed, fast-forward, or skip to the result.
4. **Read the result.** The screen shows the stars earned, what happened in
   each room, and any rooms that were revealed.
5. **Plan the next attempt.** The player has **3 attempts per day**. The
   attempt history is kept on the screen so players can compare.
6. **Share.** When the day ends, the player copies the emoji grid.

### 5.1 Day Structure

- A **day** runs from 00:00 to 23:59 **UTC**. A new dungeon, roster and boss
  are available at the reset, and the screen shows a countdown to it.
- The player has **3 attempts**. A 3-star result **ends the day early**,
  because nothing more can be gained. The share grid then has fewer rows.
- After the third attempt, or after an early 3-star, the day is locked
  until reset. The player can still review results and copy the grid.

## 6. Dungeon Structure

Each dungeon has **exactly 5 rooms** and is the same for every player on a
given day.

| Room | Visibility at start | Notes |
|---|---|---|
| 1 | Fully visible (e.g. *Spike Trap*) | Opening test |
| 2 | Fully visible (e.g. *Skeleton Horde*) | Teaches the second rule |
| 3 | Rumor only (e.g. *A whiff of ozone*) | One of two possible rooms (§6.2) |
| 4 | Rumor only (e.g. *Whispers in the dark*) | One of two possible rooms (§6.2) |
| 5 | Fully visible (*The Boss*) | Always visible so the goal is clear |

### 6.1 Room Types

Each room has a **type**, a **damage** value, a **base time** in seconds, and
a **target**: where its damage lands in the line. Each type maps to a hero
ability, which keeps party composition tied to slot decisions.

| Room type | Damage target | Countered by | Effect of the counter |
|---|---|---|---|
| Trap (Spike Trap, Rune Trap) | Slot 1, on entry | Rogue in Slot 1 or 2 | Trap disarmed, no damage. Rogue rotates and is exhausted (§7.3) |
| Swarm (Skeleton Horde) | Front of line, overflow carries back | Mage, any slot | Room cleared: no damage, −20 s. Mage rotates and is exhausted |
| Magic | Front of line, overflow carries back | Mage, any slot | As Swarm |
| Elite combat | Front of line, overflow carries back | Knight in Slot 1 | Damage −2 |
| Ambush | **Slot 4** | Ranger in Slot 4 | Ambush cancelled, no damage |
| Boss | Front of line, overflow carries back | Knight in Slot 1; Berserker | Knight: damage −2. Berserker: −15 s if at full HP on entry |

The Knight's −2 applies to every combat-type room (Swarm, Magic, Elite, Boss)
that the Mage has not cleared. It never applies to Traps or Ambushes.

Damage, base times and the Mage's −20 s are placeholders, tuned in M1
(§17). The Mage's "cancel" effect is subject to a spike (§16, D1).

### 6.2 Rumors

Rooms 3 and 4 show a **Rumor** instead of the room. Each Rumor has two
possible rooms, so attempt 1 is a real guess.

| Rumor | Possible rooms |
|---|---|
| *A whiff of ozone* | Magic room (Mage) **or** Rune Trap (Rogue) |
| *Whispers in the dark* | Ambush (Ranger, Slot 4) **or** Elite combat (Knight) |
| *Bones rattle* | Swarm (Mage) **or** Elite combat (Knight) |

The generator picks a Rumor for each hidden room, then picks which of its two
rooms is real. The verification step (§12) makes sure guessing wrong
actually costs something.

## 7. The Party and the Line

### 7.1 Slots

- Four slots, **Slot 1 (Front)** to **Slot 4 (Back)**.
- A **line** is the ordered list of heroes still standing. A knocked-out hero
  leaves the line and everyone behind moves forward.

### 7.2 Damage and the Vanguard Rule

Where damage lands depends on the room type (§6.1):

- **Traps** hit Slot 1 on entry. Damage beyond that hero's HP is lost.
- **Combat rooms** (Swarm, Magic, Elite, Boss) apply their damage to the front
  of the line. Damage beyond a hero's remaining HP carries to the next hero.
- **Ambushes** hit Slot 4, the back of the line. With fewer than four heroes
  standing, they hit the back-most hero. Damage beyond that hero's HP is lost.

So **who is at the front, and who is at the back, decides who gets hurt.**

### 7.3 Exhaustion and Rotation

Only two abilities rotate: the **Rogue's disarm** and the **Mage's room
clear**. These are one-shot counters. Every other ability is a formation
ability and leaves its hero in place.

When the Rogue or Mage uses its ability:

1. The hero becomes **Exhausted** for the next room. Exhausted heroes do
   not use their abilities in that room.
2. The hero **rotates to Slot 4 (Back)**. Everyone behind them moves forward
   one slot.

Exhausted heroes **stay in the line and take hits normally**. Because they
have just rotated to Slot 4, an Ambush in the next room hits them. That is
intended: a Mage who clears Room 2 is sitting in Slot 4, exhausted and with
2 HP, if Room 3 turns out to be an Ambush.

Rotation also pushes a Slot-4 Ranger forward, which costs it its ambush
protection and speed bonus. Players must mentally simulate how the line
shifts after each room. The replay shows each shift explicitly so it can be
learned.

### 7.4 Positional Synergies

- **Cleric** restores 1 HP to the hero **directly in front** of them after
  each room.
- **Bard** (proposed, not in v1) boosts the speed of the hero directly ahead.

Positional effects resolve in slot order, front to back.

### 7.5 Resolution Order (per room)

Every room resolves in the same fixed order. Slot conditions ("in Slot 1",
"in Slot 4") are checked against the line **as it stands when the room
starts**.

1. **Counters.** Work out which abilities fire, skipping exhausted heroes:
   Rogue disarm (trap, Rogue in Slot 1–2), Mage clear (swarm/magic), Ranger
   cancel (ambush, Ranger in Slot 4), Knight −2 (combat room not cleared by
   the Mage, Knight in Slot 1), Berserker (boss, at full HP).
2. **Damage.** Apply the room's remaining damage (never below 0) to its
   target: Slot 1, the front with overflow, or Slot 4.
3. **Knockouts.** Heroes at 0 HP leave the line and everyone behind moves
   forward. If nobody is left, the run ends here (💀).
4. **Time.** Room time = base time minus the savings that fired (Mage,
   Berserker, Ranger speed bonus if the Ranger started the room in Slot 4).
   Never below a minimum set in `TUNE`.
5. **Exhaustion.** Clear last room's exhaustion. A Rogue or Mage whose
   ability fired this room becomes exhausted for the next room.
6. **Rotation.** That Rogue or Mage moves to the back of the line.
7. **Heal.** Each Cleric heals the hero directly in front of them by 1, up to
   that hero's maximum HP. A Cleric in Slot 1 heals nobody.

Knocked-out heroes never return. Room 5 counts as cleared (★) if at least
one hero is standing after step 3.

## 8. Hero Roster

Every hero has **3 HP** except the Mage, which has 2.

| Hero | Role | Ability | Rotates? |
|---|---|---|---|
| Knight | Tank | In Slot 1, combat-room damage −2 | No |
| Rogue | Scout | Disarms traps from Slot 1 or 2 | **Yes** |
| Mage | DPS | Clears Swarm and Magic rooms: no damage, −20 s. Only 2 HP | **Yes** |
| Cleric | Healer | Restores 1 HP to the hero directly in front after each room | No |
| Ranger | Support | In Slot 4, cancels Ambushes and gives bonus speed | No |
| Berserker | Bruiser | At full HP on entering the boss room, −15 s | No |

**Roster size.** v1 launches with these **6 heroes**. Each day's roster is
**5 or 6** of them, chosen by the generator. Leaving a hero out is a
difficulty lever ("no Rogue today"). New heroes are post-v1 (§19).

The Ranger's speed bonus is a tuning value (M1).

## 9. Timing

Time drives the 3-star target and the Mage, Ranger and Berserker abilities.

- Each room has a **base time** in seconds. Combat rooms take longer than
  trap rooms.
- Abilities subtract time as stated in §8.
- The run's **total time** is the sum of room times after modifiers.
- Each day has a **Gold Par Time**, derived by the generator from the best
  possible run (§12). A run under par with no knockouts earns 3 stars.
- Times are shown in **exact seconds**, in the lineup preview, the playback
  and the result.

Time is the only effect that changes with speed. Everything else is a
deterministic result of the party order.

## 10. Scoring and Stars

Stars are the single measure of mastery. The player does not choose between
time and health.

| Stars | Requirement |
|---|---|
| ★ (1 Star, Clear) | At least one hero survives Room 5 |
| ★★ (2 Stars, Unscathed) | Zero heroes knocked out |
| ★★★ (3 Stars, Gold Par) | Zero heroes knocked out **and** total time under the daily Gold Par Time |

**Best result.** The player's day result is their **best attempt**, compared
by stars and then by total time (lower is better). An exact tie keeps the
earlier attempt.

**No leaderboard in v1.** Score is personal. Stats (played, win rate, star
distribution, streak) are kept locally, in the style of a daily word game.

## 11. Information and Deduction

1. **Before attempt 1**, Rooms 1, 2 and 5 are fully visible. Rooms 3 and 4
   show only their Rumor (§6.2).
2. **After attempt 1 ends**, Rooms 3 and 4 are revealed, whatever the
   outcome. If attempt 1 was a 3-star run the day has already ended, so the
   reveal only matters for the share and review screen.
3. Attempts 2 and 3 are played with complete information.

A player who fails attempt 1 has learned the whole dungeon. That is
intentional: the first attempt is the cost of discovery.

## 12. Daily Generation and Verification

Adapted from Party Line §10. Every daily seed must pass these checks before
it is used:

1. **Solvable.** At least one lineup earns 3 stars.
2. **Varied.** At least two different lineups earn 3 stars, so no single
   lineup is "the answer".
3. **Not trivial.** Simple baselines do not reach 3 stars. Proposed
   baselines: the highest-HP party, and "each counter in room order".
4. **Rumors matter.** Each day has three decoy dungeons: the other
   combinations of what Rooms 3 and 4 could have been. For at least one
   decoy, a share of its 3-star lineups at least `TUNE.rumorMin` must fail to
   earn 3 stars on the real dungeon. The threshold is set in M1.
5. **Par from the solver.** Gold Par Time = the best possible time plus a
   slack, tuned in M1.
6. **Reject and reseed.** A failed seed is regenerated from `date#1`,
   `date#2`, and so on, until one passes.

**Where it runs.** With 5–6 heroes there are at most 360 ordered lineups, so
the generator brute-forces every day in the browser at load. The Node test
suite also sweeps the next 365 days, so a date that cannot produce a valid
dungeon fails CI before it ships.

## 13. Attempt Resolution and the Share Grid

### 13.1 Attempt Playback

- The run resolves room by room with clear feedback: damage, knockouts,
  exhaustion, rotation, abilities, and the running time.
- Speed options: normal, fast, and skip to result.
- Reduced-motion users get the same information as text, with no animation.

### 13.2 Per-Room Result Codes

Each room in each attempt gets one code:

| Code | Meaning |
|---|---|
| ⚔️ | **Flawless**: cleared with no damage taken |
| 😬 | **Damaged**: cleared, but a hero took damage or was knocked out |
| 💀 | **Wipe**: the party was wiped out in this room. The run ends |
| ⬜ | **Not reached**: the run ended before this room |

Time is not part of the per-room code. It lives in the stars and the share
header.

### 13.3 The Share Grid

The grid is spoiler-free. It shows results, not room names or hazard types.
Rooms run across the top and attempts run down the side.

```
Daily Dungeon #142  ★★★  73s
Attempt 1: ⚔️ 😬 💀 ⬜ ⬜
Attempt 2: ⚔️ ⚔️ 😬 😬 ⚔️
```

- The header shows the day number, the best star rating, and the best time.
  The time is optional and can be turned off.
- Each row is one attempt. The grid shows only attempts that were actually
  played.
- The **Copy** button puts this text on the clipboard. The share text does
  not include the party, slot order, hero names, room names or Rumors.
- Day numbers count from the launch date and use the UTC date for the seed.

## 14. Experience Requirements

- **Daily seed.** Every player gets an identical dungeon and roster for the
  same UTC date. The generator is deterministic, so no server is needed.
- **Persistence.** Attempt state for the current day, and lifetime stats, are
  stored in local storage. Reloading mid-day restores the attempts so far.
- **Reset.** At UTC midnight the next day's content is generated. A player who
  returns mid-session sees the new day with no action needed. A countdown to
  the next dungeon is always visible once the day is locked.
- **Onboarding.** A first-run card explains the rules in plain words. There
  are no long tutorials. Room 1 is a readable, low-stakes first lesson.
- **Accessibility.** Keyboard control for the lineup (arrow keys to move a
  hero, Enter to confirm). The room codes are also available as text. Color
  is never the only signal. The emoji grid is copy-friendly text.
- **Mobile.** The lineup must work on a phone screen. Drag-to-reorder and
  tap-to-select are both supported.

## 15. Technical Approach (Fantasia-specific)

- **Form.** A DOM/CSS overlay, not a Phaser or three.js scene. The game is
  turn-by-turn and text-heavy, so a canvas adds little. This matches how
  Indie Grind and Greenlit are built.
- **Files.**
  - `src/daily-dungeon.js`: UI, overlay, playback and share. Exposes
    `window.launchDailyDungeon()` and a `window.dailyDungeonGame` handle with a
    no-argument `destroy()`.
  - `src/daily-dungeon/sim.js`: pure logic (room resolution, line and slot
    rules, scoring, the generator and verifier, share text). Written as a UMD
    module so Node can test it.
  - `src/daily-dungeon/daily.js`: game-agnostic daily plumbing (UTC day key,
    day number, seeded PRNG, per-day state and lifetime stats in storage,
    copy to clipboard). Kept separate so Party Line could reuse it later. It
    is not a shared framework until a second game actually needs it.
- **Menu.** A tile on the **Puzzle & Physics** shelf in `index.html`, plus a
  teardown line in `returnToMenu()`.
- **Seed.** A small deterministic PRNG (for example mulberry32) seeded from the
  UTC date string, with a `#n` suffix for reseeds (§12).
- **Storage keys.** `daily-dungeon-day-YYYY-MM-DD` for the day's attempts,
  `daily-dungeon-stats` for lifetime stats.
- **Security and cheating.** Local storage can be edited. That is acceptable
  for a Wordle-style game with no leaderboard. It must not become a
  leaderboard without a server.
- **Tests** (`test/daily-dungeon.test.js`, run with `node --test test/*.test.js`):
  seed determinism, each damage target (Slot 1 / front with overflow /
  Slot 4), every hero ability, exhaustion and rotation, the Cleric heal,
  star thresholds and best-attempt comparison, share-text format, and the
  365-day verification sweep (§12).
- **Balance harness** (`experiments/daily-dungeon-balance/`): uses the solver
  to report, across many seeds, the share of lineups earning 1, 2 and 3
  stars, the spread of daily difficulty, how often Rumors change the best
  lineup, and how far random and greedy players fall short of the best.
  Target: 3-star rate among all lineups of roughly 5–15%, and a meaningful
  gap between good and great play.

## 16. Decisions and Open Questions

**Decided in v0.2**

| Topic | Decision |
|---|---|
| Damage model | Per-room damage with a target: Slot 1 (traps), front with overflow (combat), Slot 4 (ambush) |
| Rotation | Only the Rogue and the Mage rotate |
| Exhausted heroes | Stay in the line and take hits, but don't use their ability |
| Ranger | Must be in Slot 4 to cancel an Ambush |
| Knight | −2 per combat room while in Slot 1 |
| Cleric | Heals the hero directly in front |
| Hidden rooms | Called **Rumors**. Each Rumor has two possible rooms (§6.2) |
| Flawless (⚔️) | No damage taken. No per-room time target |
| Day boundary | UTC, with a countdown |
| Tiebreak | Stars, then time, then the earlier attempt |
| Early end | A 3-star run ends the day |
| Roster | 6 heroes at launch, 5 or 6 per day |
| Time display | Exact seconds |
| Solvability | Verified by the generator, with reseeding (§12) |

**Open**

- **D1 (spike, M1): Mage halves instead of cancels.** Compare the current
  rule (a Mage clear cancels the room's damage) with halving it (rounded
  down, still −20 s). Measure the effect on 3-star rates, on how often the
  Mage is in the best lineup, and on solution variety. Record the choice
  here.
- **Tuning values (M1).** Room damage and base times, the Mage and
  Berserker time savings, the Ranger speed bonus, par slack, and the Rumor
  threshold in §12.

## 17. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0: Sim prototype** | `sim.js` and `daily.js`: seed, rooms, damage targets, the six heroes, rotation, scoring, share text, generator and verifier. Node tests | Tests green. Verifier passes 365 consecutive days |
| **M1: Balance pass** | Balance harness, spike D1, tune all values in §16 | 3-star rate in target range. No date needs more than a few reseeds |
| **M2: Playable UI** | Lineup screen, Rumors, playback, result, share grid, storage, countdown | Full day playable on desktop and phone with no console errors |
| **M3: Menu integration** | Menu tile, teardown, onboarding card, stats screen | Launches and tears down cleanly from the menu |
| **M4: Polish** | Accessibility pass, reduced motion, sound (optional) | Keyboard and screen-reader checks pass |
| **M5: Launch** | Publish to `main`, verify deploy | Deploy workflow green, `version.json` shows the new commit |

## 18. Success Metrics

- **Completion.** Percentage of players who finish all 3 attempts or hit
  3 stars on a given day. Target: above 60%, so the day feels finishable.
- **Share rate.** Percentage of finished days where the grid is copied.
  Target: above 20%.
- **Return rate.** Percentage of players who return the next day.
- **Difficulty spread.** Distribution of stars per day. No single star level
  should dominate.

v1 has no backend, so these are goals to check by hand. They are not part of
the v1 issue scope.

## 19. Stretch Goals (post-v1)

- Archive mode for past dailies, and practice replays of a locked day.
- More heroes (the Bard from §7.4) and room types.
- A harder "challenge" modifier for experienced players.
- Party Line (`PRD-daily-party-builder.md`) as a deeper follow-up game,
  possibly reusing `daily.js`.
- Optional read-only leaderboard, which would require a backend and is a
  separate decision.
