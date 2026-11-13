# PRD: Daily Dungeon (working title)

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Owner** | Fantasia project |
| **Date** | 2026-11-13 |
| **Target** | A new game in the Fantasia menu, built as static HTML/CSS/JS (no backend) |

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
   to decide the outcome.
2. **Transparent rules.** Everything that affects a run is stated on screen.
   The only hidden information is what the dungeon contains, and that is
   revealed on a schedule.
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
- No archive mode for past dailies in v1 (listed as a stretch goal).

## 4. Target Players

- **Daily-ritual players** who open a game once a day and share the result.
- **Tactics fans** who enjoy auto-battlers and want to tune a lineup.
- **Casual players** who want a short, satisfying session of under three
  minutes.

## 5. Core Loop

1. **Open the daily.** The player sees the dungeon's known rooms, the
   partial information for rooms 3 and 4, the boss, and today's roster of
   6–8 adventurers.
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

- A **day** runs from 00:00 to 23:59 **UTC** (see §12.3). A new dungeon, roster
  and boss are available at the reset.
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
| 3 | Category only (e.g. *Arcane Mystery*) | Torchlight silhouette |
| 4 | Category only (e.g. *Ambush?*) | Torchlight silhouette, with a question mark |
| 5 | Fully visible (*The Boss*) | Always visible so the goal is clear |

### 6.1 Room Types

Each room type maps to a hero ability and to an ordering rule. This keeps
the composition of the party connected to the decisions made about slots.

| Room type | Threat | Countered by | Notes |
|---|---|---|---|
| Trap (Spike Trap, etc.) | Damage on entry, to Slot 1 first | Rogue (disarm, Slots 1–2) | Disarming exhausts the Rogue |
| Swarm / Magic (Skeleton Horde, Arcane Mystery) | Large combat pool | Mage (clears the room, −20 s) | Mage has 2 HP |
| Ambush | Surprise damage | Ranger (ignores ambush damage in any slot) | Category shown before entry |
| Elite combat | Sustained combat pool | Knight (Slot 1 reduction) | Common in the middle rooms |
| Boss | Heavy combat pool | Berserker (−15 s if at full HP on entry) | Always Room 5 |

Room type and threat values are placeholders. They need tuning in the
prototype (§14).

## 7. The Party and the Line

### 7.1 Slots

- Four slots, **Slot 1 (Front)** to **Slot 4 (Back)**.
- A **line** is the ordered list of heroes still standing. A knocked-out hero
  leaves the line and everyone behind moves forward.

### 7.2 The Vanguard Rule

Slot 1 takes the brunt of standard attacks and triggers room entry effects
first. Combat damage is applied to the front of the line. Overflow carries
to the next hero once a front hero is knocked out. The exact damage numbers
are a tuning item (§14), but the principle is fixed: **who is at the front
decides who gets hurt**.

### 7.3 Exhaustion and Rotation

When a hero counters a hazard (for example, the Rogue disarms a trap):

1. The hero becomes **Exhausted** for the next room. Exhausted heroes do
   not use their abilities in that room.
2. The hero **rotates to Slot 4 (Back)**. Everyone behind them moves forward
   one slot.

Players must mentally simulate how the line shifts after each room. The
replay should show this shift explicitly so it can be learned.

### 7.4 Positional Synergies

Abilities that care about neighbors give the order its depth.

- **Cleric** (Healer) restores 1 HP to the hero directly in front of them
  after each room.
- **Bard** (proposed, not in v1 roster) boosts the speed of the hero directly
  ahead.

Positional effects resolve in slot order, front to back, so the Vanguard Rule
still decides who acts first.

## 8. Hero Roster

Every hero has **3 HP** and a unique role. Mage is the exception with 2 HP.

| Hero | Role | Positional passive |
|---|---|---|
| Knight | Tank | In Slot 1, reduces combat damage to the party by 2 |
| Rogue | Scout | Disarms traps in Slot 1 or 2. Rotates to Slot 4 after disarming (§7.3) |
| Mage | DPS | Clears swarm and magic rooms instantly (−20 s). Only 2 HP |
| Cleric | Healer | Restores 1 HP to the hero directly in front after each room |
| Ranger | Support | Prevents ambush damage in any slot. Bonus speed in Slot 4 |
| Berserker | Bruiser | At full HP on entering a boss room, −15 s |

