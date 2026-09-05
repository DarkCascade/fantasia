/*
 * The Abominable Slopeman — a downhill dodging game built on three.js, in the
 * style of src/gloom-hollow-3d.js: a real 3D scene with a DOM HUD laid over
 * it, three.js imported on demand so its 670 KB module never loads for
 * people who don't pick this game.
 *
 * The player is fixed at the origin; the mountain "moves" by scrolling the
 * snow texture and by trees/rocks marching toward the camera along +z from
 * far up the slope. Two big arrow buttons — bottom-left and bottom-right, per
 * the brief — nudge the snowman sideways; arrow keys do the same on desktop.
 * Score is just wall-clock survival time, and both forward speed and spawn
 * rate ramp up the longer a run lasts, so the mountain gets meaner the
 * further down it you get.
 *
 * The snowman himself is the one exception to Fantasia's "everything is
 * generated at runtime from primitives" rule (alongside Bark Quest's PNGs):
 * he's a Meshy-generated .glb, vendored at src/slopeman/snowman-lowpoly.glb.
 * The mesh ships with no material/UVs (geometry only), so he's rendered in a
 * plain matte snow-white — which, for a snowman, is not exactly a compromise.
 * Every obstacle, by contrast, is still built from primitives at runtime.
 *
 * Created on demand via window.launchSlopeman() so the menu stays first.
 */
