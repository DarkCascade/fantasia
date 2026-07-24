# Fantasia

A small, self-contained collection of browser games built with
[Phaser 4](https://phaser.io/). The site opens on the **Fantasia** selector menu;
pick a game to play. Every sprite is **generated at runtime from colored
primitives** (Phaser `Graphics` → `generateTexture`) — there are no external
image assets.

### ▶️ [Play it live on GitHub Pages](https://darkcascade.github.io/fantasia/)

The site is deployed automatically by GitHub Actions; the latest push to the
`main` branch is live at **<https://darkcascade.github.io/fantasia/>**.

![Gameplay](docs/gameplay.png)

## Games

Launching the site shows the **Fantasia** menu (a title screen styled after a
1970s Disney title card). From there:

- **Flappy Bird** — the full game: flap through the gaps between pipes without
  hitting anything. Pipes alternate green/purple with an occasional **red** pipe
  worth double points, the world speeds up ~1% with every pipe you pass, and
  little procedural houses drift past in the background.
- **Annoyed Avians** — an Angry-Birds-style slingshot: drag the bird back
  (billiards-style aim line + a dotted predicted arc) and release to fling it at
  a random stack of crates that topple with Matter.js physics. **↺ Reset**
  re-racks the stack; **≡ Menu** returns to the selector.
- **Star Catcher** — slide a glowing scoop along the bottom (mouse, touch, or
  arrow keys) to catch falling stars and build a combo while dodging meteors.
  Three lives; the sky speeds up the longer you last.
- **Arrow Rush** — a 20-second archery challenge: targets pop up and last only
  3–5 seconds. Press and hold to tighten your aim reticle (large red → medium
  yellow → small green), then release to shoot. Score = 100 base × a duration
  bonus × an escalating combo; a miss or an expired target resets the combo.

## Play

No build step and no internet connection required — Phaser is vendored locally.
Just serve the folder over HTTP and open it:

```bash
# any static server works, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

> Opening `index.html` directly via `file://` also works in most browsers.

## Controls

| Action | Input |
| ------ | ----- |
| Open a game | Pick any game from the Fantasia menu |
| Flap / jump (Flappy Bird) | **Tap the screen**, click, press **Space** or **↑**, or use the on-screen **JUMP** button |
| Start | Any flap input from the title screen |
| Restart | Tap / Space on the Game Over screen |

The large **JUMP** button pinned to the bottom center is sized for one-handed
phone play — press it to flap. The other games use their own inputs —
drag-and-release (Annoyed Avians), press-and-hold to aim (Arrow Rush), or slide
left/right with mouse/touch/arrow keys (Star Catcher) — as described under
**Games** above.

## Features

- 🎬 **Fantasia selector menu** — a title screen shown first; each game boots on
  demand, with an on-screen **≡ Menu** button to hop back.
- 🎯 **Annoyed Avians** — a Matter.js slingshot mini-game: drag-aim and fling a
  bird at a random stack of crates that topple on impact.
- 🌠 **Star Catcher** — a catch-and-dodge arcade game: scoop falling stars,
  avoid meteors, build a combo, three lives, ramping difficulty.
- 🏹 **Arrow Rush** — a 20-second archery game: hold to tighten your aim
  reticle, hit targets before they expire, with duration + combo multipliers.
- 🐤 **Procedural art** — all textures drawn from primitives at boot, so the
  repo ships no binary image files.
- 🔴 **Red bonus pipes & rising speed** — a random red pipe worth double points,
  and the world ratchets ~1% faster with every pipe passed.
- 🏠 **Background houses** — recycled procedural houses scroll past behind the
  pipes for parallax depth.
- 📱 **Mobile-friendly** — dedicated on-screen JUMP button plus tap-anywhere
  input; the canvas scales to fit any screen.
- 🏆 **Scores & high scores** — live scoring across games, with best scores
  persisted to `localStorage` (`flappy-bird-highscore`, `arrow-rush-highscore`)
  across sessions.
- 🎞️ **Juice** — flap animation, bird rotation toward velocity, drifting
  parallax clouds, score pop, screen shake / flash on death.

## Deploying to GitHub Pages

A workflow at `.github/workflows/deploy.yml` builds the site (assembles
`index.html`, `src/`, and the vendored Phaser into a Pages artifact) and
publishes it to GitHub Pages on every push to the **`main`** deploy branch, and
on manual dispatch. Iterate on a feature branch, then merge into `main` to ship.
When a build completes, the game is served at:

### 🌐 https://darkcascade.github.io/fantasia/

The exact URL for each deploy is also printed in the workflow run's `deploy`
job output and shown under **Settings → Pages**.

**Confirming a change is live.** Every deploy stamps a
[`version.json`](https://darkcascade.github.io/fantasia/version.json) at the
site root with the deployed commit, branch, timestamp, and a `note` describing
what changed (the latest commit's subject line, or a note you type into a manual
**Run workflow** dispatch). After you push a change, a deploy typically finishes
in ~1 minute; open that file (or the link in the run summary) and check
`shortCommit` matches your latest commit to be sure you're looking at the new
build and not a cached copy.

**One-time setup** (the workflow token cannot do this itself): in the repo, go
to **Settings → Pages → Build and deployment** and set **Source** to
**"GitHub Actions"**. The next push (or a manual run from the **Actions** tab)
will deploy.

> GitHub Pages on a **private** repository requires a paid plan (Pro, Team, or
> Enterprise). On a free plan, make the repository public first.

## Project structure

```
index.html             Fantasia selector menu, page shell, mobile styles
src/game.js            Flappy Bird logic + procedural textures; window.launchFlappyBird()
src/annoyed-avians.js  Annoyed Avians slingshot (Matter physics); window.launchAnnoyedAvians()
src/star-catcher.js    Star Catcher catch/dodge arcade; window.launchStarCatcher()
src/arrow-rush.js      Arrow Rush archery game; window.launchArrowRush()
vendor/phaser.min.js   Phaser 4.1.0 (vendored so the games work offline)
```

## Tuning

Gameplay constants live at the top of `src/game.js` — `FLAP_VELOCITY`,
`GRAVITY`, `PIPE_SPEED`, `SPEED_INCREASE_PER_PIPE`, `PIPE_GAP`, `PIPE_SPACING`,
`RED_PIPE_CHANCE`, etc. Tweak them to make the game easier or harder.
