/*
 * THE BUTTON — a game that is 1% gameplay and 99% juice.
 *
 * The whole design brief: press a button, the number goes up by exactly one,
 * and that one-point increase is the most exciting thing that has ever
 * happened. There is nothing else to do and nothing to buy — every system
 * here exists only to make "+1" feel enormous.
 *
 * Like Indie Grind / Greenlit it's a DOM overlay (a #bt-root div injected
 * into #game-container, styled by <style id="bt-style">) with two <canvas>
 * layers for the heavy lifting: a background canvas (hue-cycling sunburst,
 * warp-speed starfield, bokeh, and the rising "juice" that leaks out of the
 * screen sides) and a particle canvas on top (sparks, confetti, coins,
 * shockwaves, fireworks, floating "+1"s). No external assets: every sound is
 * synthesised with WebAudio and every pixel is drawn at runtime.
 * window.launchTheButton() builds it; window.theButtonGame is the handle and
 * its destroy() takes no arguments (same convention as indieGrindGame).
 *
 * Juice inventory, roughly in order of how rude it is:
 *   - spring-physics button (squish, overshoot, jitter, breathing, begging
 *     when idle) and a spring-driven score that slams in per-digit
 *   - screen shake (trauma model), zoom punch, chromatic split on the score
 *   - hit-stop and slow-mo on big moments, white flashes
 *   - sparks / confetti / stars / shockwave rings on every single push
 *   - a COMBO meter (pushes inside COMBO_WINDOW) feeding a smooth `heat`
 *     value that scales *everything*: more particles, harder shake, faster
 *     rays, brighter sound, embers pouring off the button, rainbow sunburst
 *   - tier-ups (NICE ... TRANSCENDENT), crits ("CRITICAL ONE!"), and
 *     milestone fireworks / coin showers / confetti cannons at 10, 25, 50,
 *     69, 100, 250, 500, 1000 and every 1000 after
 *   - pentatonic note that climbs with the combo, kick drum, reverb sparkle,
 *     fanfare arpeggios, haptics
 *   - the namesake juice: a liquid level that rises up both screen edges as
 *     you push, bubbling, and eventually dripping out of the sides
 *
 * Because 99% juice is also ~99% flashing lights, there is a CALM toggle
 * (default ON when the OS asks for reduced motion) that turns down flashes,
 * shake, slow-mo and particle counts, plus a mute toggle. The number still
 * goes up by exactly one every time, no matter what.
 *
 * Persistence (localStorage): lifetime pushes, best combo, calm, mute.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /*  Tuning                                                             */
  /* ------------------------------------------------------------------ */

  const COMBO_WINDOW = 0.85; // seconds a combo survives without a push
  const HEAT_FULL = 150; // combo at which heat saturates
  const MIN_GAP_MS = 35; // swallows runaway key-repeat
  const CRIT_CHANCE = 0.05; // chance of a "CRITICAL ONE!" (still +1)
  const PARTICLE_MAX = 1800;
  const TIERS = [
    { at: 0, name: "" },
    { at: 4, name: "NICE" },
    { at: 10, name: "SWEET" },
    { at: 20, name: "HOT" },
    { at: 35, name: "BLAZING" },
    { at: 55, name: "UNREAL" },
    { at: 80, name: "GODLIKE" },
    { at: 120, name: "BEYOND" },
    { at: 180, name: "TRANSCENDENT" },
  ];
  const SUBS = [
    "Your finger is a legend.",
    "Hydrate. Seriously.",
    "The number goes up. It ALWAYS goes up.",
    "Peak human achievement.",
    "Please blink.",
    "Somewhere, a number is proud of you.",
    "Is this healthy? Unclear.",
    "Fantasia salutes your thumb.",
    "One more. Just one more.",
    "You're doing great (at pushing).",
  ];
  const LS_COUNT = "the-button-count";
  const LS_COMBO = "the-button-best-combo";
  const LS_CALM = "the-button-calm";
  const LS_MUTE = "the-button-mute";

  /* ------------------------------------------------------------------ */
  /*  Tiny helpers                                                       */
  /* ------------------------------------------------------------------ */

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;

  function lsGet(k) {
    try {
      return window.localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      window.localStorage.setItem(k, String(v));
    } catch (e) {}
  }

  function tierOf(combo) {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (combo >= TIERS[i].at) t = i;
    return t;
  }

  // 0 none, 1 every 10th, 2 a "big" number, 3 every thousand.
  function milestoneLevel(n) {
    if (n <= 0) return 0;
    if (n % 1000 === 0) return 3;
    if (n % 100 === 0 || n === 25 || n === 50 || n === 69 || n === 250 || n === 500) return 2;
    if (n % 10 === 0) return 1;
    return 0;
  }

  // Critically-damped-ish spring used for every wobble in the game.
  class Spring {
    constructor(x, k, d) {
      this.x = x;
      this.v = 0;
      this.t = x;
      this.k = k;
      this.d = d;
    }
    step(dt) {
      const n = Math.ceil(dt / 0.008) || 1;
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (-(this.x - this.t) * this.k - this.v * this.d) * h;
        this.x += this.v * h;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Sound — everything synthesised, nothing loaded                     */
  /* ------------------------------------------------------------------ */

  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

  class Sfx {
    constructor(muted) {
      this.muted = muted;
      this.ctx = null;
      this.lastBoom = 0;
    }
    // Must be called from a user gesture the first time.
    wake() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        const c = (this.ctx = new AC());
        this.master = c.createGain();
        this.master.gain.value = 0.8;
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(c.destination);
        // Reverb: noise burst with an exponential tail.
        const len = Math.floor(c.sampleRate * 1.4);
        const ir = c.createBuffer(2, len, c.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
          const d = ir.getChannelData(ch);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        this.verb = c.createConvolver();
        this.verb.buffer = ir;
        const vg = c.createGain();
        vg.gain.value = 0.4;
        this.verb.connect(vg);
        vg.connect(this.master);
        // One shared second of white noise for every hiss/whoosh.
        this.nbuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const nd = this.nbuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      } catch (e) {
        this.ctx = null;
      }
    }
    ok() {
      return !this.muted && this.ctx && this.ctx.state === "running";
    }
    tone(f, dur, type, vol, o) {
      o = o || {};
      const c = this.ctx;
      const t = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      if (o.wet) {
        const s = c.createGain();
        s.gain.value = o.wet;
        g.connect(s);
        s.connect(this.verb);
      }
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    noise(dur, vol, freq, q, type, o) {
      o = o || {};
      const c = this.ctx;
      const t = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource();
      src.buffer = this.nbuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type || "bandpass";
      f.frequency.setValueAtTime(freq, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      f.Q.value = q || 1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      if (o.wet) {
        const s = c.createGain();
        s.gain.value = o.wet;
        g.connect(s);
        s.connect(this.verb);
      }
      src.start(t);
      src.stop(t + dur + 0.05);
    }
    push(combo, heat) {
      if (!this.ok()) return;
      const i = combo <= 15 ? Math.max(0, combo - 1) : 10 + (combo % 6);
      const f = 261.63 * Math.pow(2, SCALE[i] / 12);
      this.tone(160, 0.17, "sine", 0.75, { to: 42 }); // kick
      this.noise(0.03, 0.22, 4200, 0.8); // click
      this.tone(f, 0.3, "triangle", 0.3, { wet: 0.5 });
      this.tone(f * 2, 0.2, "sine", 0.12, { wet: 0.6 });
      if (heat > 0.25) this.tone(f / 2, 0.3, "sawtooth", 0.07 + heat * 0.08);
      if (heat > 0.5) this.tone(f * 1.5, 0.22, "square", 0.04 + heat * 0.03, { wet: 0.4 });
      if (heat > 0.6) this.tone(f * 4, 0.16, "sine", 0.09, { wet: 0.9, delay: 0.03 });
    }
    sparkle(n) {
      if (!this.ok()) return;
      for (let i = 0; i < n; i++) {
        const f = 1046.5 * Math.pow(2, SCALE[(Math.random() * 10) | 0] / 12);
        this.tone(f, 0.14, "sine", 0.07, { wet: 0.9, delay: i * 0.045 });
      }
    }
    tierUp(t) {
      if (!this.ok()) return;
      this.tone(220, 0.5, "sawtooth", 0.14, { to: 440 + t * 220 });
      this.noise(0.5, 0.2, 400, 1.2, "bandpass", { to: 6000, attack: 0.3, wet: 0.4 });
      const root = 261.63 * Math.pow(2, t / 12);
      [0, 4, 7, 12].forEach((s, i) =>
        this.tone(root * Math.pow(2, s / 12), 0.5, "triangle", 0.2, { delay: 0.3 + i * 0.04, wet: 0.7 })
      );
      this.tone(100, 0.5, "sine", 0.9, { to: 30, delay: 0.3 });
    }
    crit() {
      if (!this.ok()) return;
      [0, 7, 12, 19].forEach((s, i) =>
        this.tone(523.25 * Math.pow(2, s / 12), 0.35, "square", 0.1, { delay: i * 0.03, wet: 0.6 })
      );
      this.noise(0.25, 0.3, 8000, 0.7, "highpass");
      this.sparkle(5);
    }
    milestone(level) {
      if (!this.ok()) return;
      const notes = [
        [0, 4, 7, 12],
        [0, 4, 7, 12, 16, 19, 24],
        [0, 4, 7, 12, 16, 19, 24, 28, 31, 36],
      ][level - 1];
      const base = 261.63;
      notes.forEach((s, i) => {
        const f = base * Math.pow(2, s / 12);
        this.tone(f, 0.5, "triangle", 0.22, { delay: i * 0.06, wet: 0.7 });
        this.tone(f * 2, 0.35, "sine", 0.08, { delay: i * 0.06, wet: 0.8 });
      });
      this.tone(130, 0.7, "sine", 1.0, { to: 28 });
      this.noise(0.4 + level * 0.3, 0.3, 9000, 0.5, "highpass", { wet: 0.5 });
      if (level >= 2) this.sparkle(6 + level * 3);
    }
    boom() {
      if (!this.ok()) return;
      const now = this.ctx.currentTime;
      if (now - this.lastBoom < 0.09) return;
      this.lastBoom = now;
      this.noise(0.25, 0.28, 1800, 0.6, "lowpass", { to: 300, wet: 0.5 });
      this.tone(90, 0.3, "sine", 0.5, { to: 35 });
    }
    fizz() {
      if (!this.ok()) return;
      this.tone(320, 0.35, "sine", 0.16, { to: 70 });
      this.noise(0.25, 0.1, 1200, 0.8, "lowpass", { to: 200 });
    }
    close() {
      if (this.ctx) {
        try {
          this.ctx.close();
        } catch (e) {}
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Markup + styles                                                    */
  /* ------------------------------------------------------------------ */

  const HTML =
    '<canvas id="bt-bg"></canvas>' +
    '<div id="bt-stage">' +
    '  <div id="bt-top">' +
    '    <button class="bt-chip" data-act="menu" type="button">≡ Menu</button>' +
    '    <span class="bt-spacer"></span>' +
    '    <button class="bt-chip" data-act="sound" type="button">🔊</button>' +
    '    <button class="bt-chip" data-act="calm" type="button">JUICE: MAX</button>' +
    "  </div>" +
    '  <div id="bt-center">' +
    '    <div id="bt-tier"></div>' +
    '    <div id="bt-score"></div>' +
    '    <div id="bt-sub">pushes</div>' +
    '    <div id="bt-meter"><i></i></div>' +
    '    <div id="bt-combo"></div>' +
    "  </div>" +
    '  <div id="bt-btnwrap">' +
    '    <div id="bt-glow"></div>' +
    '    <button id="bt-btn" type="button" aria-label="Push the button">' +
    '      <span class="bt-base"></span><span class="bt-side"></span>' +
    '      <span class="bt-cap"><span class="bt-shine"></span><span class="bt-label">PUSH</span></span>' +
    "    </button>" +
    "  </div>" +
    '  <div id="bt-hint">tap · click · space</div>' +
    "</div>" +
    '<canvas id="bt-fx"></canvas>' +
    '<div id="bt-flash"></div>' +
    '<div id="bt-banner"><div class="bt-b-main"></div><div class="bt-b-sub"></div></div>' +
    '<div id="bt-toast"></div>';

  const CSS =
    "#bt-root{position:absolute;inset:0;overflow:hidden;background:#07030f;color:#fff;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;--h:300;--bs:260px;--ns:96px}" +
    "#bt-bg,#bt-fx{position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none}" +
    "#bt-fx{z-index:5}" +
    "#bt-stage{position:absolute;inset:0;z-index:2;will-change:transform}" +
    "#bt-top{position:absolute;left:0;right:0;top:0;display:flex;gap:8px;padding:10px 12px;z-index:8}" +
    ".bt-spacer{flex:1}" +
    ".bt-chip{font:800 12px/1 inherit;letter-spacing:.08em;color:#fff;background:rgba(0,0,0,.45);" +
    "border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:9px 13px;cursor:pointer;backdrop-filter:blur(4px)}" +
    ".bt-chip:active{transform:scale(.94)}" +
    "#bt-center{position:absolute;left:var(--hx,50%);top:var(--ht,9%);transform:translateX(-50%);display:flex;" +
    "flex-direction:column;align-items:center;pointer-events:none;width:92%}" +
    "#bt-tier{height:1.5em;font-weight:900;font-size:clamp(16px,3.4vmin,30px);letter-spacing:.22em;" +
    "text-shadow:0 0 14px currentColor,0 3px 0 rgba(0,0,0,.6);white-space:nowrap}" +
    "#bt-score{display:flex;justify-content:center;font-weight:900;font-size:var(--ns);line-height:1;" +
    "font-variant-numeric:tabular-nums;letter-spacing:-.02em;will-change:transform}" +
    ".bt-d{display:inline-block}" +
    ".bt-d.pop{animation:btDigit .55s cubic-bezier(.2,1.5,.35,1) both}" +
    "@keyframes btDigit{0%{transform:translateY(-55%) scale(2.2) rotate(var(--r));filter:brightness(3.5) saturate(0)}" +
    "45%{transform:translateY(7%) scale(.86) rotate(calc(var(--r) * -.3));filter:none}100%{transform:none}}" +
    "#bt-sub{margin-top:.5vmin;font-weight:800;font-size:clamp(10px,1.9vmin,15px);letter-spacing:.3em;text-transform:uppercase;" +
    "opacity:.75;text-shadow:0 2px 0 rgba(0,0,0,.6)}" +
    "#bt-meter{margin-top:1.4vmin;width:min(60%,320px);height:8px;border-radius:99px;background:rgba(0,0,0,.5);" +
    "border:1px solid rgba(255,255,255,.2);overflow:hidden;opacity:0;transition:opacity .2s}" +
    "#bt-meter.on{opacity:1}" +
    "#bt-meter i{display:block;height:100%;width:100%;transform-origin:left;background:linear-gradient(90deg,#ffe14d,#ff4d8d)}" +
    "#bt-combo{height:1.4em;margin-top:.8vmin;font-weight:900;font-size:clamp(14px,3vmin,26px);letter-spacing:.12em;" +
    "text-shadow:0 0 12px currentColor,0 3px 0 rgba(0,0,0,.6);will-change:transform}" +
    "#bt-btnwrap{position:absolute;left:var(--bx,50%);top:var(--by,68%);width:var(--bs);height:var(--bs);" +
    "transform:translate(-50%,-50%)}" +
    "#bt-glow{position:absolute;inset:-35%;border-radius:50%;pointer-events:none;" +
    "background:radial-gradient(circle,hsl(var(--h) 100% 60% / .6),transparent 62%)}" +
    "#bt-btn{position:absolute;inset:0;border:0;padding:0;background:none;cursor:pointer;outline:none;" +
    "touch-action:manipulation;-webkit-tap-highlight-color:transparent}" +
    ".bt-base,.bt-side,.bt-cap{position:absolute;border-radius:50%}" +
    ".bt-base{inset:0;background:radial-gradient(circle at 50% 30%,#59596b,#1b1b26 70%);" +
    "box-shadow:0 calc(var(--bs) * .05) 0 #08080d,0 calc(var(--bs) * .09) calc(var(--bs) * .16) rgba(0,0,0,.7),inset 0 3px 6px rgba(255,255,255,.22)}" +
    ".bt-side,.bt-cap{left:8%;top:8%;width:84%;height:84%}" +
    ".bt-side{background:hsl(var(--h) 85% 24%);box-shadow:inset 0 -6px 14px rgba(0,0,0,.45)}" +
    ".bt-cap{background:radial-gradient(circle at 36% 26%,hsl(var(--h) 100% 84%),hsl(var(--h) 95% 56%) 42%,hsl(var(--h) 90% 34%) 100%);" +
    "box-shadow:inset 0 calc(var(--bs) * -.04) calc(var(--bs) * .08) hsl(var(--h) 90% 18% / .55),inset 0 calc(var(--bs) * .02) calc(var(--bs) * .05) rgba(255,255,255,.55);" +
    "display:flex;align-items:center;justify-content:center;will-change:transform}" +
    ".bt-shine{position:absolute;left:18%;top:8%;width:42%;height:22%;border-radius:50%;" +
    "background:linear-gradient(rgba(255,255,255,.75),rgba(255,255,255,0));transform:rotate(-22deg)}" +
    ".bt-label{position:relative;font-weight:900;font-size:calc(var(--bs) * .15);letter-spacing:.12em;color:#fff;" +
    "text-shadow:0 3px 0 hsl(var(--h) 80% 22%),0 0 18px rgba(255,255,255,.7)}" +
    "#bt-hint{position:absolute;left:0;right:0;bottom:2.2%;text-align:center;font-weight:800;font-size:clamp(10px,1.8vmin,14px);" +
    "letter-spacing:.3em;text-transform:uppercase;opacity:.55;text-shadow:0 2px 0 rgba(0,0,0,.6);pointer-events:none}" +
    "#bt-hint.beg{animation:btBeg .7s ease-in-out infinite;opacity:1}" +
    "@keyframes btBeg{50%{transform:scale(1.18)}}" +
    "#bt-flash{position:absolute;inset:0;z-index:6;pointer-events:none;opacity:0;background:#fff}" +
    "#bt-banner{position:absolute;left:0;right:0;top:30%;z-index:7;text-align:center;pointer-events:none;opacity:0}" +
    "#bt-banner.on{animation:btBan 2.6s cubic-bezier(.2,.8,.2,1) forwards}" +
    "@keyframes btBan{0%{opacity:0;transform:scale(.3) rotate(-6deg)}8%{opacity:1;transform:scale(1.28) rotate(2deg)}" +
    "17%{transform:scale(1) rotate(0)}80%{opacity:1;transform:scale(1.05)}100%{opacity:0;transform:scale(1.6)}}" +
    ".bt-b-main{font-weight:900;font-size:clamp(38px,13vmin,130px);line-height:1;white-space:nowrap}" +
    ".bt-b-main span{display:inline-block;animation:btDrop .5s cubic-bezier(.2,1.6,.4,1) both;" +
    "text-shadow:3px 3px 0 #000,-3px 3px 0 #000,3px -3px 0 #000,-3px -3px 0 #000,0 0 28px currentColor}" +
    "@keyframes btDrop{from{transform:translateY(-130%) scale(2.2);opacity:0}to{transform:none;opacity:1}}" +
    ".bt-b-sub{margin-top:1.2vmin;font-weight:900;font-size:clamp(12px,2.8vmin,24px);letter-spacing:.16em;text-transform:uppercase;" +
    "text-shadow:0 3px 0 #000,0 0 14px rgba(255,255,255,.6)}" +
    "#bt-toast{position:absolute;left:50%;bottom:9%;z-index:7;transform:translate(-50%,20px);opacity:0;pointer-events:none;" +
    "background:rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.3);border-radius:99px;padding:10px 18px;font-weight:800;" +
    "font-size:clamp(12px,2.2vmin,17px);white-space:nowrap;transition:opacity .25s,transform .25s}" +
    "#bt-toast.on{opacity:1;transform:translate(-50%,0)}";

  /* ------------------------------------------------------------------ */
  /*  The game                                                           */
  /* ------------------------------------------------------------------ */

  const DEF = {
    k: "spark", x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 1, life: 1, max: 1, size: 2,
    hue: 0, sat: 100, lit: 60, rot: 0, vr: 0, flip: 0, vf: 0, a: 1, fade: 0.35,
    grow: 0, txt: "", die: null, add: false,
  };

  class TheButton {
    constructor(root) {
      this.root = root;
      const q = (s) => root.querySelector(s);
      this.el = {
        stage: q("#bt-stage"), bg: q("#bt-bg"), fx: q("#bt-fx"),
        score: q("#bt-score"), tier: q("#bt-tier"), sub: q("#bt-sub"),
        meter: q("#bt-meter"), meterFill: q("#bt-meter i"), combo: q("#bt-combo"),
        wrap: q("#bt-btnwrap"), btn: q("#bt-btn"), cap: q(".bt-cap"), glow: q("#bt-glow"),
        hint: q("#bt-hint"), flash: q("#bt-flash"), banner: q("#bt-banner"),
        bMain: q(".bt-b-main"), bSub: q(".bt-b-sub"), toast: q("#bt-toast"),
        sound: q('[data-act="sound"]'), calm: q('[data-act="calm"]'),
      };
      this.bgc = this.el.bg.getContext("2d");
      this.fxc = this.el.fx.getContext("2d");

      this.count = parseInt(lsGet(LS_COUNT), 10) || 0;
      this.bestCombo = parseInt(lsGet(LS_COMBO), 10) || 0;
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const savedCalm = lsGet(LS_CALM);
      this.calm = savedCalm === null ? !!reduce : savedCalm === "1";
      this.sfx = new Sfx(lsGet(LS_MUTE) === "1");

      this.combo = 0;
      this.comboLeft = 0;
      this.heat = 0;
      this.tier = 0;
      this.hue = rand(0, 360);
      this.bgHue = this.hue;
      this.juice = 0;
      this.surge = 0;
      this.trauma = 0;
      this.beat = 0;
      this.flashA = 0;
      this.freeze = 0;
      this.slowT = 0;
      this.slowScale = 1;
      this.tsv = 1;
      this.t = 0;
      this.idleT = 0;
      this.begT = 0;
      this.lastPushMs = 0;
      this.pressed = false;
      this.prevStr = "";
      this.parts = [];
      this.timers = [];
      this.q = 1;
      this.fpsEma = 60;
      this.dead = false;
      this.lastHue = -1;

      this.capY = new Spring(0, 380, 15);
      this.capS = new Spring(1, 320, 12);
      this.capR = new Spring(0, 220, 11);
      this.numS = new Spring(1, 260, 12);
      this.numR = new Spring(0, 220, 10);
      this.zoom = new Spring(1, 210, 12);
      this.tierS = new Spring(1, 260, 12);
      this.comboS = new Spring(1, 300, 13);

      this.stars = [];
      for (let i = 0; i < 140; i++) this.stars.push({ a: rand(0, TAU), d: Math.random(), s: rand(0.3, 1) });
      this.bokeh = [];
      for (let i = 0; i < 28; i++)
        this.bokeh.push({ x: Math.random(), y: Math.random(), r: rand(10, 46), vy: rand(0.008, 0.03), h: rand(0, 360), ph: rand(0, TAU) });

      this.bind();
      this.layout();
      this.renderNumber(true);
      this.updateChips();
      this.updateSub();
      this.frame = this.frame.bind(this);
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    /* ---------------- input / layout ---------------- */

    bind() {
      this.onResize = () => this.layout();
      window.addEventListener("resize", this.onResize);
      this.onKeyDown = (e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        if (e.target && e.target.closest && e.target.closest(".bt-chip")) return;
        e.preventDefault();
        this.pressed = true;
        this.push();
      };
      this.onKeyUp = (e) => {
        if (e.key === " " || e.key === "Enter") this.pressed = false;
      };
      document.addEventListener("keydown", this.onKeyDown);
      document.addEventListener("keyup", this.onKeyUp);

      const btn = this.el.btn;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.pressed = true;
        this.push();
      });
      const release = () => (this.pressed = false);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("contextmenu", (e) => e.preventDefault());

      this.root.querySelector('[data-act="menu"]').addEventListener("click", () => {
        if (typeof window.returnToMenu === "function") window.returnToMenu();
      });
      this.el.sound.addEventListener("click", (e) => {
        this.sfx.muted = !this.sfx.muted;
        lsSet(LS_MUTE, this.sfx.muted ? "1" : "0");
        this.sfx.wake();
        this.updateChips();
        e.currentTarget.blur();
      });
      this.el.calm.addEventListener("click", (e) => {
        this.calm = !this.calm;
        lsSet(LS_CALM, this.calm ? "1" : "0");
        this.updateChips();
        e.currentTarget.blur();
      });
    }

    updateChips() {
      this.el.sound.textContent = this.sfx.muted ? "🔇" : "🔊";
      this.el.calm.textContent = this.calm ? "JUICE: CALM" : "JUICE: MAX";
    }

    updateSub() {
      this.el.sub.textContent = this.bestCombo > 1 ? "pushes · best combo ×" + this.bestCombo : "pushes";
    }

    layout() {
      const W = (this.W = this.root.clientWidth || 800);
      const H = (this.H = this.root.clientHeight || 600);
      const land = H < 560 && W > H * 1.2;
      this.land = land;
      if (land) {
        this.bs = clamp(H * 0.62, 120, 340);
        this.bx = W * 0.72;
        this.by = H * 0.54;
        this.hx = W * 0.27;
        this.ht = H * 0.15;
      } else {
        this.bs = clamp(Math.min(W, H) * 0.44, 150, 340);
        this.bx = W / 2;
        this.by = H * 0.69;
        this.hx = W / 2;
        this.ht = H * 0.09;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia && window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2);
      this.dpr = dpr;
      for (const c of [this.el.bg, this.el.fx]) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const r = this.root.style;
      r.setProperty("--bs", this.bs + "px");
      r.setProperty("--bx", this.bx + "px");
      r.setProperty("--by", this.by + "px");
      r.setProperty("--hx", this.hx + "px");
      r.setProperty("--ht", this.ht + "px");
      this.depth = this.bs * 0.05;
      this.capY.t = -this.depth;
      if (!this.capY.v) this.capY.x = -this.depth;
      this.fitNumber();
    }

    fitNumber() {
      const len = this.prevStr.length || 1;
      const maxW = (this.land ? this.W * 0.5 : this.W * 0.92) / (len * 0.6);
      const maxH = Math.min(this.W, this.H) * (this.land ? 0.3 : 0.2);
      this.root.style.setProperty("--ns", clamp(Math.min(maxW, maxH, 170), 30, 170) + "px");
    }

    /* ---------------- the push ---------------- */

    push() {
      const nowMs = performance.now();
      if (nowMs - this.lastPushMs < MIN_GAP_MS) return;
      this.lastPushMs = nowMs;
      this.sfx.wake();

      this.count++;
      this.combo++;
      this.comboLeft = COMBO_WINDOW;
      this.idleT = 0;
      this.el.hint.classList.remove("beg");
      if (this.combo > this.bestCombo) {
        this.bestCombo = this.combo;
        lsSet(LS_COMBO, this.bestCombo);
        this.updateSub();
      }
      if (this.count % 20 === 0) lsSet(LS_COUNT, this.count);

      const heatNow = clamp(this.combo / HEAT_FULL, 0, 1);
      const h = Math.max(this.heat, heatNow);
      const i = 0.4 + 0.6 * h; // intensity of this individual push
      const fxs = this.calm ? 0.4 : 1;
      const crit = this.count > 4 && Math.random() < CRIT_CHANCE;
      const lvl = milestoneLevel(this.count);

      // -- the number itself
      this.hue += 13 + 16 * h;
      this.renderNumber(false);
      this.numS.x = 1.22 + 0.35 * h + (crit ? 0.2 : 0);
      this.numR.x = rand(-1, 1) * (5 + 9 * h) * fxs;
      this.comboS.x = 1.5;
      this.updateCombo();

      // -- the button
      this.capY.x = 0;
      this.capY.v = 0;
      this.capS.x = 1.1 + 0.05 * h;
      this.capR.x = rand(-1, 1) * (2 + 5 * h) * fxs;
      this.beat = 1;
      this.zoom.x = 1 + 0.025 * i * fxs;
      this.trauma = Math.min(1, this.trauma + (0.2 + 0.28 * h) * fxs + (crit ? 0.3 : 0));
      if (!this.calm) this.flashA = Math.max(this.flashA, 0.05 + 0.1 * h);
      this.surge = Math.min(1, this.surge + 0.012 + 0.02 * h);

      // -- particles
      this.pushFx(i, h, crit);

      // -- sound + haptics
      this.sfx.push(this.combo, h);
      if (crit) this.sfx.crit();
      if (navigator.vibrate) {
        try {
          navigator.vibrate(crit ? [18, 30, 24] : 8 + Math.round(12 * h));
        } catch (e) {}
      }

      // -- tiers, crits, milestones
      const nt = tierOf(this.combo);
      if (nt > this.tier) {
        this.tier = nt;
        this.tierUp(nt);
      } else if (nt < this.tier) {
        this.tier = nt;
      }
      if (crit) this.critFx();
      if (lvl) this.milestone(this.count, lvl);
    }

    updateCombo() {
      const el = this.el;
      el.combo.textContent = this.combo >= 2 ? "COMBO ×" + this.combo : "";
      el.combo.style.color = "hsl(" + (this.hue % 360 | 0) + " 100% 70%)";
      el.meter.classList.toggle("on", this.combo >= 2);
      el.tier.textContent = TIERS[this.tier].name;
    }

    renderNumber(initial) {
      const str = this.count.toLocaleString("en-US");
      const prev = this.prevStr;
      let html = "";
      for (let i = 0; i < str.length; i++) {
        const fromEnd = str.length - 1 - i;
        const ch = str[i];
        const pch = prev[prev.length - 1 - fromEnd];
        const changed = !initial && ch !== pch;
        html +=
          '<span class="bt-d' + (changed ? " pop" : "") + '"' +
          (changed ? ' style="--r:' + ((Math.random() * 2 - 1) * 28).toFixed(1) + 'deg"' : "") +
          ">" + ch + "</span>";
      }
      this.el.score.innerHTML = html;
      this.prevStr = str;
      this.fitNumber();
    }

    /* ---------------- special moments ---------------- */

    tierUp(t) {
      const fxs = this.calm ? 0.4 : 1;
      const name = TIERS[t].name;
      this.tierS.x = 2.2;
      this.trauma = Math.min(1, this.trauma + 0.55 * fxs);
      this.freeze = Math.max(this.freeze, this.calm ? 0 : 0.07);
      if (!this.calm) this.flashA = Math.max(this.flashA, 0.45);
      this.surge = Math.min(1, this.surge + 0.08);
      for (let r = 0; r < 3; r++)
        this.after(r * 0.08, () => this.ring(this.bx, this.by, this.hue + r * 40, 60 + r * 20, 900 + r * 250, 10 - r * 2));
      this.burst(Math.round(60 * this.q * fxs), {
        x: this.bx, y: this.by, speed: [200, 700], g: 300, drag: 0.95, life: [0.6, 1.3], size: [2, 4.5], hue: this.hue, hueSpread: 90,
      });
      this.starBurst(Math.round(10 * fxs), this.bx, this.by);
      this.sfx.tierUp(t);
      this.banner(name, t >= 6 ? "you cannot be stopped" : "keep pushing", t >= 6 ? 3 : 2, true);
      if (t >= 6) this.toastMsg(pick(["psst... sip some water 💧", "blink. just once. 👁️", "roll your shoulders 🙆"]));
    }

    critFx() {
      const fxs = this.calm ? 0.4 : 1;
      if (!this.calm) this.flashA = Math.max(this.flashA, 0.55);
      this.freeze = Math.max(this.freeze, this.calm ? 0 : 0.06);
      this.ring(this.bx, this.by, 48, 40, 1400, 14, true);
      this.burst(Math.round(70 * this.q * fxs), {
        x: this.bx, y: this.by, speed: [250, 800], g: 400, drag: 0.94, life: [0.7, 1.4], size: [2.5, 5], hue: 48, hueSpread: 14, lit: 65,
      });
      this.text("CRITICAL ONE!", this.bx, this.by - this.bs * 0.6, 48, Math.max(30, this.bs * 0.18), 1.5);
      this.coins(Math.round(14 * fxs));
    }

    milestone(n, level) {
      const fxs = this.calm ? 0.4 : 1;
      const W = this.W, H = this.H;
      this.sfx.milestone(level);
      if (navigator.vibrate) {
        try {
          navigator.vibrate([30, 40, 30, 40, 60]);
        } catch (e) {}
      }
      if (!this.calm && level >= 2) {
        this.slowT = 0.35 + 0.15 * level;
        this.slowScale = level >= 3 ? 0.3 : 0.5;
      }
      this.freeze = Math.max(this.freeze, this.calm ? 0 : 0.03 * level);
      if (!this.calm) this.flashA = Math.max(this.flashA, 0.35 + 0.15 * level);
      this.trauma = Math.min(1, this.trauma + 0.3 * level * fxs);
      this.surge = Math.min(1, this.surge + 0.14 * level);
      for (let r = 0; r < 2 + level; r++)
        this.after(r * 0.09, () => this.ring(this.bx, this.by, this.hue + r * 55, 80, 1100 + r * 300, 12));
      this.text(n.toLocaleString("en-US") + "!", W / 2, H * 0.42, this.hue + 90, Math.min(W * 0.2, 170), 1.8);
      this.sparkleFountain(level);
      if (level === 1) return;

      // confetti cannons from both bottom corners
      this.after(0.05, () => {
        for (const side of [0, 1]) {
          const x = side ? W + 10 : -10;
          this.burst(Math.round(70 * level * this.q * fxs), {
            x, y: H * 0.95, speed: [500, 1300], angle: side ? -2.35 : -0.79, spread: 0.5, g: 900, drag: 0.975,
            life: [1.8, 3.2], size: [5, 10], kind: "conf", hue: this.hue, hueSpread: 180,
          });
        }
      });
      this.coins(Math.round((16 + level * 10) * fxs));
      const shells = level >= 3 ? 8 : 3;
      for (let s = 0; s < shells; s++) {
        this.after(0.25 + s * (level >= 3 ? 0.3 : 0.28), () => {
          this.rocket(rand(W * 0.15, W * 0.85), rand(H * 0.12, H * 0.45));
        });
      }
      this.banner(n.toLocaleString("en-US"), pick(SUBS), level, false);
      if (level >= 3) this.toastMsg("that's a lot of pushes. you okay? 💧");
    }

    sparkleFountain(level) {
      const fxs = this.calm ? 0.4 : 1;
      this.burst(Math.round((40 + 30 * level) * this.q * fxs), {
        x: this.bx, y: this.by - this.bs * 0.3, speed: [300, 900], angle: -Math.PI / 2, spread: 0.7, g: 700, drag: 0.97,
        life: [0.9, 1.7], size: [2, 4.5], hue: this.hue, hueSpread: 140,
      });
      this.sfx.sparkle(4 + level * 2);
    }

    loseCombo() {
      const had = this.combo;
      this.combo = 0;
      this.tier = 0;
      this.tierS.x = 0.6;
      this.updateCombo();
      if (had >= 6) {
        this.sfx.fizz();
        for (let i = 0; i < Math.min(24, had) * this.q; i++)
          this.add({
            k: "smoke", x: this.bx + rand(-this.bs * 0.3, this.bs * 0.3), y: this.by - this.bs * 0.2, vx: rand(-30, 30),
            vy: rand(-90, -30), life: rand(0.7, 1.3), max: 1.3, size: rand(10, 24), grow: 40, lit: 35, sat: 8, a: 0.35,
          });
      }
    }

    /* ---------------- text overlays ---------------- */

    banner(main, sub, level, isTier) {
      const el = this.el;
      const base = this.hue;
      el.bMain.innerHTML = [...main]
        .map(
          (ch, i) =>
            '<span style="animation-delay:' + i * 38 + "ms;color:hsl(" + ((base + i * 38) % 360 | 0) + ' 100% 62%)">' +
            (ch === " " ? "&nbsp;" : ch) + "</span>"
        )
        .join("");
      el.bSub.textContent = sub;
      el.bSub.style.color = "hsl(" + ((base + 180) % 360 | 0) + " 100% 80%)";
      el.banner.style.top = isTier ? "24%" : "32%";
      el.banner.classList.remove("on");
      void el.banner.offsetWidth;
      el.banner.classList.add("on");
    }

    toastMsg(msg) {
      const t = this.el.toast;
      t.textContent = msg;
      t.classList.add("on");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
    }

    after(sec, fn) {
      this.timers.push({ t: sec, fn });
    }

    /* ---------------- particle spawners ---------------- */

    add(o) {
      if (this.parts.length >= PARTICLE_MAX * this.q) return null;
      const p = Object.assign({}, DEF, o);
      if (!o.max) p.max = p.life;
      this.parts.push(p);
      return p;
    }

    burst(n, o) {
      const ang = o.angle === undefined ? null : o.angle;
      for (let i = 0; i < n; i++) {
        const a = ang === null ? rand(0, TAU) : ang + rand(-1, 1) * (o.spread || 0.5);
        const sp = rand(o.speed[0], o.speed[1]);
        const life = rand(o.life[0], o.life[1]);
        const kind = o.kind || "spark";
        this.add({
          k: kind, x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.g || 0, drag: o.drag || 1, life,
          size: rand(o.size[0], o.size[1]), hue: o.hue + rand(-1, 1) * (o.hueSpread || 0), lit: o.lit || 60,
          rot: rand(0, TAU), vr: rand(-12, 12), flip: rand(0, TAU), vf: rand(6, 16),
        });
      }
    }

    starBurst(n, x, y) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), sp = rand(150, 520);
        this.add({
          k: "star", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 250, drag: 0.96, life: rand(0.7, 1.4),
          size: rand(8, 20), hue: this.hue + rand(-50, 50), lit: 70, rot: rand(0, TAU), vr: rand(-8, 8),
        });
      }
    }

    ring(x, y, hue, r0, speed, width, gold) {
      this.add({
        k: "ring", x, y, size: r0, grow: speed, life: 0.55, hue, lit: gold ? 62 : 68, a: width, fade: 0.7,
      });
    }

    text(txt, x, y, hue, size, life) {
      this.add({
        k: "text", txt, x, y, vx: rand(-40, 40), vy: -rand(80, 160), g: 40, drag: 0.985, life, size, hue, lit: 66,
        rot: rand(-0.18, 0.18), vr: rand(-0.2, 0.2), fade: 0.3,
      });
    }

    coins(n) {
      for (let i = 0; i < n; i++)
        this.after(i * 0.04, () =>
          this.add({
            k: "coin", x: rand(0, this.W), y: -20, vx: rand(-60, 60), vy: rand(50, 250), g: 700, drag: 0.995,
            life: 3.2, size: rand(9, 15), flip: rand(0, TAU), vf: rand(7, 14),
          })
        );
    }

    rocket(tx, ty) {
      const x = tx + rand(-60, 60), y = this.H + 10, g = 520;
      const vy = -Math.sqrt(2 * g * Math.max(80, y - ty));
      const hue = rand(0, 360);
      this.add({
        k: "rocket", x, y, vx: (tx - x) / (-vy / g), vy, g, life: -vy / g, size: 3.2, hue, lit: 75,
        die: (p) => this.explode(p.x, p.y, p.hue),
      });
    }

    explode(x, y, hue) {
      const fxs = this.calm ? 0.45 : 1;
      this.sfx.boom();
      if (!this.calm) this.flashA = Math.max(this.flashA, 0.12);
      this.trauma = Math.min(1, this.trauma + 0.12 * fxs);
      const type = (Math.random() * 3) | 0;
      const n = Math.round((type === 1 ? 54 : 78) * this.q * fxs);
      for (let i = 0; i < n; i++) {
        const a = type === 1 ? (i / n) * TAU : rand(0, TAU);
        const sp = type === 1 ? 300 : 340 * Math.sqrt(Math.random());
        this.add({
          k: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: type === 2 ? 220 : 140,
          drag: type === 2 ? 0.985 : 0.965, life: type === 2 ? rand(1.6, 2.4) : rand(0.9, 1.6), size: rand(1.8, 3.4),
          hue: type === 2 ? 46 : hue + rand(-22, 22), lit: Math.random() < 0.15 ? 92 : 62,
        });
      }
    }

    /* ---------------- per-push particle burst ---------------- */

    pushFx(i, h, crit) {
      const fxs = this.calm ? 0.4 : 1;
      const m = this.q * fxs;
      const x = this.bx, y = this.by - this.depth * 0.5;
      this.burst(Math.round((16 + 46 * i) * m), {
        x, y, speed: [160, 520 + 520 * h], g: 520, drag: 0.955, life: [0.35, 0.9 + 0.5 * h], size: [1.8, 3.6], hue: this.hue, hueSpread: 40 + 80 * h,
      });
      this.burst(Math.round((6 + 22 * h) * m), {
        x, y, speed: [200, 700], angle: -Math.PI / 2, spread: 1.1, g: 800, drag: 0.98, life: [1.0, 2.0], size: [4, 8], kind: "conf",
        hue: this.hue, hueSpread: 160,
      });
      this.starBurst(Math.round((2 + 4 * h) * fxs), x, y);
      this.ring(x, y, this.hue, this.bs * 0.4, 420 + 500 * h, 6 + 4 * h);
      if (h > 0.5) this.ring(x, y, this.hue + 120, this.bs * 0.3, 700 + 400 * h, 4);
      // The floating "+1" — the star of the show.
      const a = -Math.PI / 2 + rand(-0.9, 0.9);
      const p = this.add({
        k: "text", txt: "+1", x: x + rand(-30, 30), y: y - this.bs * 0.3, vx: Math.cos(a) * rand(80, 260), vy: Math.sin(a) * rand(240, 520),
        g: 520, drag: 0.985, life: 1.1 + 0.4 * h, size: (this.land ? 34 : 44) + 44 * i + (crit ? 40 : 0), hue: this.hue + rand(-40, 40), lit: 68,
        rot: rand(-0.35, 0.35), vr: rand(-1.2, 1.2), fade: 0.4,
      });
      if (p) p.sat = 100;
    }

    /* ---------------- frame loop ---------------- */

    frame(now) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.frame);
      const real = Math.min(0.05, (now - this.last) / 1000 || 0);
      this.last = now;

      // Adaptive quality: thin out particles on slow devices, restore when fast.
      if (real > 0) {
        this.fpsEma += (1 / real - this.fpsEma) * 0.05;
        if (this.fpsEma < 34) this.q = Math.max(0.35, this.q - real * 0.5);
        else if (this.fpsEma > 54) this.q = Math.min(1, this.q + real * 0.1);
      }

      for (let i = this.timers.length - 1; i >= 0; i--) {
        const tm = this.timers[i];
        tm.t -= real;
        if (tm.t <= 0) {
          this.timers.splice(i, 1);
          tm.fn();
        }
      }

      let dt = real;
      if (this.freeze > 0) {
        this.freeze -= real;
        dt = 0;
      }
      this.slowT -= real;
      const target = this.slowT > 0 ? this.slowScale : 1;
      this.tsv += (target - this.tsv) * Math.min(1, real * 10);
      dt *= this.tsv;

      this.update(dt, real);
      this.render(dt);
    }

    update(dt, real) {
      this.t += dt;

      // combo + heat
      if (this.combo > 0) {
        this.comboLeft -= real;
        if (this.comboLeft <= 0) this.loseCombo();
      }
      const ht = clamp(this.combo / HEAT_FULL, 0, 1);
      this.heat += (ht - this.heat) * Math.min(1, real * (ht > this.heat ? 3 : 0.55));

      // idle begging
      this.idleT += real;
      if (this.idleT > 3.5) {
        this.el.hint.classList.add("beg");
        this.begT -= real;
        if (this.begT <= 0) {
          this.begT = 1.4;
          this.capR.v += rand(-1, 1) > 0 ? 160 : -160;
          this.capY.v -= 240;
          this.burst(Math.round(6 * this.q), {
            x: this.bx, y: this.by, speed: [60, 200], g: 100, drag: 0.96, life: [0.5, 1], size: [1.5, 3], hue: this.hue, hueSpread: 60,
          });
        }
      }

      // springs
      this.capY.t = this.pressed ? 0 : -this.depth + Math.sin(this.t * 2.2) * this.depth * 0.08;
      this.capY.step(dt);
      this.capS.t = this.pressed ? 1.03 : 1;
      this.capS.step(dt);
      this.capR.step(dt);
      this.numS.step(dt);
      this.numR.step(dt);
      this.zoom.step(dt);
      this.tierS.t = 1;
      this.tierS.step(dt);
      this.comboS.step(dt);

      this.trauma = Math.max(0, this.trauma - dt * 1.5);
      this.beat *= Math.exp(-dt * 5);
      this.surge *= Math.exp(-dt * 0.45);
      this.flashA = Math.max(0, this.flashA - real * 3.2);
      this.hue += dt * (6 + this.heat * 70);
      this.bgHue += (this.hue - this.bgHue) * Math.min(1, dt * 2.5);
      const jt = clamp(Math.log10(1 + this.count) / 3.3, 0, 1) * 0.55 + this.heat * 0.35 + this.surge * 0.45;
      this.juice += (clamp(jt, 0, 1) - this.juice) * Math.min(1, real * 1.5);

      // ambient emitters: embers off the button, bubbles + drips from the juice
      const m = this.q * (this.calm ? 0.4 : 1);
      if (this.heat > 0.12 && dt > 0) {
        const n = this.heat * 90 * dt * m;
        for (let k = 0, c = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); k < c; k++) {
          const a = rand(0, TAU), r = this.bs * 0.5;
          this.add({
            k: "spark", x: this.bx + Math.cos(a) * r, y: this.by + Math.sin(a) * r * 0.9, vx: Math.cos(a) * 40, vy: -rand(80, 260),
            g: -60, drag: 0.98, life: rand(0.4, 1.0), size: rand(1.5, 3.2), hue: this.hue + rand(-30, 60), lit: 66,
          });
        }
      }
      if (this.juice > 0.04 && dt > 0) {
        const colW = this.juice * this.W * 0.15;
        if (Math.random() < dt * (3 + this.juice * 10) * m) {
          const right = Math.random() < 0.5;
          this.add({
            k: "bubble", x: right ? this.W - rand(2, colW) : rand(2, colW), y: this.H + 4, vx: 0, vy: -rand(40, 140), life: this.H / 80,
            size: rand(3, 10), hue: this.hue + 60, ph: rand(0, TAU),
          });
        }
        if (this.juice > 0.3 && Math.random() < dt * (this.juice * 9) * m) {
          const right = Math.random() < 0.5;
          this.add({
            k: "drip", x: right ? this.W - colW + rand(-4, 4) : colW + rand(-4, 4), y: rand(0, this.H * 0.35),
            vx: (right ? -1 : 1) * rand(10, 80), vy: rand(10, 60), g: 900, drag: 1, life: 2.4, size: rand(4, 9), hue: this.hue + 60,
          });
        }
      }

      this.updateParticles(dt);
    }

    updateParticles(dt) {
      const parts = this.parts;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) {
          if (p.die) p.die(p);
          parts[i] = parts[parts.length - 1];
          parts.pop();
          continue;
        }
        p.vy += p.g * dt;
        const dr = Math.pow(p.drag, dt * 60);
        p.vx *= dr;
        p.vy *= dr;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;
        if (p.grow) p.size += p.grow * dt;
        if (p.k === "rocket" && dt > 0 && Math.random() < 0.7)
          this.add({ k: "spark", x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(10, 60), g: 100, life: rand(0.25, 0.5), size: 1.6, hue: p.hue, lit: 70 });
        if (p.k === "bubble") p.x += Math.sin(this.t * 3 + p.ph) * 0.4;
        if ((p.k === "coin" || p.k === "drip") && p.y > this.H + 40) p.life = 0;
      }
    }

    /* ---------------- drawing ---------------- */

    render(dt) {
      const el = this.el;
      const calmMul = this.calm ? 0 : 1;
      const m = this.trauma * this.trauma * calmMul;
      const sx = (Math.sin(this.t * 53) + Math.sin(this.t * 29 + 1) * 0.6) * m * 22;
      const sy = (Math.sin(this.t * 47 + 3) + Math.sin(this.t * 31 + 2) * 0.6) * m * 22;
      const sr = Math.sin(this.t * 41 + 2) * m * 2.2;
      const z = this.zoom.x;
      el.stage.style.transform = "translate(" + sx.toFixed(1) + "px," + sy.toFixed(1) + "px) rotate(" + sr.toFixed(2) + "deg) scale(" + z.toFixed(4) + ")";
      el.bg.style.transform = "translate(" + (sx * 0.6).toFixed(1) + "px," + (sy * 0.6).toFixed(1) + "px) scale(" + (1.06 + (z - 1) * 0.8).toFixed(4) + ")";

      const hh = this.hue % 360 | 0;
      if (hh !== this.lastHue) {
        this.lastHue = hh;
        this.root.style.setProperty("--h", hh);
      }

      el.cap.style.transform =
        "translateY(" + this.capY.x.toFixed(2) + "px) scale(" + this.capS.x.toFixed(3) + "," + (1 + (1 - this.capS.x) * 0.9).toFixed(3) + ") rotate(" + this.capR.x.toFixed(2) + "deg)";
      el.glow.style.opacity = (0.45 + this.heat * 0.4 + this.beat * 0.35).toFixed(3);
      el.glow.style.transform = "scale(" + (1 + this.beat * 0.22 + this.heat * 0.1 + Math.sin(this.t * 3) * 0.03).toFixed(3) + ")";

      const ca = this.trauma * 8 * calmMul;
      const hc = "hsl(" + hh + " 100% 90%)";
      el.score.style.color = hc;
      el.score.style.transform = "scale(" + this.numS.x.toFixed(3) + ") rotate(" + this.numR.x.toFixed(2) + "deg)";
      el.score.style.textShadow =
        ca.toFixed(1) + "px 0 rgba(255,40,90,.85)," + (-ca).toFixed(1) + "px 0 rgba(40,230,255,.85),0 5px 0 rgba(0,0,0,.55),0 0 " +
        (18 + this.heat * 50).toFixed(0) + "px hsl(" + hh + " 100% 60%)";
      el.tier.style.color = "hsl(" + ((hh + 40) % 360) + " 100% 68%)";
      el.tier.style.transform = "scale(" + this.tierS.x.toFixed(3) + ")";
      el.combo.style.transform = "scale(" + this.comboS.x.toFixed(3) + ")";
      el.meterFill.style.transform = "scaleX(" + clamp(this.comboLeft / COMBO_WINDOW, 0, 1).toFixed(3) + ")";
      el.meterFill.style.background = "linear-gradient(90deg,hsl(" + hh + " 100% 60%),hsl(" + ((hh + 70) % 360) + " 100% 62%))";
      el.flash.style.opacity = this.flashA.toFixed(3);
      el.flash.style.background = "hsl(" + ((hh + 30) % 360) + " 100% 88%)";

      this.drawBg(dt);
      this.drawFx();
    }

    drawBg(dt) {
      const c = this.bgc, W = this.W, H = this.H, dpr = this.dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = this.bx, cy = this.by;
      const R = Math.hypot(W, H);
      const hue = this.bgHue % 360;
      const heat = this.heat, beat = this.beat;
      c.globalCompositeOperation = "source-over";
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 0.7);
      g.addColorStop(0, "hsl(" + hue + ",70%," + (14 + heat * 12 + beat * 6) + "%)");
      g.addColorStop(1, "hsl(" + ((hue + 40) % 360) + ",60%,4%)");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);

      // sunburst
      c.globalCompositeOperation = "lighter";
      const rays = 18;
      this.rayA = (this.rayA || 0) + dt * (0.12 + heat * 1.6) * (this.calm ? 0.3 : 1);
      const a0 = 0.05 + heat * 0.17 + beat * 0.12;
      for (let i = 0; i < rays; i++) {
        const a = this.rayA + (i / rays) * TAU, w = (TAU / rays) * 0.5;
        const rh = heat > 0.55 ? (hue + i * 20) % 360 : hue;
        c.fillStyle = "hsla(" + rh + ",100%,60%," + a0.toFixed(3) + ")";
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        c.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
        c.fill();
      }

      // warp starfield
      const warp = (0.04 + heat * 1.6 + beat * 0.5) * (this.calm ? 0.35 : 1);
      const half = Math.hypot(W, H) / 2;
      c.lineCap = "round";
      for (const s of this.stars) {
        const prev = s.d;
        s.d += s.s * warp * dt * 0.6 + dt * 0.01;
        if (s.d > 1) {
          s.d = rand(0, 0.08);
          s.a = rand(0, TAU);
          continue;
        }
        const d0 = Math.max(0, prev - warp * s.s * 0.06 * (prev + 0.1));
        const ca = Math.cos(s.a), sa = Math.sin(s.a);
        c.strokeStyle = "hsla(" + ((hue + 160) % 360) + ",90%,85%," + clamp(s.d * 1.2, 0, 0.9).toFixed(2) + ")";
        c.lineWidth = 0.6 + s.d * 2.2;
        c.beginPath();
        c.moveTo(cx + ca * d0 * half, cy + sa * d0 * half);
        c.lineTo(cx + ca * s.d * half, cy + sa * s.d * half);
        c.stroke();
      }

      // bokeh
      for (const b of this.bokeh) {
        b.y -= b.vy * dt * (1 + heat * 4);
        if (b.y < -0.1) b.y = 1.1;
        const al = (0.05 + heat * 0.08) * (0.6 + 0.4 * Math.sin(this.t + b.ph));
        c.fillStyle = "hsla(" + ((b.h + hue) % 360) + ",90%,65%," + al.toFixed(3) + ")";
        c.beginPath();
        c.arc(b.x * W, b.y * H, b.r * (1 + beat * 0.2), 0, TAU);
        c.fill();
      }

      // the juice, leaking up the sides
      c.globalCompositeOperation = "source-over";
      if (this.juice > 0.015) this.drawJuice(c, hue);

      // vignette
      const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0," + (0.55 - heat * 0.15).toFixed(2) + ")");
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }

    drawJuice(c, hue) {
      const W = this.W, H = this.H, j = this.juice;
      const base = j * W * 0.15;
      const amp = 5 + j * 18 + this.beat * 9;
      const jh = (hue + 60) % 360;
      for (let side = 0; side < 2; side++) {
        const dir = side ? -1 : 1, x0 = side ? W : 0;
        const edge = (y) =>
          base + Math.sin(y * 0.021 + this.t * 1.7 + side * 2) * amp + Math.sin(y * 0.047 - this.t * 2.4) * amp * 0.45;
        const g = c.createLinearGradient(x0, 0, x0 + dir * (base + amp * 2), 0);
        g.addColorStop(0, "hsla(" + (jh + 40) % 360 + ",90%,36%,.95)");
        g.addColorStop(1, "hsla(" + jh + ",95%,56%,.9)");
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x0, 0);
        for (let y = 0; y <= H + 12; y += 12) c.lineTo(x0 + dir * edge(y), y);
        c.lineTo(x0, H);
        c.closePath();
        c.fill();
        c.strokeStyle = "hsla(" + jh + ",100%,86%,.65)";
        c.lineWidth = 2.5;
        c.beginPath();
        for (let y = 0; y <= H + 12; y += 12) {
          const x = x0 + dir * edge(y);
          if (y === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }
    }

    drawFx() {
      const c = this.fxc, dpr = this.dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, this.W, this.H);
      c.lineCap = "round";
      c.lineJoin = "round";
      let comp = "";
      for (const p of this.parts) {
        const t = p.life / p.max;
        const alpha = p.a * (t < p.fade ? t / p.fade : 1);
        const additive = p.k === "spark" || p.k === "rocket" || p.k === "ring" || p.k === "star";
        const want = additive ? "lighter" : "source-over";
        if (want !== comp) {
          c.globalCompositeOperation = want;
          comp = want;
        }
        switch (p.k) {
          case "spark":
          case "rocket": {
            c.strokeStyle = "hsla(" + (p.hue % 360 | 0) + "," + p.sat + "%," + p.lit + "%," + alpha.toFixed(2) + ")";
            c.lineWidth = p.size;
            c.beginPath();
            c.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
            c.lineTo(p.x, p.y);
            c.stroke();
            break;
          }
          case "star": {
            c.fillStyle = "hsla(" + (p.hue % 360 | 0) + ",100%," + p.lit + "%," + alpha.toFixed(2) + ")";
            c.save();
            c.translate(p.x, p.y);
            c.rotate(p.rot);
            c.beginPath();
            for (let k = 0; k < 8; k++) {
              const r = k % 2 ? p.size * 0.32 : p.size;
              const a = (k / 8) * TAU;
              c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            c.closePath();
            c.fill();
            c.restore();
            break;
          }
          case "ring": {
            c.strokeStyle = "hsla(" + (p.hue % 360 | 0) + ",100%," + p.lit + "%," + alpha.toFixed(2) + ")";
            c.lineWidth = Math.max(0.5, p.a * (p.life / p.max) * 1.6);
            c.beginPath();
            c.arc(p.x, p.y, Math.max(1, p.size), 0, TAU);
            c.stroke();
            break;
          }
          case "conf": {
            c.fillStyle = "hsla(" + (p.hue % 360 | 0) + ",100%,60%," + alpha.toFixed(2) + ")";
            c.save();
            c.translate(p.x, p.y);
            c.rotate(p.rot);
            c.scale(1, Math.cos(p.flip));
            c.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
            c.restore();
            break;
          }
          case "coin": {
            const sx = Math.abs(Math.cos(p.flip));
            c.save();
            c.translate(p.x, p.y);
            c.scale(Math.max(0.12, sx), 1);
            c.fillStyle = "hsl(46,100%,56%)";
            c.strokeStyle = "hsl(36,100%,32%)";
            c.lineWidth = 2;
            c.beginPath();
            c.arc(0, 0, p.size, 0, TAU);
            c.fill();
            c.stroke();
            c.fillStyle = "hsl(50,100%,78%)";
            c.fillRect(-p.size * 0.12, -p.size * 0.5, p.size * 0.24, p.size);
            c.restore();
            break;
          }
          case "bubble": {
            c.strokeStyle = "hsla(" + (p.hue % 360 | 0) + ",100%,90%," + (alpha * 0.7).toFixed(2) + ")";
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(p.x, p.y, p.size, 0, TAU);
            c.stroke();
            c.fillStyle = "rgba(255,255,255," + (alpha * 0.5).toFixed(2) + ")";
            c.beginPath();
            c.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.22, 0, TAU);
            c.fill();
            break;
          }
          case "drip": {
            c.fillStyle = "hsla(" + (p.hue % 360 | 0) + ",95%,58%,.95)";
            c.beginPath();
            c.ellipse(p.x, p.y, p.size * 0.7, p.size * (1 + Math.min(2, Math.abs(p.vy) / 500)), 0, 0, TAU);
            c.fill();
            break;
          }
          case "smoke": {
            c.fillStyle = "hsla(0,0%," + p.lit + "%," + (alpha * 0.5).toFixed(2) + ")";
            c.beginPath();
            c.arc(p.x, p.y, p.size, 0, TAU);
            c.fill();
            break;
          }
          case "text": {
            const age = p.max - p.life;
            let sc = 1;
            if (age < 0.14) {
              const u = age / 0.14;
              sc = 0.3 + 1.1 * (1 - Math.pow(1 - u, 3)) + 0.2 * Math.sin(u * Math.PI);
            }
            c.save();
            c.translate(p.x, p.y);
            c.rotate(p.rot);
            c.scale(sc, sc);
            c.font = "900 " + Math.round(p.size) + "px -apple-system,'Segoe UI',Roboto,sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.lineJoin = "round";
            c.lineWidth = Math.max(4, p.size * 0.16);
            c.strokeStyle = "rgba(0,0,0," + alpha.toFixed(2) + ")";
            c.strokeText(p.txt, 0, 0);
            c.shadowColor = "hsla(" + (p.hue % 360 | 0) + ",100%,60%," + alpha.toFixed(2) + ")";
            c.shadowBlur = 18;
            c.fillStyle = "hsla(" + (p.hue % 360 | 0) + ",100%," + p.lit + "%," + alpha.toFixed(2) + ")";
            c.fillText(p.txt, 0, 0);
            c.restore();
            break;
          }
        }
      }
      c.globalCompositeOperation = "source-over";
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      window.removeEventListener("resize", this.onResize);
      document.removeEventListener("keydown", this.onKeyDown);
      document.removeEventListener("keyup", this.onKeyUp);
      clearTimeout(this.toastTimer);
      lsSet(LS_COUNT, this.count);
      this.sfx.close();
      if (navigator.vibrate) {
        try {
          navigator.vibrate(0);
        } catch (e) {}
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  function injectStyle() {
    if (document.getElementById("bt-style")) return;
    const s = document.createElement("style");
    s.id = "bt-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function launchTheButton() {
    if (window.theButtonGame) return window.theButtonGame;

    injectStyle();
    const root = document.createElement("div");
    root.id = "bt-root";
    root.innerHTML = HTML;
    document.getElementById("game-container").appendChild(root);

    const game = new TheButton(root);
    const handle = {
      root: root,
      game: game,
      destroy: function () {
        game.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    window.theButtonGame = handle;
    return handle;
  }

  window.launchTheButton = launchTheButton;
})();