**Roster size.** Each day shows 6–8 heroes and the player picks 4. The
six heroes above are the v1 launch set. For variety, v1 needs at least 8 in
the pool, and 12 is the target for a month of distinct dailies.

**Open design issue.** The Cleric text is ambiguous. "Heals Slot 1 after
every combat" in the synergy section does not match "heals the hero directly
in front." This PRD uses **directly in front**, the stronger positional rule.

## 9. Timing

Time matters because it drives the 3-star target and the Mage, Ranger and
Berserker abilities.

- Each room has a **base time** in seconds. Combat rooms take longer than
  trap rooms.
- Abilities subtract or add time as stated. Ranger speed reduces the time of
  the rooms it is active in.
- The run's **total time** is the sum of room times after modifiers.
- Each day has a **Gold Par Time** (for example, 90 seconds). A run under par
  with no deaths earns 3 stars.

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
first by stars and then by total time. Ties are broken by fewest knocked-out
heroes across the run.

**No leaderboard in v1.** Score is personal. Stats (played, win rate, star
distribution, streak) are kept locally, in the style of a daily word game.

## 11. Information and Deduction

The Torchlight system balances foresight against discovery.

1. **Before attempt 1**, Rooms 1, 2 and 5 are fully visible. Rooms 3 and 4
   show only categories. Room 3 shows a vague label such as *Arcane Mystery*,
   and Room 4 shows a question such as *Ambush?*.
2. **After attempt 1 ends**, all hidden room details are revealed. This is
   the trigger, whatever the outcome. If attempt 1 was a 3-star run the day
   has already ended, so the reveal only matters for the share and review
   screen.
3. Attempts 2 and 3 are played with complete information.

A player who fails attempt 1 has learned the whole dungeon for free. That is
intentional: the first attempt is the cost of discovery.

## 12. Attempt Resolution and the Share Grid

### 12.1 Attempt Playback

- The run resolves room by room with clear feedback: damage, knockouts,
  exhaustion, rotation, abilities, and the running time.
- Speed options: normal, fast, and skip to result.
- Reduced-motion users get the same information as text, with no animation.

### 12.2 Per-Room Result Codes

Each room in each attempt gets one code:

| Code | Meaning |
|---|---|
| ⚔️ | **Flawless**: cleared with zero damage taken, within the room's par time |
| 😬 | **Damaged**: cleared, but a hero took damage or was knocked out |
| 💀 | **Wipe**: the party was wiped out in this room. The run ends |
| ⬜ | **Not reached**: the run ended before this room |

**Clarifying the flawless definition.** The source sketch says "Fast / 0
Damage." This PRD reads it as *zero damage taken, and the room is cleared
within its par time*. Whether "fast" means per-room par or a shared budget
is an open question (§15).

### 12.3 The Share Grid

The grid is spoiler-free. It shows results, not room names or hazard types.
Rooms run across the top and attempts run down the side.

Example (proposed format):

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
  not include the party, slot order, or any hero names.
- Day numbers count from the launch date and use the UTC date for the seed.

## 13. Experience Requirements

- **Daily seed.** Every player gets an identical dungeon and roster for the
  same UTC date. The generator is deterministic, so no server is needed.
- **Persistence.** Attempt state for the current day, and lifetime stats, are
  stored in local storage. Reloading mid-day restores the attempts so far.
- **Reset.** At UTC midnight the next day's content is generated. A player who
  returns mid-session sees the new day with no action needed.
- **Onboarding.** A first-run card explains the rules in plain words. There
  are no long tutorials. Room 1 is a readable, low-stakes first lesson.
- **Accessibility.** Keyboard control for the lineup (arrow keys to move a
  hero, Enter to confirm). The room codes are also available as text. Color
  is never the only signal. The emoji grid is copy-friendly text.
- **Mobile.** The lineup must work on a phone screen. Drag-to-reorder and
  tap-to-select are both supported.

## 14. Technical Approach (Fantasia-specific)

- **Form.** A DOM/CSS overlay, not a Phaser or three.js scene. The game is
  turn-by-turn and text-heavy, so a canvas adds little. This matches how
  Indie Grind and Greenlit are built.