(function () {
  "use strict";

  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function resolve(rel) {
    return new URL(rel, SELF_SRC || window.location.href).href;
  }
  var THREE_URL = resolve("../vendor/three.module.min.js");
  var GLTF_LOADER_URL = resolve("../vendor/jsm/loaders/GLTFLoader.js");
  var MODEL_URL = resolve("./slopeman/snowman-lowpoly.glb");
  var THREE = null;
  var GLTFLoader = null;

  const BEST_KEY = "slopeman-best-seconds";

  /* ---------- tuning ---------- */

  const LANE_HALF_WIDTH = 4.2; // how far off-center the snowman may travel
  const PLAYER_LATERAL_SPEED = 9; // units/sec while a direction is held
  const PLAYER_RADIUS = 0.55;

  const BASE_FORWARD_SPEED = 9; // units/sec obstacles close in at, run start
  const MAX_FORWARD_SPEED = 27;
  const SPEED_RAMP_PER_SEC = 0.45; // added to forward speed per second survived

  const BASE_SPAWN_MS = 950;
  const MIN_SPAWN_MS = 260;
  const SPAWN_RAMP_MS_PER_SEC = 13; // shaved off the spawn interval per second survived

  // A second obstacle sometimes rides along with the first, offset in x, so
  // late runs demand an actual dodge rather than just a lane pick. Ramps in
  // over the first CLUSTER_RAMP_SEC so early runs stay a single-obstacle warmup.
  const CLUSTER_CHANCE_MAX = 0.4;
  const CLUSTER_RAMP_SEC = 45;
  const CLUSTER_MIN_GAP = 1.6; // x separation between clustered obstacles, so a gap always exists

  const SPAWN_Z = -70;
  const DESPAWN_Z = 6;

  const TREE_RADIUS = 0.55;
  const ROCK_RADIUS_MIN = 0.5;
  const ROCK_RADIUS_MAX = 0.85;

  /* ---------- HUD ---------- */

  const CSS = `
#sm-root { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #bfe3ff; }
#sm-root canvas { display: block; }
.sm-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font: 600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #2a3550;
}
.sm-hud { position: absolute; inset: 0; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.sm-score {
  position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
  font-size: clamp(28px, 7vw, 42px); font-weight: 800; color: #fff;
  text-shadow: 0 2px 0 rgba(20,40,70,0.5), 0 4px 14px rgba(0,0,0,0.35);
  letter-spacing: 0.02em;
}
.sm-best {
  position: absolute; top: clamp(64px, 12vw, 78px); left: 50%; transform: translateX(-50%);
  font-size: 14px; font-weight: 600; color: #eaf3ff; opacity: 0.85;
  text-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
.sm-arrow {
  position: absolute; bottom: clamp(16px, 5vh, 40px);
  width: clamp(64px, 16vw, 84px); height: clamp(64px, 16vw, 84px);
  border-radius: 50%; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  font-size: clamp(28px, 7vw, 38px); color: #fff;
  background: rgba(20, 40, 70, 0.35); border: 2px solid rgba(255,255,255,0.55);
  user-select: none; -webkit-user-select: none;
}
.sm-arrow:active { background: rgba(20, 40, 70, 0.55); }
.sm-arrow--left { left: clamp(16px, 5vw, 34px); }
.sm-arrow--right { right: clamp(16px, 5vw, 34px); }
.sm-hint {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: clamp(18px, 5vw, 26px); font-weight: 700; color: #fff;
  text-shadow: 0 2px 10px rgba(0,0,0,0.4); text-align: center; transition: opacity 0.6s ease;
}
.sm-over {
  position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
  background: rgba(10, 18, 34, 0.55); pointer-events: auto;
}
.sm-over.is-open { display: flex; }
.sm-over-card {
  background: linear-gradient(180deg, #2c3b6b 0%, #142042 100%);
  border: 3px solid #ffe7a3; border-radius: 18px; padding: 30px 34px; text-align: center;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5); max-width: 86vw;
}
.sm-over h2 { margin: 0 0 8px; color: #ffe7a3; font-size: clamp(24px, 6vw, 32px); }
.sm-over p { margin: 0 0 18px; color: #dce6ff; font-size: 15px; }
.sm-over-btns { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.sm-btn {
  font-weight: 700; padding: 10px 20px; border-radius: 12px; border: 2px solid #ffe9ad;
  cursor: pointer; font-size: 15px;
}
.sm-btn--again { color: #3a2500; background: linear-gradient(180deg, #ffe7a3 0%, #f0b94a 100%); }
.sm-btn--menu { color: #ffe7a3; background: rgba(255,255,255,0.08); }
.sm-fatal {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 24px; text-align: center; background: #1d232a;
  font: 600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #eaf0ff;
}
.sm-fatal-card { max-width: 320px; }
.sm-fatal-card p { margin: 0 0 18px; opacity: 0.85; font-weight: 400; font-size: 14px; }
`;

  const HUD_HTML = `
<div class="sm-hud">
  <div class="sm-score" data-sm="score">0.0</div>
  <div class="sm-best" data-sm="best">best 0.0</div>
  <div class="sm-hint" data-sm="hint">Dodge the trees and rocks!<br>Survive as long as you can.</div>
  <div class="sm-arrow sm-arrow--left" data-sm="left">&#9664;</div>
  <div class="sm-arrow sm-arrow--right" data-sm="right">&#9654;</div>
  <div class="sm-over" data-sm="over">
    <div class="sm-over-card">
      <h2>WIPEOUT!</h2>
      <p data-sm="summary"></p>
      <div class="sm-over-btns">
        <button class="sm-btn sm-btn--again" type="button" data-sm="again">Ski Again</button>
        <button class="sm-btn sm-btn--menu" type="button" data-sm="toMenu">Menu</button>
      </div>
    </div>
  </div>
</div>`;

  /* ---------- helpers ---------- */

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function loadBest() {
    try {
      const v = parseFloat(localStorage.getItem(BEST_KEY));
      return Number.isFinite(v) ? v : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBest(seconds) {
    try {
      localStorage.setItem(BEST_KEY, String(seconds));
    } catch (e) {
      /* storage may be unavailable; ignore */
    }
  }

  // Shared dead-end screen for both "never started" (WebGL context couldn't
  // be created) and "died mid-run" (context lost after the fact) — either
  // way the canvas is unusable and the only way out is back to the menu.
  function showFatalError(root, message) {
    root.innerHTML =
      '<div class="sm-fatal"><div class="sm-fatal-card"><h2>Can&rsquo;t ski right now</h2>' +
      "<p>" +
      message +
      '</p><button class="sm-btn sm-btn--menu" type="button" data-sm-fatal-menu>Menu</button></div></div>';
    const btn = root.querySelector("[data-sm-fatal-menu]");
    if (btn) {
      btn.addEventListener("click", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
    }
  }

  /* ---------- the game ---------- */

  class SlopeRun {
    constructor(root) {
      this.root = root;
      this.el = {};
      root.querySelectorAll("[data-sm]").forEach((n) => {
        this.el[n.getAttribute("data-sm")] = n;
      });

      this.listeners = [];
      this.best = loadBest();
      this.el.best.textContent = "best " + this.best.toFixed(1);

      this.setupRenderer();
      this.buildScene();
      this.bindInput();
      this.loadSnowman();
      this.startRun();

      this.hintTimer = setTimeout(() => {
        this.el.hint.style.opacity = "0";
      }, 3200);

      this.lastFrame = performance.now();
      this.tick = this.tick.bind(this);
      this.raf = requestAnimationFrame(this.tick);
    }

    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    }

    /* ---------- renderer / scene ---------- */

    setupRenderer() {
      // Touch devices skew toward weaker/older GPUs, and "high-performance" +
      // antialias + a shadow map is exactly the combination that fails WebGL
      // context creation on some budget/older phones (Chrome/mobile Safari
      // paint a small broken-context glyph into the canvas and leave it blank
      // rather than throwing a catchable error). Ask for less there.
      const lowPower = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

      this.renderer = new THREE.WebGLRenderer({
        antialias: !lowPower,
        powerPreference: lowPower ? "default" : "high-performance",
        failIfMajorPerformanceCaveat: false,
      });
      if (!this.renderer.getContext()) {
        throw new Error("WebGL context could not be created");
      }
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
      this.renderer.shadowMap.enabled = !lowPower;
      this.canvas = this.renderer.domElement;
      this.root.insertBefore(this.canvas, this.root.firstChild);

      // A context can also die asynchronously, well after creation succeeded
      // (thermal throttling, another app claiming GPU memory, backgrounding
      // the tab) — with no exception to catch, so this is the only hook.
      this.listen(this.canvas, "webglcontextlost", (e) => {
        e.preventDefault();
        this.onContextLost();
      });

      this.scene = new THREE.Scene();
      const skyColor = 0xbfe3ff;
      this.scene.background = new THREE.Color(skyColor);
      this.scene.fog = new THREE.Fog(skyColor, 22, 62);

      this.world = new THREE.Group();
      this.scene.add(this.world);

      this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
      this.camera.position.set(0, 4.4, 7.2);
      this.camera.lookAt(0, 1.4, -10);

      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9bbf, 1.1));
      const sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
      sun.position.set(6, 12, 4);
      if (!lowPower) {
        sun.castShadow = true;
        const shadowRes = lowPower ? 512 : 1024;
        sun.shadow.mapSize.set(shadowRes, shadowRes);
        sun.shadow.camera.left = -10;
        sun.shadow.camera.right = 10;
        sun.shadow.camera.top = 10;
        sun.shadow.camera.bottom = -10;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 30;
      }
      this.scene.add(sun);

      this.resize();
      const onResize = () => this.resize();
      this.listen(window, "resize", onResize);
      this.listen(window, "orientationchange", onResize);
    }

    resize() {
      const w = this.root.clientWidth;
      const h = this.root.clientHeight;
      this.camera.aspect = w / Math.max(h, 1);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    buildScene() {
      // Snow slope: a big plane the obstacles march across. A faint tiled
      // stripe texture, scrolled by distance travelled, is what sells motion
      // when nothing else on the ground is moving.
      const tex = this.buildSnowTexture();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(6, 40);
      this.snowTexture = tex;

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 220),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.z = -70;
      ground.receiveShadow = true;
      this.world.add(ground);

      // Distant mountain silhouettes: static, desaturated, just backdrop dressing.
      const mountainMat = new THREE.MeshStandardMaterial({ color: 0x9fb3d6, roughness: 1 });
      [
        [-14, -90, 10, 16],
        [6, -105, 13, 20],
        [20, -95, 9, 14],
      ].forEach(([x, z, r, h]) => {
        const peak = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mountainMat);
        peak.position.set(x, h / 2 - 1, z);
        this.world.add(peak);
      });

      this.player = new THREE.Group();
      this.player.position.set(0, 0, 0);
      this.world.add(this.player);

      this.obstacles = [];
      this.elapsed = 0;
      this.spawnTimer = 0;
      this.crashed = false;
      this.moveDir = 0; // -1 left, 0 still, 1 right
    }

    buildSnowTexture() {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#f4f9ff";
      ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = "rgba(180, 205, 235, 0.55)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 64; i += 16) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(64, i);
        ctx.stroke();
      }
      return new THREE.CanvasTexture(c);
    }

    loadSnowman() {
      const loader = new GLTFLoader();
      loader.load(
        MODEL_URL,
        (gltf) => {
          if (this.destroyed) return;
          const model = gltf.scene;
          const snowMat = new THREE.MeshStandardMaterial({ color: 0xf6f9fc, roughness: 0.85, metalness: 0 });
          model.traverse((n) => {
            if (n.isMesh) {
              n.material = snowMat;
              n.castShadow = true;
              n.receiveShadow = true;
              if (!n.geometry.attributes.normal) n.geometry.computeVertexNormals();
            }
          });

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          model.position.x -= center.x;
          model.position.z -= center.z;
          model.position.y -= box.min.y;

          const targetHeight = 1.7;
          const scale = targetHeight / (size.y || 1);
          model.scale.setScalar(scale);
          model.rotation.y = Math.PI; // face away from the camera, down the slope

          this.player.add(model);
        },
        undefined,
        (err) => {
          console.error("Slopeman: failed to load snowman model", err);
          // Fall back to a plain sphere so the game is still playable.
          const fallback = new THREE.Mesh(
            new THREE.SphereGeometry(0.6, 12, 10),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
          );
          fallback.position.y = 0.6;
          fallback.castShadow = true;
          this.player.add(fallback);
        }
      );
    }

    /* ---------- obstacles ---------- */

    buildTree() {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.14, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 1 })
      );
      trunk.position.y = 0.25;
      g.add(trunk);
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3d, roughness: 0.9 });
      [
        [0.75, 0.6, 0.9],
        [0.58, 0.55, 1.35],
        [0.4, 0.5, 1.75],
      ].forEach(([r, h, y]) => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), foliageMat);
        cone.position.y = y;
        g.add(cone);
      });
      g.traverse((n) => {
        if (n.isMesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
      g.userData.radius = TREE_RADIUS;
      return g;
    }

    buildRock() {
      const r = rand(ROCK_RADIUS_MIN, ROCK_RADIUS_MAX);
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        new THREE.MeshStandardMaterial({ color: 0x7d8592, roughness: 1, flatShading: true })
      );
      rock.position.y = r * 0.55;
      rock.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      rock.castShadow = true;
      rock.receiveShadow = true;
      rock.userData.radius = r * 0.8;
      return rock;
    }

    spawnOne(x) {
      const obj = Math.random() < 0.55 ? this.buildTree() : this.buildRock();
      obj.position.x = x;
      obj.position.z = SPAWN_Z;
      this.world.add(obj);
      this.obstacles.push(obj);
    }

    spawnWave() {
      const x1 = rand(-LANE_HALF_WIDTH, LANE_HALF_WIDTH);
      this.spawnOne(x1);

      const clusterChance = CLUSTER_CHANCE_MAX * Math.min(this.elapsed / CLUSTER_RAMP_SEC, 1);
      if (Math.random() < clusterChance) {
        // Bias the second obstacle to the far side so a gap always survives.
        const side = x1 < 0 ? 1 : -1;
        const x2 = side * rand(CLUSTER_MIN_GAP, LANE_HALF_WIDTH + 1);
        this.spawnOne(THREE.MathUtils.clamp(x2, -LANE_HALF_WIDTH - 1.2, LANE_HALF_WIDTH + 1.2));
      }
    }

    /* ---------- input ---------- */

    bindInput() {
      const setDir = (d) => {
        this.moveDir = d;
      };
      const left = this.el.left;
      const right = this.el.right;

      this.listen(left, "pointerdown", (e) => {
        e.preventDefault();
        setDir(-1);
      });
      this.listen(right, "pointerdown", (e) => {
        e.preventDefault();
        setDir(1);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
        this.listen(left, type, () => {
          if (this.moveDir === -1) setDir(0);
        });
        this.listen(right, type, () => {
          if (this.moveDir === 1) setDir(0);
        });
      });

      this.keyState = { left: false, right: false };
      this.listen(window, "keydown", (e) => {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.keyState.left = true;
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.keyState.right = true;
      });
      this.listen(window, "keyup", (e) => {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.keyState.left = false;
        if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.keyState.right = false;
      });

      this.listen(this.el.again, "click", () => this.startRun());
      this.listen(this.el.toMenu, "click", () => this.toMenu());
    }

    currentDir() {
      if (this.keyState.left && !this.keyState.right) return -1;
      if (this.keyState.right && !this.keyState.left) return 1;
      if (this.moveDir !== 0) return this.moveDir;
      return 0;
    }

    /* ---------- run lifecycle ---------- */

    startRun() {
      this.obstacles.forEach((o) => this.world.remove(o));
      this.obstacles = [];
      this.player.position.x = 0;
      this.elapsed = 0;
      this.spawnTimer = BASE_SPAWN_MS;
      this.crashed = false;
      this.el.over.classList.remove("is-open");
      this.el.score.textContent = "0.0";
    }

    crash() {
      if (this.crashed) return;
      this.crashed = true;
      if (this.elapsed > this.best) {
        this.best = this.elapsed;
        saveBest(this.best);
      }
      this.el.summary.textContent =
        "You lasted " + this.elapsed.toFixed(1) + "s — best " + this.best.toFixed(1) + "s";
      this.el.best.textContent = "best " + this.best.toFixed(1);
      this.el.over.classList.add("is-open");
    }

    toMenu() {
      if (typeof window.returnToMenu === "function") window.returnToMenu();
    }

    /* ---------- loop ---------- */

    tick(now) {
      if (this.destroyed) return;
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(this.tick);
    }

    update(dt) {
      if (!this.crashed) {
        this.elapsed += dt;
        this.el.score.textContent = this.elapsed.toFixed(1);

        const dir = this.currentDir();
        if (dir !== 0) {
          this.player.position.x = THREE.MathUtils.clamp(
            this.player.position.x + dir * PLAYER_LATERAL_SPEED * dt,
            -LANE_HALF_WIDTH,
            LANE_HALF_WIDTH
          );
        }

        const forwardSpeed = Math.min(
          BASE_FORWARD_SPEED + SPEED_RAMP_PER_SEC * this.elapsed,
          MAX_FORWARD_SPEED
        );
        this.snowTexture.offset.y -= (forwardSpeed * dt) / 8;

        this.spawnTimer -= dt * 1000;
        if (this.spawnTimer <= 0) {
          this.spawnWave();
          const interval = Math.max(
            MIN_SPAWN_MS,
            BASE_SPAWN_MS - SPAWN_RAMP_MS_PER_SEC * this.elapsed
          );
          this.spawnTimer = interval;
        }

        for (let i = this.obstacles.length - 1; i >= 0; i--) {
          const o = this.obstacles[i];
          o.position.z += forwardSpeed * dt;
          if (o.position.z > DESPAWN_Z) {
            this.world.remove(o);
            this.obstacles.splice(i, 1);
            continue;
          }
          if (Math.abs(o.position.z) < 1.1) {
            const dx = o.position.x - this.player.position.x;
            const rr = (o.userData.radius || 0.6) + PLAYER_RADIUS;
            if (Math.abs(dx) < rr) this.crash();
          }
        }
      }
    }

    onContextLost() {
      if (this.destroyed) return;
      this.destroyed = true; // stop tick() from touching a dead GL context
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.hintTimer) clearTimeout(this.hintTimer);
      this.listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
      showFatalError(
        this.root,
        "This device dropped 3D graphics mid-run — try closing other tabs/apps, or just head back."
      );
    }

    destroy() {
      this.destroyed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.hintTimer) clearTimeout(this.hintTimer);
      this.listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
      this.renderer.dispose();
    }
  }

  /* ---------- boot ---------- */

  function injectStyle() {
    if (document.getElementById("sm-style")) return;
    const s = document.createElement("style");
    s.id = "sm-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ensureThree() {
    if (THREE && GLTFLoader) return Promise.resolve();
    return import(THREE_URL)
      .then((mod) => {
        THREE = mod;
        return import(GLTF_LOADER_URL);
      })
      .then((mod) => {
        GLTFLoader = mod.GLTFLoader;
      });
  }

  function launchSlopeman() {
    if (window.slopemanGame) return window.slopemanGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "sm-root";
    root.innerHTML = '<div class="sm-loading">Waxing skis&hellip;</div>' + HUD_HTML;
    document.getElementById("game-container").appendChild(root);

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
    window.slopemanGame = handle;

    ensureThree()
      .then(() => {
        if (handle.cancelled) return;
        const loading = root.querySelector(".sm-loading");
        if (loading) loading.remove();
        handle.game = new SlopeRun(root);
      })
      .catch((err) => {
        if (handle.cancelled) return;
        showFatalError(root, "This device couldn't start 3D graphics for this game.");
        console.error("The Abominable Slopeman failed to start:", err);
      });

    return handle;
  }

  window.launchSlopeman = launchSlopeman;
})();
