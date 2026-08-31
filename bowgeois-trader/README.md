# Bowgeois Trader

A prototype of a shipping-house game set at the tail of the Age of Exploration.
Your uncle Gerard has disgraced himself with a minor American family, control of
the house falls to you, and what you inherit is one ship, about five hundred
pounds, and not a single trading partner anywhere in the world.

Open `index.html` — no build step, no dependencies, no external assets. Every
sprite on the page is HTML, CSS or inline SVG.

```bash
python -m http.server 8123
```

## The loop

1. **The letter.** Gerard's scandal, the empty counting-house, and one door left
   open: a group expedition sailing for the plantations within the week.
2. **The expedition.** A scripted crossing that cannot fail — it exists to hand
   you a partner. You make landfall at **a random port of the American seaboard**
   (one of ten that actually traded in 1687), are introduced to a merchant, and
   sign articles in a tavern.
3. **Lade at London.** Buy English wares — broadcloth, ironware, gunpowder,
   Cheshire salt — victual the ship, repair her, give the hands liberty ashore.
4. **The westward passage.** Long, because it is sailed against the westerlies.
   **Two decisions** are put to you on the way (see below).
5. **The far port.** The factor settles for the English cargo on the spot. Lade
   her with what the colony ships — tobacco, rice, indigo, pitch, dried cod —
   and sail for home.
6. **The eastward passage.** Shorter, on the Gulf Stream. Two more decisions.
7. **The Custom House.** The homeward cargo is sold and **the funds come in**.
   Then lade her again.

## The decisions

This is the part the prototype exists to try out. Each passage draws
`EVENTS_PER_CROSSING` (2) events at random from the pool in `data.js` and fires
them at fixed points in the crossing.

Every event offers two or three actions. **The consequences are not shown at the
time of choosing** — each action carries a private weighted table of outcomes,
one of which is rolled and applied the *instant* the player commits. The player
then reads what happened and sees the effects as chips: `−34 victuals`,
`+5 days at sea`, `−12 hull`, `−1 hand lost`, `24 tun of cargo gone`.

So "rebrine the salt beef and ration it out" is cheap in stores most of the
time, and gives the whole forecastle the bloody flux the rest of the time. There
is no safe option, only differently-shaped risk.

Effects available to an outcome (`fx`, all optional):

| key | meaning |
| --- | --- |
| `prov` | victuals, in units |
| `hull` | hull integrity, 0–100 — at zero she founders and the run ends |
| `crew` | hands aboard — below `CREW_FLOOR` she cannot be worked |
| `morale` | 0–100 |
| `days` | days added to the passage |
| `money` | pounds sterling, immediately |
| `cargo` | fraction of the hold spoiled, thrown over, or taken |

The stats are not decoration: `passageDays()` adds days for a short crew, a
sullen one, and a bad hull, so a rough crossing makes the *next* one worse. Run
out of victuals and morale bleeds every day you are on short commons.

## Files

| file | what it holds |
| --- | --- |
| `index.html` | page shell, all styling, and the chart of the North Atlantic as inline SVG |
| `data.js` | every ware, port, merchant-house name and event. No rules. |
| `game.js` | every rule. No prose and no prices. |

Tuning constants sit at the top of `game.js`: `START_MONEY`, `HOLD_TUNS`,
`PROV_MAX`, `PROV_PER_DAY`, `EVENTS_PER_CROSSING`, `CROSSING_SECONDS`,
`REPAIR_COST`, `LIBERTY_COST`.

Adding an event means one entry in `EVENTS`; adding a port means one entry in
`PORTS` with chart coordinates, a passage length each way, what it pays for
English wares, and what it ships.

## Notes on the state of it

- The voyage clock is a `setInterval`, not `requestAnimationFrame`, so a
  crossing keeps running when the tab is not the one being looked at.
- No `localStorage` — a run resets on reload, as in Indie Grind.
- One ship, one partner, one route. Multiple hulls, multiple correspondents and
  a reason to choose between them are the obvious next thing.
- Selling is settled automatically at each end; the player only ever buys. That
  keeps the two ports asymmetric and keeps "the funds come in when she returns"
  as an event rather than a chore.
