# Flappy Bird — Phaser 3 Clone

A small, self-contained Flappy Bird clone built with [Phaser 3](https://phaser.io/).
Every sprite in the game — the bird, pipes, ground, clouds, sky gradient and the
JUMP button — is **generated at runtime from colored primitives** (Phaser
`Graphics` → `generateTexture`). There are no external image assets.

### ▶️ [Play it live on GitHub Pages](https://darkcascade.github.io/fantasia/)

The site is deployed automatically by GitHub Actions; the latest push to the
`main` branch is live at **<https://darkcascade.github.io/fantasia/>**.

![Gameplay](docs/gameplay.png)

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
| Flap / jump | **Tap the screen**, click, press **Space** or **↑**, or use the on-screen **JUMP** button |
| Start | Any flap input from the title screen |
| Restart | Tap / Space on the Game Over screen |

The large **JUMP** button pinned to the bottom center is sized for one-handed
phone play — press it to flap.

## Features

- 🐤 **Procedural art** — all textures drawn from primitives at boot, so the
  repo ships no binary image files.
- 📱 **Mobile-friendly** — dedicated on-screen JUMP button plus tap-anywhere
  input; the canvas scales to fit any screen.
- 🏆 **Score & high score** — live score as you clear pipes, with the best
  score persisted to `localStorage` (`flappy-bird-highscore`) across sessions.
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
site root with the deployed commit, branch and timestamp. After you push a
change, a deploy typically finishes in ~1 minute; open that file (or the link
in the run summary) and check `shortCommit` matches your latest commit to be
sure you're looking at the new build and not a cached copy.

**One-time setup** (the workflow token cannot do this itself): in the repo, go
to **Settings → Pages → Build and deployment** and set **Source** to
**"GitHub Actions"**. The next push (or a manual run from the **Actions** tab)
will deploy.

> GitHub Pages on a **private** repository requires a paid plan (Pro, Team, or
> Enterprise). On a free plan, make the repository public first.

## Project structure

```
index.html          Page shell + mobile-friendly viewport/styles
src/game.js         All game logic and the procedural texture generation
vendor/phaser.min.js  Phaser 3.80.1 (vendored so the game works offline)
```

## Tuning

Gameplay constants live at the top of `src/game.js` — `FLAP_VELOCITY`,
`GRAVITY`, `PIPE_SPEED`, `PIPE_GAP`, `PIPE_SPACING`, etc. Tweak them to make the
game easier or harder.