- **Files.**
  - `src/daily-dungeon.js`: UI, overlay, playback and share. Exposes
    `window.launchDailyDungeon()` and a `window.dailyDungeonGame` handle with a
    no-argument `destroy()`.
  - `src/daily-dungeon/sim.js`: pure logic (seeded generator, line and slot
    resolution, scoring, share text). Written as a UMD module so Node can test
    it under `node --test test/`.
- **Menu.** A button on a menu page, plus a teardown line in `returnToMenu()`.
- **Seed.** A small deterministic PRNG (for example mulberry32) seeded from the
  UTC date string.
- **Storage keys.** `daily-dungeon-day-YYYY-MM-DD` for the day's attempts,
  `daily-dungeon-stats` for lifetime stats.
- **Security and cheating.** Local storage can be edited. That is acceptable
  for a Wordle-style game with no leaderboard. It must be stated in the
  design, and must not become a leaderboard without a server.
- **Tests.** Sim tests cover: seed determinism, the Vanguard Rule, exhaustion
  and rotation, the Mage time reduction, star thresholds, and share-text
  format. Run `node --test test/*.test.js` before pushing.
- **Balance harness.** A bot that picks lineups at random and by search. It
  reports 1-star, 2-star and 3-star rates, the spread of daily difficulty, and
  how often a winning first attempt needs the hidden rooms. Target: 3-star
  rate of roughly 5–15%, and a meaningful gap between good and great play.

## 15. Open Questions

1. **Combat damage model.** The sketch does not define how much damage a room
   deals or how it is split across the line. Proposal: each combat room has a
   damage pool applied to the front of the line. Overflow carries forward.
   Needs prototype tuning.
2. **Flawless definition.** Is "fast" per-room par, or a shared budget across
   the run?
3. **Exhausted heroes.** Do exhausted heroes still count for the Vanguard
   Rule? Do they still take hits in Slot 1?
4. **Cleric wording.** Confirm "directly in front" (this PRD's choice) versus
   "Slot 1" from the synergy text.
5. **Day boundary.** UTC midnight, or the player's local midnight? UTC is
   simpler and fair, but local midnight feels more natural.
6. **Tie-breaking.** Is "fewest knocked-out heroes" the right tiebreak
   between equal-star attempts, or is time the better one?
7. **Early end on 3 stars.** Should a 3-star run end the day immediately, or
   should the player still be able to play out the remaining attempts for
   curiosity?
8. **Roster size.** Is the pool of 8+ enough for v1, or should v1 launch with
   the six sample heroes repeating on a rotation?
9. **Time display.** Show exact seconds, or only the star threshold?

## 16. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0: Sim prototype** | `sim.js` with seed, slots, rooms, the six heroes and scoring. Node tests | Tests green. Bot results recorded for a spread of seeds |
| **M1: Balance pass** | Tune damage, times and par with the bot harness | 3-star rate in target range. No day is unwinnable |
| **M2: Playable UI** | Lineup screen, playback, result, share grid, storage | Full day playable on desktop and phone with no console errors |
| **M3: Menu integration** | Menu button, teardown, onboarding card, stats screen | Launches and tears down cleanly from the menu |
| **M4: Polish** | Accessibility pass, reduced motion, sound (optional) | Keyboard and screen-reader checks pass |
| **M5: Launch** | Publish to `main`, verify deploy | Deploy workflow green, `version.json` shows the new commit |

## 17. Success Metrics

- **Completion.** Percentage of players who finish all 3 attempts or hit
  3 stars on a given day. Target: above 60%, so the day feels finishable.
- **Share rate.** Percentage of finished days where the grid is copied.
  Target: above 20%.
- **Return rate.** Percentage of players who return the next day.
- **Difficulty spread.** Distribution of stars per day. No single star level
  should dominate.

These metrics need client-side analytics or a survey, since v1 has no
backend. Until one exists, these are goals to check by hand.

## 18. Stretch Goals (post-v1)

- Archive mode for past dailies.
- A harder diagonal route or "challenge" modifier for experienced players.
- More heroes (the Bard from §7.4) and room types.
- Optional read-only leaderboard, which would require a backend and is a
  separate decision.
