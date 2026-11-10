// Hollow Moon — an artistic one-fight ARPG (three.js, DOM HUD).
// A moonlit hilltop of tall, wind-blown grass; a lone duelist; one boss.
// The grass is the UI: every enemy telegraph is painted into the blade tips,
// and blades get cut by slashes, flattened by slams and parted by the charge.
// Characters are Meshy-generated rigged GLBs (src/hollow-moon/), with primitive
// fallbacks (?art=0). window.launchHollowMoon(); window.hollowMoonGame.destroy().
(function () {
  "use strict";

  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";
  function resolve(rel) { try { return new URL(rel, SELF_SRC || location.href).href; } catch (e) { return rel; } }
  var THREE = null, GLTFLoader = null, PP = null;
  var ART = { hero: null, foe: null };
  var PARAMS = new URLSearchParams(location.search);
  var COARSE = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  // ------------------------------------------------------------- tuning
  var ARENA_R = 15, FIELD = 28, CUT_N = 128;
  var HERO = { hp: 100, speed: 6.4, height: 1.8, reach: 2.9, dashCd: 3.5, dashTime: 0.24, dashDist: 6.6 };
  var COMBO = [
    { wind: 0.10, total: 0.36, dmg: 14, post: 6, lunge: 1.1, stop: 0.055, dir: 1 },
    { wind: 0.10, total: 0.36, dmg: 14, post: 6, lunge: 1.1, stop: 0.055, dir: -1 },
    { wind: 0.20, total: 0.60, dmg: 27, post: 13, lunge: 1.9, stop: 0.12, dir: 1 }
  ];
  var BOSS = { hp: 1500, height: 3.7, radius: 1.15, walk: 2.5, name: "THE ANTLERED VIGIL" };
  var HILL_K = 0.0055;
  function hill(x, z) { return -HILL_K * (x * x + z * z); }

  var CLIPS = {
    hero: ["idle", "run", "slash1", "slash2", "slash3", "dash", "hit", "death"],
    foe: ["idle", "walk", "run", "sweep", "leap", "roar", "stagger", "death"]
  };

  // ------------------------------------------------------------- styles / DOM
  var CSS = [
    "#hm-root{position:absolute;inset:0;overflow:hidden;background:#03060c;touch-action:none;user-select:none;-webkit-user-select:none;font-family:Georgia,'Times New Roman',serif;color:#dfe9ff}",
    "#hm-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}",
    ".hm-hud{position:absolute;inset:0;pointer-events:none}",
    ".hm-boss{position:absolute;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);width:min(78vw,620px);opacity:0;transition:opacity .8s}",
    ".hm-boss.on{opacity:1}",
    ".hm-bname{text-align:center;letter-spacing:.32em;font-size:13px;color:#e8d9c8;text-shadow:0 0 12px #000,0 1px 2px #000;margin-bottom:5px}",
    ".hm-bbar{position:relative;height:13px;background:rgba(6,8,14,.72);border:1px solid rgba(214,196,170,.55);box-shadow:0 0 0 1px #000,0 2px 12px rgba(0,0,0,.7);transform:skewX(-14deg)}",
    ".hm-bbar i{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:left;display:block}",
    ".hm-bghost{background:#f1e2c4;transition:transform .7s .25s ease-out}",
    ".hm-bfill{background:linear-gradient(#e2473f,#8d1420)}",
    ".hm-bbar.hit{animation:hmhit .18s}",
    "@keyframes hmhit{0%{filter:brightness(2.4)}100%{filter:none}}",
    ".hm-bbar b{position:absolute;left:50%;top:-3px;bottom:-3px;width:2px;background:rgba(240,225,200,.7)}",
    ".hm-post{height:4px;margin:4px 12% 0;background:rgba(6,8,14,.6);transform:skewX(-14deg);overflow:hidden}",
    ".hm-post i{display:block;height:100%;width:100%;transform-origin:center;background:#ffd98a;transform:scaleX(0)}",
    ".hm-php{position:absolute;left:max(14px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));width:min(34vw,220px);opacity:0;transition:opacity .8s}",
    ".hm-php.on{opacity:1}",
    ".hm-php .hm-bbar{height:9px;border-color:rgba(170,200,255,.5)}",
    ".hm-php .hm-bfill{background:linear-gradient(#bfe6ff,#4f8fd8)}",
    ".hm-php .hm-bghost{background:#fff}",
    ".hm-php small{display:block;font-size:10px;letter-spacing:.3em;margin-bottom:4px;color:#a9c3ee;padding-left:42px}",
    ".hm-menu{position:absolute;left:max(10px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));width:34px;height:34px;border-radius:50%;border:1px solid rgba(170,200,255,.4);background:rgba(6,10,20,.5);color:#cfe0ff;font-size:17px;pointer-events:auto;z-index:5}",
    ".hm-php{margin-left:0}.hm-php .hm-bbar{margin-left:42px}",
    ".hm-btn{position:absolute;border-radius:50%;pointer-events:auto;display:flex;align-items:center;justify-content:center;border:2px solid rgba(200,225,255,.6);background:radial-gradient(circle at 35% 30%,rgba(120,160,230,.34),rgba(8,14,30,.62));box-shadow:0 0 22px rgba(120,170,255,.25),inset 0 0 18px rgba(140,190,255,.2);touch-action:none;overflow:hidden;-webkit-tap-highlight-color:transparent}",
    ".hm-btn svg{width:54%;height:54%;pointer-events:none;filter:drop-shadow(0 0 6px rgba(190,225,255,.9))}",
    ".hm-btn.down{transform:scale(.9);filter:brightness(1.6)}",
    ".hm-atk{width:clamp(84px,22vmin,124px);height:clamp(84px,22vmin,124px);right:max(22px,env(safe-area-inset-right));bottom:max(26px,env(safe-area-inset-bottom))}",
    ".hm-skl{width:clamp(56px,14vmin,78px);height:clamp(56px,14vmin,78px);right:calc(max(22px,env(safe-area-inset-right)) + clamp(84px,22vmin,124px) + 4px);bottom:calc(max(26px,env(safe-area-inset-bottom)) + clamp(60px,15vmin,92px));border-color:rgba(255,225,170,.65);background:radial-gradient(circle at 35% 30%,rgba(240,200,120,.3),rgba(20,14,8,.62))}",
    ".hm-skl .cd{position:absolute;inset:0;border-radius:50%;background:conic-gradient(rgba(2,4,10,.78) var(--cd,0deg),transparent 0);pointer-events:none}",
    ".hm-skl.ready{box-shadow:0 0 26px rgba(255,220,150,.55),inset 0 0 18px rgba(255,220,150,.3)}",
    ".hm-zone{position:absolute;left:0;bottom:0;width:50%;height:62%;pointer-events:auto;touch-action:none}",
    ".hm-stick{position:absolute;width:128px;height:128px;margin:-64px 0 0 -64px;border-radius:50%;border:2px solid rgba(190,215,255,.4);background:radial-gradient(circle,rgba(120,160,230,.1),rgba(8,14,30,.3));display:none;pointer-events:none}",
    ".hm-stick i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#dfeaff,#6f93d6);box-shadow:0 0 18px rgba(150,190,255,.7)}",
    ".hm-hint{position:absolute;left:25%;bottom:14%;transform:translateX(-50%);font-size:11px;letter-spacing:.24em;color:rgba(200,220,255,.45);transition:opacity .6s}",
    ".hm-vig{position:absolute;inset:0;box-shadow:inset 0 0 140px 30px rgba(190,20,30,.0);transition:box-shadow .35s}",
    ".hm-vig.hurt{box-shadow:inset 0 0 150px 40px rgba(220,30,40,.6);transition:none}",
    ".hm-vig.low{box-shadow:inset 0 0 150px 30px rgba(190,20,30,.3)}",
    ".hm-bars i{position:absolute;left:0;right:0;height:0;background:#000;transition:height .5s}.hm-bars i+i{bottom:0}.hm-bars i:first-child{top:0}",
    ".hm-bars.on i{height:9vh}",
    ".hm-num{position:absolute;font:700 20px Georgia,serif;color:#fff;text-shadow:0 0 8px #7fb4ff,0 2px 2px #000;transform:translate(-50%,-50%);animation:hmnum .8s ease-out forwards;white-space:nowrap}",
    ".hm-num.big{font-size:30px;color:#ffe9a8;text-shadow:0 0 12px #ffb040,0 2px 2px #000}",
    ".hm-num.pl{color:#ff8a8a;text-shadow:0 0 8px #c00,0 2px 2px #000}",
    ".hm-num.txt{font-size:17px;letter-spacing:.3em;color:#cfe6ff}",
    "@keyframes hmnum{0%{opacity:0;margin-top:8px;transform:translate(-50%,-50%) scale(1.7)}15%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;margin-top:-58px}}",
    ".hm-card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:auto;background:radial-gradient(ellipse at 50% 60%,rgba(3,6,14,.25),rgba(2,4,10,.82));transition:opacity .9s;padding:20px}",
    ".hm-card.off{opacity:0;pointer-events:none}",
    ".hm-card h1{font-weight:400;font-size:clamp(34px,9vmin,76px);letter-spacing:.3em;margin:0 0 6px .3em;color:#eef4ff;text-shadow:0 0 34px rgba(150,190,255,.8)}",
    ".hm-card p{margin:6px 0;font-size:clamp(12px,2.6vmin,16px);letter-spacing:.2em;color:#a9bfe6}",
    ".hm-card .go{margin-top:26px;animation:hmpulse 1.8s infinite;color:#fff}",
    "@keyframes hmpulse{50%{opacity:.35}}",
    ".hm-card button{margin:22px 8px 0;padding:11px 26px;font:inherit;letter-spacing:.22em;font-size:14px;color:#eaf2ff;background:rgba(20,30,60,.6);border:1px solid rgba(180,210,255,.6);border-radius:2px}",
    ".hm-title2{position:absolute;left:0;right:0;top:34%;text-align:center;font-size:clamp(20px,5.4vmin,44px);letter-spacing:.42em;color:#f0e2cf;text-shadow:0 0 30px rgba(220,60,50,.8),0 2px 3px #000;opacity:0;transition:opacity 1s}",
    ".hm-title2.on{opacity:1}",
    "@media (max-aspect-ratio:1/1){.hm-boss{width:70vw;margin-left:14px}.hm-php{left:50%;transform:translateX(-50%);margin-left:14px;width:46vw;top:calc(max(14px,env(safe-area-inset-top)) + 50px)}.hm-php small{display:none}.hm-php .hm-bbar{margin-left:0}}",
    ".hm-title2 small{display:block;font-size:.36em;letter-spacing:.5em;color:#c9b6a0;margin-top:10px}"
  ].join("\n");

  var ICON_ATK = '<svg viewBox="0 0 64 64" fill="none" stroke="#eaf4ff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 52 L44 20"/><path d="M44 20 L54 10 L50 24 Z" fill="#eaf4ff"/><path d="M14 40 L24 50"/><path d="M8 56 L13 51"/><path d="M26 12 A30 30 0 0 1 54 40" opacity=".55"/></svg>';
  var ICON_SKL = '<svg viewBox="0 0 64 64" fill="none" stroke="#ffe7b0" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M40 8 A24 24 0 1 0 56 44 A19 19 0 1 1 40 8 Z" fill="rgba(255,231,176,.25)"/><path d="M6 30 H24"/><path d="M10 40 H22"/><path d="M12 20 H20"/></svg>';

  var HUD_HTML =
    '<div class="hm-hud">' +
    '<div class="hm-vig"></div><div class="hm-bars"><i></i><i></i></div>' +
    '<div class="hm-boss"><div class="hm-bname">' + BOSS.name + '</div><div class="hm-bbar" data-hm="bbar"><i class="hm-bghost" data-hm="bghost"></i><i class="hm-bfill" data-hm="bfill"></i><b></b></div><div class="hm-post"><i data-hm="post"></i></div></div>' +
    '<div class="hm-php"><small>WANDERER</small><div class="hm-bbar"><i class="hm-bghost" data-hm="pghost"></i><i class="hm-bfill" data-hm="pfill"></i></div></div>' +
    '<div class="hm-title2" data-hm="title2"></div>' +
    '<div class="hm-zone" data-hm="zone"></div><div class="hm-stick" data-hm="stick"><i></i></div>' +
    '<div class="hm-hint" data-hm="hint">DRAG TO MOVE</div>' +
    '<div class="hm-btn hm-skl" data-hm="skl">' + ICON_SKL + '<span class="cd"></span></div>' +
    '<div class="hm-btn hm-atk" data-hm="atk">' + ICON_ATK + '</div>' +
    '<div data-hm="nums"></div>' +
    '<button class="hm-menu" data-hm="menu" type="button">≡</button>' +
    '<div class="hm-card" data-hm="card"><h1>HOLLOW MOON</h1><p>a duel in the tall grass</p><p class="go" data-hm="go">gathering moonlight…</p></div>' +
    '</div>';

  // ------------------------------------------------------------- audio (synth)
  function Sfx() { this.ctx = null; }
  Sfx.prototype.init = function () {
    if (this.ctx) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext; this.ctx = new C();
      var c = this.ctx, n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
      var s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      var f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 420; f.Q.value = 0.6;
      var g = c.createGain(); g.gain.value = 0.05; s.connect(f); f.connect(g); g.connect(this.master); s.start();
      this.windF = f; this.windG = g;
    } catch (e) { this.ctx = null; }
  };
  Sfx.prototype.wind = function (w, t) {
    if (!this.ctx) return;
    this.windF.frequency.value = 340 + 260 * w + 120 * Math.sin(t * 0.7);
    this.windG.gain.value = 0.035 + 0.035 * w + 0.015 * Math.sin(t * 0.43);
  };
  Sfx.prototype.whoosh = function (f0, f1, dur, vol) {
    if (!this.ctx) return; var c = this.ctx, t = c.currentTime;
    var s = c.createBufferSource(); s.buffer = this.noise;
    var f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.6;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  };
  Sfx.prototype.tone = function (type, f0, f1, dur, vol) {
    if (!this.ctx) return; var c = this.ctx, t = c.currentTime;
    var o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  };
  Sfx.prototype.slash = function (big) { this.whoosh(big ? 500 : 900, big ? 3200 : 4200, big ? 0.26 : 0.16, big ? 0.5 : 0.32); };
  Sfx.prototype.hit = function (big) { this.tone("triangle", big ? 190 : 240, 50, big ? 0.3 : 0.16, 0.6); this.whoosh(3000, 700, 0.1, 0.4); if (big) this.tone("sine", 880, 440, 0.4, 0.15); };
  Sfx.prototype.boom = function () { this.tone("sine", 110, 28, 0.9, 0.9); this.whoosh(700, 80, 0.7, 0.7); };
  Sfx.prototype.roar = function () { this.tone("sawtooth", 95, 48, 1.5, 0.35); this.tone("sawtooth", 143, 60, 1.5, 0.22); this.whoosh(300, 900, 1.4, 0.5); };
  Sfx.prototype.warn = function () { this.tone("sine", 330, 220, 0.35, 0.12); };
  Sfx.prototype.chime = function () { this.tone("sine", 1320, 1320, 0.7, 0.2); this.tone("sine", 1980, 1980, 0.9, 0.12); };
  Sfx.prototype.close = function () { if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; } };

  // ------------------------------------------------------------- shaders
  var TELE_GLSL = [
    "uniform vec4 uCirc[8]; uniform vec4 uConeA; uniform vec4 uConeB; uniform vec4 uLineA; uniform vec4 uLineB; uniform vec4 uRing;",
    "float tele(vec2 p){ float a=0.;",
    " for(int i=0;i<8;i++){ vec4 c=uCirc[i]; float d=length(p-c.xy); float e=smoothstep(c.z,c.z-0.3,d); float rim=smoothstep(0.4,0.,abs(d-c.z)); a=max(a,c.w*max(e*0.6,rim)); }",
    " { vec2 d=p-uConeA.xy; float l=length(d); float cs=dot(d/max(l,1e-3),uConeB.xy); float inn=step(l,uConeA.z)*smoothstep(uConeB.z-0.05,uConeB.z+0.03,cs); float fill=step(l,uConeA.z*uConeB.w); a=max(a,uConeA.w*inn*(0.3+0.7*fill)); }",
    " { vec2 d=p-uLineA.xy; float al=dot(d,uLineB.xy); float pe=abs(dot(d,vec2(-uLineB.y,uLineB.x))); float inn=step(0.,al)*step(al,uLineA.z)*smoothstep(uLineB.z,uLineB.z-0.35,pe); float fill=step(al,uLineA.z*uLineB.w); a=max(a,uLineA.w*inn*(0.3+0.7*fill)); }",
    " { float d=abs(length(p-uRing.xy)-uRing.z); a=max(a,uRing.w*smoothstep(0.9,0.,d)); }",
    " return a; }"
  ].join("\n");

  var GRASS_VS = [
    "uniform float uTime; uniform float uWind; uniform float uField; uniform sampler2D uCut; uniform vec4 uPush[4];",
    TELE_GLSL,
    "attribute vec3 aOff; attribute vec4 aRnd;",
    "varying float vH; varying float vTele; varying float vGust; varying float vTint; varying float vDist; varying float vCut;",
    "void main(){",
    " vec2 uvc=aOff.xz/(2.*uField)+.5; float cut=texture2D(uCut,uvc).r; vCut=cut;",
    " float h=mix(0.13,1.,cut)*aRnd.y; float t=position.y;",
    " float ca=cos(aRnd.x), sa=sin(aRnd.x);",
    " vec3 p=vec3(position.x*ca,t*h,position.x*sa);",
    " vec2 wd=normalize(vec2(1.,.38));",
    " float ph=dot(aOff.xz,wd)*.33-uTime*1.7;",
    " float gust=sin(ph)+.5*sin(ph*2.3+aRnd.z*1.5+uTime*.7)+.4*sin(dot(aOff.xz,vec2(-.31,.9))*.8+uTime*2.1);",
    " gust=clamp(gust*.3+.5,0.,1.); vGust=gust;",
    " vec2 disp=wd*(0.16+0.62*gust)*uWind;",
    " disp+=vec2(sin(uTime*5.+aRnd.z*6.28),cos(uTime*4.3+aRnd.z*9.))*0.05*uWind;",
    " for(int i=0;i<4;i++){ vec2 d=aOff.xz-uPush[i].xy; float l=length(d); disp+=d/max(l,1e-3)*smoothstep(uPush[i].z,0.,l)*uPush[i].w; }",
    " { vec2 d=aOff.xz-uRing.xy; float l=length(d); disp+=d/max(l,1e-3)*smoothstep(1.6,0.,abs(l-uRing.z))*uRing.w*1.1; }",
    " float k=t*t; float dl=min(length(disp),1.25); disp=normalize(disp+1e-5)*dl;",
    " p.xz+=disp*k*h; p.y-=dl*dl*k*h*0.42;",
    " vec3 wp=aOff+p; vH=t; vTint=aRnd.w; vTele=tele(aOff.xz);",
    " vec4 mv=viewMatrix*vec4(wp,1.); vDist=-mv.z; gl_Position=projectionMatrix*mv; }"
  ].join("\n");

  var GRASS_FS = [
    "uniform vec3 uFog; uniform float uFogD; uniform float uRage; uniform float uTime;",
    "varying float vH; varying float vTele; varying float vGust; varying float vTint; varying float vDist; varying float vCut;",
    "void main(){",
    " vec3 root=vec3(0.006,0.022,0.035); vec3 mid=mix(vec3(0.03,0.13,0.14),vec3(0.05,0.11,0.17),vTint);",
    " vec3 tip=mix(vec3(0.20,0.36,0.42),vec3(0.32,0.40,0.52),vTint);",
    " tip=mix(tip,vec3(0.7,0.5,0.52),uRage*0.3);",
    " vec3 c=mix(root,mid,smoothstep(0.,.55,vH)); c=mix(c,tip,smoothstep(.45,1.,vH)*(0.35+0.75*vGust));",
    " c+=tip*pow(vH,5.)*vGust*vGust*1.5;",
    " c*=mix(0.55,1.,vCut);",
    " float pulse=0.75+0.25*sin(uTime*14.);",
    " vec3 tc=vec3(2.6,0.16,0.10)*pulse; c=mix(c,tc*(0.25+0.95*vH),clamp(vTele,0.,1.)*0.92);",
    " float f=1.-exp(-uFogD*uFogD*vDist*vDist); c=mix(c,uFog,f);",
    " gl_FragColor=vec4(c,1.);",
    " #include <tonemapping_fragment>",
    " #include <colorspace_fragment>",
    "}"
  ].join("\n");

  var GROUND_VS = "varying vec3 vW; varying float vDist; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mv=viewMatrix*w; vDist=-mv.z; gl_Position=projectionMatrix*mv; }";
  var GROUND_FS = [
    "uniform vec3 uFog; uniform float uFogD; uniform float uTime;", TELE_GLSL,
    "varying vec3 vW; varying float vDist;",
    "void main(){ vec3 c=vec3(0.008,0.024,0.032); float a=tele(vW.xz); c=mix(c,vec3(1.2,0.08,0.05),a*0.6);",
    " float f=1.-exp(-uFogD*uFogD*vDist*vDist); c=mix(c,uFog,f); gl_FragColor=vec4(c,1.);",
    " #include <tonemapping_fragment>", " #include <colorspace_fragment>", "}"
  ].join("\n");

  var SKY_FS = [
    "varying vec3 vD; uniform float uRage; uniform float uTime;",
    "float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }",
    "float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }",
    "void main(){ vec3 d=normalize(vD); float h=clamp(d.y,0.,1.);",
    " vec3 top=vec3(0.004,0.008,0.028); vec3 hor=mix(vec3(0.022,0.055,0.15),vec3(0.10,0.04,0.09),uRage*0.45);",
    " vec3 c=mix(hor,top,pow(h,0.42));",
    " vec3 md=normalize(vec3(-0.16,0.165,-1.)); float m=max(dot(d,md),0.);",
    " vec3 mc=mix(vec3(0.55,0.7,1.),vec3(1.,0.45,0.4),uRage*0.7);",
    " c+=mc*(pow(m,90.)*0.22+pow(m,10.)*0.06);",
    " vec2 q=d.xz/(d.y+0.25); float cl=noise(q*2.2+vec2(uTime*0.012,0.))*.6+noise(q*5.+vec2(uTime*0.02,3.))*.4;",
    " c+=mc*smoothstep(0.55,0.95,cl)*0.07*(0.3+pow(m,3.)*2.5)*smoothstep(0.,0.15,d.y);",
    " vec2 sp=d.xz/(abs(d.y)+0.35)*90.; vec2 si=floor(sp); float s=hash(si); float tw=0.6+0.4*sin(uTime*2.+s*40.);",
    " float st=step(0.985,s)*smoothstep(0.45,0.,length(fract(sp)-.5))*tw*smoothstep(0.02,0.25,d.y);",
    " c+=vec3(st)*1.6*(1.-pow(m,8.));",
    " gl_FragColor=vec4(c,1.);", " #include <tonemapping_fragment>", " #include <colorspace_fragment>", "}"
  ].join("\n");

  var ARC_VS = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }";
  var ARC_FS = [
    "varying vec2 vUv; uniform vec3 uCol; uniform float uT; uniform float uDir;",
    "void main(){ float a=uDir>0.?vUv.x:1.-vUv.x; float head=uT*1.5; float trail=smoothstep(head-0.75,head,a)*step(a,head);",
    " float r=vUv.y; float edge=smoothstep(0.,0.25,r)*pow(r,1.6); float al=trail*edge*(1.-smoothstep(0.55,1.,uT));",
    " gl_FragColor=vec4(uCol*al*(1.+2.*pow(r,6.)),al); }"
  ].join("\n");

  // ------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angDiff(a, b) { var d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
  function turnTo(cur, target, max) { var d = angDiff(cur, target); return cur + clamp(d, -max, max); }

  // ------------------------------------------------------------- Actor
  function Actor(kind, height) {
    this.kind = kind; this.height = height;
    this.root = new THREE.Group(); this.vis = new THREE.Group(); this.root.add(this.vis);
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0; this.air = 0;
    this.mixer = null; this.actions = {}; this.cur = null; this.curName = "";
    this.mats = []; this.flash = 0; this.hand = null; this.fore = null;
    this.lean = 0; this.twist = 0; this.pitch = 0; this.sink = 0;
    var art = ART[kind];
    if (art) this.useModel(art); else this.buildPrimitive();
  }
  Actor.prototype.useModel = function (art) {
    var self = this, s = art.scene;
    s.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(s), size = new THREE.Vector3(); box.getSize(size);
    var k = this.height / Math.max(size.y, 0.001);
    s.scale.setScalar(k); s.position.y = -box.min.y * k;
    s.traverse(function (o) {
      if (o.isMesh) {
        o.frustumCulled = false;
        var m = o.material; m.metalness = 0; m.roughness = 0.72; m.emissive = new THREE.Color(0x000000);
        if (self.kind === "foe") { m.color.setRGB(1.5, 1.5, 1.7); } else m.color.setRGB(1.25, 1.25, 1.35);
        self.mats.push(m);
      }
      if (o.isBone) {
        if (/right.?hand$/i.test(o.name)) self.hand = o;
        if (/right.?fore.?arm$/i.test(o.name)) self.fore = o;
        if (/^head$/i.test(o.name)) self.head = o;
      }
    });
    this.vis.add(s);
    this.mixer = new THREE.AnimationMixer(s);
    for (var name in art.clips) {
      var a = this.mixer.clipAction(art.clips[name]); this.actions[name] = a;
    }
    this.play("idle");
  };
  Actor.prototype.buildPrimitive = function () {
    var h = this.height, foe = this.kind === "foe";
    var mat = new THREE.MeshStandardMaterial({ color: foe ? 0x1b1c26 : 0x2a3566, roughness: 0.7 });
    this.mats.push(mat);
    var body = new THREE.Mesh(new THREE.CapsuleGeometry(h * (foe ? 0.2 : 0.14), h * 0.5, 4, 10), mat); body.position.y = h * 0.5;
    var head = new THREE.Mesh(new THREE.SphereGeometry(h * (foe ? 0.11 : 0.1), 12, 10), foe ? new THREE.MeshStandardMaterial({ color: 0xd9d2bf, roughness: 0.6 }) : new THREE.MeshStandardMaterial({ color: 0xe8ecf6, roughness: 0.6 }));
    head.position.y = h * 0.92; this.mats.push(head.material);
    this.vis.add(body, head);
    if (foe) {
      for (var s = -1; s <= 1; s += 2) for (var i = 0; i < 3; i++) {
        var a = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, h * 0.22, 5), head.material);
        a.position.set(s * (0.25 + i * 0.16), h * (1.0 + i * 0.03), 0); a.rotation.z = -s * (0.5 + i * 0.3); this.vis.add(a);
      }
    }
  };
  Actor.prototype.has = function (n) { return !!this.actions[n]; };
  Actor.prototype.play = function (name, o) {
    o = o || {}; var a = this.actions[name]; if (!a) return false;
    if (this.cur === a && !o.restart) return true;
    var fade = o.fade == null ? 0.14 : o.fade;
    a.reset(); a.enabled = true; a.setEffectiveWeight(1);
    a.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = !!o.once;
    var dur = a.getClip().duration;
    a.timeScale = o.dur ? dur / o.dur : (o.speed || 1);
    if (o.from) a.time = dur * o.from;
    if (this.cur && this.cur !== a) a.crossFadeFrom(this.cur, fade, false);
    a.play(); this.cur = a; this.curName = name; return true;
  };
  Actor.prototype.update = function (dt) {
    if (this.mixer) this.mixer.update(dt);
    this.y = hill(this.x, this.z);
    this.root.position.set(this.x, this.y + this.air, this.z);
    this.root.rotation.y = this.yaw;
    this.vis.rotation.set(this.pitch, this.twist, this.lean);
    this.vis.position.y = -this.sink;
    if (this.flash > 0) { this.flash -= dt; var f = this.flash > 0 ? 1 : 0; for (var i = 0; i < this.mats.length; i++) this.mats[i].emissive.setRGB(f * this.flashCol[0], f * this.flashCol[1], f * this.flashCol[2]); }
  };
  Actor.prototype.hitFlash = function (r, g, b, t) { this.flashCol = [r, g, b]; this.flash = t || 0.09; for (var i = 0; i < this.mats.length; i++) this.mats[i].emissive.setRGB(r, g, b); };
  var _v1, _v2;
  Actor.prototype.handPose = function (pos, dir) {
    var fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (this.hand && this.fore) {
      this.root.updateMatrixWorld(true);
      this.hand.getWorldPosition(pos); this.fore.getWorldPosition(_v1);
      dir.copy(pos).sub(_v1).normalize();
    } else {
      pos.set(this.x + fz * -0.35 * (this.kind === "foe" ? 2 : 1), this.y + this.air + this.height * 0.55, this.z + fx * 0.35 * (this.kind === "foe" ? 2 : 1));
      dir.set(fx, 0.2, fz);
    }
    return fx;
  };

  // ------------------------------------------------------------- Game
  function Game(root, sfx) {
    this.rootEl = root; this.sfx = sfx; this.dead = false;
    this.q = COARSE ? 0 : 1;
    if (PARAMS.get("hmq") === "low") this.q = 0; if (PARAMS.get("hmq") === "high") this.q = 1;
    _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3();
    this.setupRenderer(); this.setupScene(); this.setupHud(); this.setupInput();
    this.reset();
    this.last = performance.now(); this.time = 0;
    var self = this; this.raf = requestAnimationFrame(function loop(now) { if (self.dead) return; self.raf = requestAnimationFrame(loop); self.frame(now); });
  }

  Game.prototype.setupRenderer = function () {
    var r = new THREE.WebGLRenderer({ antialias: !!this.q, powerPreference: this.q ? "high-performance" : "default" });
    if (!r.getContext()) throw new Error("WebGL is not available on this device.");
    this.pr = Math.min(window.devicePixelRatio || 1, this.q ? 2 : 1.25);
    r.setPixelRatio(this.pr);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.15;
    this.renderer = r; this.rootEl.insertBefore(r.domElement, this.rootEl.firstChild);
    var self = this;
    r.domElement.addEventListener("webglcontextlost", function (e) { e.preventDefault(); self.fatal("The graphics context was lost."); });
    this.onResize = function () { self.resize(); }; window.addEventListener("resize", this.onResize);
  };

  Game.prototype.resize = function () {
    var w = this.rootEl.clientWidth || window.innerWidth, h = this.rootEl.clientHeight || window.innerHeight;
    this.w = w; this.h = h; this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.portrait = h > w;
    this.camera.fov = this.portrait ? 64 : 48; this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.pr); this.composer.setSize(w, h); }
  };

  Game.prototype.setupScene = function () {
    var sc = this.scene = new THREE.Scene();
    this.fogCol = new THREE.Color(0x070f22);
    sc.fog = new THREE.FogExp2(this.fogCol, 0.021);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.3, 400);
    this.camPos = new THREE.Vector3(0, 6, 16); this.camLook = new THREE.Vector3(0, 1.5, 0);

    // lights: the moon behind the hill is the key (rim), plus a cool fill
    this.moonLight = new THREE.DirectionalLight(0x9fbcff, 2.6); this.moonLight.position.set(-6, 9, -30); sc.add(this.moonLight);
    this.fill = new THREE.DirectionalLight(0x6f8cc8, 1.25); this.fill.position.set(4, 8, 14); sc.add(this.fill);
    this.hemi = new THREE.HemisphereLight(0x51669c, 0x0b1626, 1.3); sc.add(this.hemi);
    this.bladeLight = new THREE.PointLight(0x9fd4ff, 0, 9, 1.6); sc.add(this.bladeLight);
    this.eyeLight = new THREE.PointLight(0xff3a2a, 6, 10, 1.6); sc.add(this.eyeLight);

    // sky
    this.skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uRage: { value: 0 }, uTime: { value: 0 } },
      vertexShader: "varying vec3 vD; void main(){ vD=position; vec4 p=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.); gl_Position=p.xyww; }",
      fragmentShader: SKY_FS });
    var sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat); sky.frustumCulled = false; sky.renderOrder = -10; sc.add(sky);
    // the moon: an HDR disc so the bloom pass makes it glow
    this.moonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.65, 1.95), fog: false, depthWrite: false });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(15, 64), this.moonMat); this.moon.renderOrder = -9; sc.add(this.moon);
    this.moonDir = new THREE.Vector3(-0.16, 0.165, -1).normalize();

    // shared telegraph uniforms (grass + ground)
    var circ = []; for (var i = 0; i < 8; i++) circ.push(new THREE.Vector4(0, 0, 1, 0));
    var push = []; for (i = 0; i < 4; i++) push.push(new THREE.Vector4(0, 0, 1, 0));
    this.cutData = new Uint8Array(CUT_N * CUT_N).fill(255); this.cutF = new Float32Array(CUT_N * CUT_N).fill(1);
    this.cutTex = new THREE.DataTexture(this.cutData, CUT_N, CUT_N, THREE.RedFormat, THREE.UnsignedByteType);
    this.cutTex.magFilter = this.cutTex.minFilter = THREE.LinearFilter; this.cutTex.needsUpdate = true;
    var U = this.U = {
      uTime: { value: 0 }, uWind: { value: 1 }, uField: { value: FIELD }, uCut: { value: this.cutTex }, uPush: { value: push },
      uCirc: { value: circ }, uConeA: { value: new THREE.Vector4() }, uConeB: { value: new THREE.Vector4(0, 1, 0, 0) },
      uLineA: { value: new THREE.Vector4() }, uLineB: { value: new THREE.Vector4(0, 1, 1, 0) }, uRing: { value: new THREE.Vector4() },
      uFog: { value: this.fogCol }, uFogD: { value: 0.021 }, uRage: { value: 0 }
    };

    // ground
    var gg = new THREE.PlaneGeometry(240, 240, 80, 80); gg.rotateX(-Math.PI / 2);
    var gp = gg.attributes.position; for (i = 0; i < gp.count; i++) gp.setY(i, hill(gp.getX(i), gp.getZ(i)) - 0.02);
    sc.add(new THREE.Mesh(gg, new THREE.ShaderMaterial({ uniforms: U, vertexShader: GROUND_VS, fragmentShader: GROUND_FS })));

    // grass: one instanced draw call
    var N = this.q ? 110000 : 46000; if (PARAMS.get("hmgrass")) N = +PARAMS.get("hmgrass") | 0;
    var bw = 0.06, rows = 4, pos = [], idx = [];
    for (i = 0; i <= rows; i++) { var t = i / rows, w = bw * (1 - t * 0.92); pos.push(-w, t, 0, w, t, 0); }
    for (i = 0; i < rows; i++) { var a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    var ig = new THREE.InstancedBufferGeometry();
    ig.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); ig.setIndex(idx);
    var off = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
    for (i = 0; i < N; i++) {
      var rr = 30 * Math.pow(Math.random(), 0.62), an = Math.random() * 6.2832, x = Math.cos(an) * rr, z = Math.sin(an) * rr;
      off[i * 3] = x; off[i * 3 + 1] = hill(x, z); off[i * 3 + 2] = z;
      rnd[i * 4] = Math.random() * 6.2832; rnd[i * 4 + 1] = 0.68 + Math.random() * 0.6 + (Math.random() < 0.05 ? 0.4 : 0);
      rnd[i * 4 + 2] = Math.random(); rnd[i * 4 + 3] = Math.random();
    }
    ig.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 3)); ig.setAttribute("aRnd", new THREE.InstancedBufferAttribute(rnd, 4));
    ig.instanceCount = N;
    this.grass = new THREE.Mesh(ig, new THREE.ShaderMaterial({ uniforms: U, vertexShader: GRASS_VS, fragmentShader: GRASS_FS, side: THREE.DoubleSide }));
    this.grass.frustumCulled = false; sc.add(this.grass);

    // fireflies / pollen drifting on the wind
    var FN = 260, fp = new Float32Array(FN * 3);
    for (i = 0; i < FN; i++) { fp[i * 3] = (Math.random() - 0.5) * 60; fp[i * 3 + 1] = 0.6 + Math.random() * 5; fp[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    var fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
    this.flyMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uWind: { value: 1 }, uPx: { value: 1 } },
      vertexShader: "uniform float uTime; uniform float uWind; uniform float uPx; varying float vA; void main(){ vec3 p=position; float s=p.x*3.1+p.z*1.7; p.x=mod(p.x+uTime*(0.9+0.5*sin(s))*uWind+30.,60.)-30.; p.y+=sin(uTime*0.7+s)*0.5-0.0055*(p.x*p.x+p.z*p.z); p.z+=cos(uTime*0.5+s*2.)*0.6; vA=0.5+0.5*sin(uTime*1.7+s*5.); vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=uPx*(26.+18.*vA)/-mv.z; }",
      fragmentShader: "varying float vA; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vec3(0.8,1.0,1.3)*a*a*vA*1.6,a*vA); }" });
    var flies = new THREE.Points(fg, this.flyMat); flies.frustumCulled = false; sc.add(flies);

    // spark pool
    var PN = this.PN = 500; this.pp = new Float32Array(PN * 3); this.pc = new Float32Array(PN * 3); this.pv = new Float32Array(PN * 3);
    this.pl = new Float32Array(PN); this.pm = new Float32Array(PN); this.pcol = new Float32Array(PN * 3); this.pg = new Float32Array(PN); this.pi = 0;
    var pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(this.pp, 3)); pg.setAttribute("color", new THREE.BufferAttribute(this.pc, 3));
    this.sparks = new THREE.Points(pg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: { uPx: { value: 1 } },
      vertexShader: "uniform float uPx; varying vec3 vC; void main(){ vC=color; vec4 mv=viewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=uPx*60./-mv.z; }",
      fragmentShader: "varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vC*a*a,a); }" }));
    this.sparks.frustumCulled = false; sc.add(this.sparks);

    // slash arcs (pool)
    this.arcs = [];
    var ag = new THREE.RingGeometry(0.35, 1, 40, 1, -Math.PI * 0.42, Math.PI * 0.84);
    // remap uv: x along the angle, y across the radius
    var ap = ag.attributes.position, au = ag.attributes.uv;
    for (i = 0; i < ap.count; i++) { var px = ap.getX(i), py = ap.getY(i), rad = Math.sqrt(px * px + py * py), ang = Math.atan2(py, px); au.setXY(i, (ang + Math.PI * 0.42) / (Math.PI * 0.84), (rad - 0.35) / 0.65); }
    ag.rotateX(-Math.PI / 2); // flat on the ground plane, opening toward +x
    ag.rotateY(Math.PI / 2 * -1 + Math.PI); // now centred on +z ... see spawnArc
    for (i = 0; i < 6; i++) {
      var am = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uCol: { value: new THREE.Color() }, uT: { value: 0 }, uDir: { value: 1 } }, vertexShader: ARC_VS, fragmentShader: ARC_FS });
      var mesh = new THREE.Mesh(ag, am); mesh.visible = false; mesh.renderOrder = 20; sc.add(mesh); this.arcs.push({ mesh: mesh, t: 1, dur: 0.2 });
    }

    // moonfall beams (pool)
    this.beams = [];
    var bgm = new THREE.CylinderGeometry(1, 1, 40, 20, 1, true); bgm.translate(0, 20, 0);
    for (i = 0; i < 8; i++) {
      var bm = new THREE.Mesh(bgm, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      bm.visible = false; sc.add(bm); this.beams.push({ mesh: bm, t: 1 });
    }

    // weapons (primitive, glowing)
    this.blade = new THREE.Group();
    var bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.45, 0.11), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.0, 2.6) })); bl.position.y = 0.82;
    var hilt = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.34), new THREE.MeshStandardMaterial({ color: 0x8a94b8, roughness: 0.4 })); hilt.position.y = 0.1;
    this.blade.add(bl, hilt); this.bladeMat = bl.material; sc.add(this.blade);
    this.scythe = new THREE.Group();
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6), new THREE.MeshStandardMaterial({ color: 0x15131a, roughness: 0.8 })); shaft.position.y = 1.2;
    var sb = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.07, 4, 18, Math.PI * 0.62), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.35, 0.25) }));
    sb.position.set(-1.25, 3.35, 0); sb.scale.set(1, 1, 0.3);
    this.scythe.add(shaft, sb);
    this.antlers = new THREE.Group();
    var boneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.55, emissive: 0x3a1410, emissiveIntensity: 0.6 });
    function tine(parent, x, y, z, len, rz, rx, r) { var m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r, len, 5), boneMat); m.geometry.translate(0, len / 2, 0); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); parent.add(m); return m; }
    for (var sd = -1; sd <= 1; sd += 2) {
      var beam = tine(this.antlers, sd * 0.13, 0.05, 0, 0.95, -sd * 0.95, -0.25, 0.055);
      tine(beam, 0, 0.3, 0, 0.5, sd * 0.9, 0.2, 0.035); tine(beam, 0, 0.55, 0, 0.6, sd * 1.0, -0.1, 0.035); tine(beam, 0, 0.8, 0, 0.45, sd * 0.8, 0.3, 0.03); tine(beam, 0, 0.95, 0, 0.4, sd * 0.2, 0, 0.03);
    }
    var eyes = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.25) })); eyes.scale.set(3.2, 0.6, 1); eyes.position.set(0, -0.12, 0.2); this.antlers.add(eyes);
    sc.add(this.antlers); this.scytheMat = sb.material; sc.add(this.scythe);

    // post
    if (PP && PARAMS.get("hmbloom") !== "0") {
      try {
        var comp = new PP.EffectComposer(this.renderer);
        comp.addPass(new PP.RenderPass(sc, this.camera));
        this.bloom = new PP.UnrealBloomPass(new THREE.Vector2(256, 256), this.q ? 0.62 : 0.5, 0.7, 0.9);
        comp.addPass(this.bloom); comp.addPass(new PP.OutputPass());
        this.composer = comp;
      } catch (e) { this.composer = null; }
    }
    this.resize();
  };

  // --- grass cutting ---------------------------------------------------
  Game.prototype.cut = function (x, z, r, val, test) {
    var s = CUT_N / (2 * FIELD), cx = (x + FIELD) * s, cz = (z + FIELD) * s, cr = r * s;
    var x0 = Math.max(0, Math.floor(cx - cr)), x1 = Math.min(CUT_N - 1, Math.ceil(cx + cr)), z0 = Math.max(0, Math.floor(cz - cr)), z1 = Math.min(CUT_N - 1, Math.ceil(cz + cr));
    for (var j = z0; j <= z1; j++) for (var i = x0; i <= x1; i++) {
      var dx = i + 0.5 - cx, dz = j + 0.5 - cz; if (dx * dx + dz * dz > cr * cr) continue;
      if (test && !test(dx / s, dz / s)) continue;
      var k = j * CUT_N + i; if (this.cutF[k] > val) this.cutF[k] = val;
    }
  };
  Game.prototype.cutArc = function (x, z, r, yaw, half, val) {
    var fx = Math.sin(yaw), fz = Math.cos(yaw), ch = Math.cos(half);
    this.cut(x, z, r, val, function (dx, dz) { var l = Math.sqrt(dx * dx + dz * dz) || 1; return (dx * fx + dz * fz) / l > ch; });
  };
  Game.prototype.regrow = function (dt) {
    var f = this.cutF, d = this.cutData, g = dt * 0.045;
    for (var i = 0; i < f.length; i++) { var v = f[i]; if (v < 1) { v += g; if (v > 1) v = 1; f[i] = v; } d[i] = v * 255; }
    this.cutTex.needsUpdate = true;
  };

  // --- particles ---------------------------------------------------------
  Game.prototype.spark = function (x, y, z, n, speed, r, g, b, life, grav, dirx, dirz) {
    for (var k = 0; k < n; k++) {
      var i = this.pi = (this.pi + 1) % this.PN, a = Math.random() * 6.2832, e = Math.random() * 1.2 - 0.2, s = speed * (0.35 + Math.random() * 0.8);
      this.pp[i * 3] = x; this.pp[i * 3 + 1] = y; this.pp[i * 3 + 2] = z;
      this.pv[i * 3] = Math.cos(a) * Math.cos(e) * s + (dirx || 0) * speed; this.pv[i * 3 + 1] = Math.sin(e) * s + speed * 0.3; this.pv[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s + (dirz || 0) * speed;
      this.pl[i] = this.pm[i] = life * (0.5 + Math.random() * 0.7); this.pg[i] = grav;
      this.pcol[i * 3] = r; this.pcol[i * 3 + 1] = g; this.pcol[i * 3 + 2] = b;
    }
  };
  Game.prototype.stepSparks = function (dt) {
    for (var i = 0; i < this.PN; i++) {
      if (this.pl[i] <= 0) { this.pc[i * 3] = this.pc[i * 3 + 1] = this.pc[i * 3 + 2] = 0; continue; }
      this.pl[i] -= dt; var a = Math.max(0, this.pl[i] / this.pm[i]);
      this.pv[i * 3 + 1] -= this.pg[i] * dt;
      var dr = Math.exp(-2.2 * dt); this.pv[i * 3] *= dr; this.pv[i * 3 + 2] *= dr;
      this.pp[i * 3] += this.pv[i * 3] * dt; this.pp[i * 3 + 1] += this.pv[i * 3 + 1] * dt; this.pp[i * 3 + 2] += this.pv[i * 3 + 2] * dt;
      this.pc[i * 3] = this.pcol[i * 3] * a; this.pc[i * 3 + 1] = this.pcol[i * 3 + 1] * a; this.pc[i * 3 + 2] = this.pcol[i * 3 + 2] * a;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true; this.sparks.geometry.attributes.color.needsUpdate = true;
  };
  Game.prototype.clippings = function (x, z, r, n) {
    for (var i = 0; i < n; i++) { var a = Math.random() * 6.2832, d = Math.sqrt(Math.random()) * r, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; this.spark(px, hill(px, pz) + 0.7, pz, 1, 3.2, 0.25, 0.5, 0.42, 0.9, 5); }
  };
  Game.prototype.spawnArc = function (x, y, z, yaw, radius, dir, col, dur, tilt) {
    var best = this.arcs[0]; for (var i = 0; i < this.arcs.length; i++) if (this.arcs[i].t >= 1) { best = this.arcs[i]; break; }
    best.t = 0; best.dur = dur; var m = best.mesh; m.visible = true; m.position.set(x, y, z); m.scale.setScalar(radius);
    m.rotation.set(0, 0, 0); m.rotation.order = "YXZ"; m.rotation.y = yaw; m.rotation.z = tilt || 0;
    m.material.uniforms.uCol.value.setRGB(col[0], col[1], col[2]); m.material.uniforms.uDir.value = dir; m.material.uniforms.uT.value = 0;
  };

  // --- HUD / input ---------------------------------------------------------
  Game.prototype.setupHud = function () {
    var el = this.el = {}, nodes = this.rootEl.querySelectorAll("[data-hm]");
    for (var i = 0; i < nodes.length; i++) el[nodes[i].getAttribute("data-hm")] = nodes[i];
    this.bossHud = this.rootEl.querySelector(".hm-boss"); this.plHud = this.rootEl.querySelector(".hm-php");
    this.vig = this.rootEl.querySelector(".hm-vig"); this.bars = this.rootEl.querySelector(".hm-bars");
  };
  Game.prototype.num = function (x, y, z, text, cls) {
    _v2.set(x, y, z).project(this.camera);
    var d = document.createElement("div"); d.className = "hm-num " + (cls || ""); d.textContent = text;
    d.style.left = ((_v2.x * 0.5 + 0.5) * this.w + (Math.random() - 0.5) * 30) + "px"; d.style.top = ((-_v2.y * 0.5 + 0.5) * this.h) + "px";
    this.el.nums.appendChild(d); setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 850);
  };
  Game.prototype.setupInput = function () {
    var self = this, el = this.el;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }; this.keys = {}; this.wantAtk = 0; this.wantSkl = 0;
    var zone = el.zone, st = el.stick, knob = st.firstChild, R = 56;
    function rel(e) { var b = self.rootEl.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    this.on(zone, "pointerdown", function (e) {
      if (self.stick.id !== null) return; self.sfx.init(); e.preventDefault();
      var p = rel(e); self.stick.id = e.pointerId; self.stick.ox = p[0]; self.stick.oy = p[1]; self.stick.x = self.stick.y = 0;
      st.style.display = "block"; st.style.left = p[0] + "px"; st.style.top = p[1] + "px"; knob.style.transform = "";
      el.hint.style.opacity = 0;
      try { zone.setPointerCapture(e.pointerId); } catch (er) {}
    });
    this.on(zone, "pointermove", function (e) {
      if (e.pointerId !== self.stick.id) return; var p = rel(e), dx = p[0] - self.stick.ox, dy = p[1] - self.stick.oy, l = Math.sqrt(dx * dx + dy * dy);
      if (l > R) { // the base trails the thumb so the stick never runs out of travel
        self.stick.ox += dx * (1 - R / l); self.stick.oy += dy * (1 - R / l); dx *= R / l; dy *= R / l;
        st.style.left = self.stick.ox + "px"; st.style.top = self.stick.oy + "px";
      }
      self.stick.x = dx / R; self.stick.y = dy / R; knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    });
    function up(e) { if (e.pointerId !== self.stick.id) return; self.stick.id = null; self.stick.x = self.stick.y = 0; st.style.display = "none"; }
    this.on(zone, "pointerup", up); this.on(zone, "pointercancel", up);
    function btn(node, fn) {
      self.on(node, "pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); self.sfx.init(); node.classList.add("down"); fn(); });
      var rel2 = function () { node.classList.remove("down"); };
      self.on(node, "pointerup", rel2); self.on(node, "pointercancel", rel2); self.on(node, "pointerleave", rel2);
    }
    btn(el.atk, function () { self.wantAtk = 0.3; }); btn(el.skl, function () { self.wantSkl = 0.4; });
    this.on(window, "keydown", function (e) {
      if (e.repeat) return; var k = e.key.toLowerCase(); self.keys[k] = true;
      if (k === "j" || k === " " || k === "z") { self.wantAtk = 0.3; self.sfx.init(); e.preventDefault(); }
      if (k === "k" || k === "shift" || k === "x") { self.wantSkl = 0.4; self.sfx.init(); }
      if ((k === "enter" || k === " ") && self.phase === "title" && self.ready) self.begin();
      if (k === "r" && self.phase === "end") self.restart();
    });
    this.on(window, "keyup", function (e) { self.keys[e.key.toLowerCase()] = false; });
    this.on(el.card, "pointerdown", function (e) { self.sfx.init(); if (self.phase === "title" && self.ready) self.begin(); });
    this.on(el.card, "click", function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
      if (a === "retry") self.restart(); if (a === "menu") self.toMenu();
    });
    this.on(el.menu, "click", function () { self.toMenu(); });
    this.on(this.rootEl, "contextmenu", function (e) { e.preventDefault(); });
  };
  Game.prototype.on = function (t, ev, fn) { (this.listeners = this.listeners || []).push([t, ev, fn]); t.addEventListener(ev, fn, { passive: false }); };
  Game.prototype.toMenu = function () { if (typeof window.returnToMenu === "function") window.returnToMenu(); };

  // --- run state -------------------------------------------------------------
  Game.prototype.reset = function () {
    if (this.hero) { this.scene.remove(this.hero.root); this.scene.remove(this.boss.root); }
    var h = this.hero = new Actor("hero", HERO.height), b = this.boss = new Actor("foe", BOSS.height);
    this.scene.add(h.root, b.root);
    h.x = 0; h.z = 7.5; h.yaw = Math.PI; h.hp = HERO.hp; h.state = "move"; h.t = 0; h.combo = 0; h.dashCd = 0; h.inv = 0; h.kx = h.kz = 0; h.emp = 0; h.queued = false; h.didHit = false; h.comboT = 0;
    b.x = 0; b.z = -6.5; b.yaw = 0; b.hp = BOSS.hp; b.state = "wait"; b.t = 0; b.cd = 1.6; b.phase = 1; b.post = 0; b.postT = 0; b.last = ""; b.sub = 0; b.ax = 0; b.az = 0;
    if (!b.play("idle")) {} ; b.sink = 0;
    this.strikes = []; this.ring = { on: false, r: 0, x: 0, z: 0, hit: false };
    this.hitstop = 0; this.slow = 0; this.trauma = 0; this.rage = 0; this.rageT = 0; this.wind = 1; this.windT = 1;
    this.cutF.fill(1);
    this.phase = "title"; this.ready = true;
    this.clearTele(); this.updHud(true);
    this.el.go.innerHTML = COARSE ? "tap to begin" : "click or press enter<br><br><span style='opacity:.6;font-size:.8em'>WASD move · J attack · K moonstep</span>";
  };
  Game.prototype.begin = function () {
    var self = this; this.phase = "intro"; this.introT = 0; this.el.card.classList.add("off"); this.bars.classList.add("on");
    this.el.title2.innerHTML = BOSS.name + "<small>keeper of the hollow moon</small>";
    setTimeout(function () { if (!self.dead) self.el.title2.classList.add("on"); }, 900);
    setTimeout(function () { if (!self.dead) { self.el.title2.classList.remove("on"); } }, 3400);
    this.sfx.init();
  };
  Game.prototype.restart = function () { this.el.card.classList.add("off"); this.reset(); this.phase = "fight"; this.boss.state = "idle"; this.bossHud.classList.add("on"); this.plHud.classList.add("on"); this.vig.className = "hm-vig"; };
  Game.prototype.endCard = function (win) {
    var self = this; this.phase = "end";
    setTimeout(function () {
      if (self.dead) return;
      self.el.card.innerHTML = win ? '<h1>MOONRISE</h1><p>the vigil is ended · the grass grows back</p><div><button data-act="retry">DUEL AGAIN</button><button data-act="menu">MENU</button></div>'
        : '<h1 style="color:#ffb3b3">FALLEN</h1><p>the hollow moon keeps its watch</p><div><button data-act="retry">RISE AGAIN</button><button data-act="menu">MENU</button></div>';
      self.el.card.classList.remove("off");
    }, win ? 3200 : 1900);
  };
  Game.prototype.clearTele = function () {
    var U = this.U; for (var i = 0; i < 8; i++) U.uCirc.value[i].w = 0; U.uConeA.value.w = 0; U.uLineA.value.w = 0; U.uRing.value.w = 0;
  };
  Game.prototype.updHud = function (snap) {
    var el = this.el, b = this.boss, h = this.hero, bf = clamp(b.hp / BOSS.hp, 0, 1), pf = clamp(h.hp / HERO.hp, 0, 1);
    el.bfill.style.transform = "scaleX(" + bf + ")"; el.bghost.style.transform = "scaleX(" + bf + ")";
    el.pfill.style.transform = "scaleX(" + pf + ")"; el.pghost.style.transform = "scaleX(" + pf + ")";
    el.post.style.transform = "scaleX(" + clamp(b.post / 100, 0, 1) + ")";
    el.post.style.background = b.state === "stagger" ? "#fff" : "#ffd98a";
  };

  // --- combat helpers ---------------------------------------------------------
  Game.prototype.hurtBoss = function (dmg, post, big) {
    var b = this.boss, h = this.hero; if (b.state === "dead" || b.state === "wait") return;
    if (b.state === "roar") { dmg *= 0.25; post = 0; }
    var crit = h.emp > 0; if (crit) dmg *= 1.6;
    if (b.state === "stagger") dmg *= 1.5;
    dmg = Math.round(dmg * (0.92 + Math.random() * 0.16));
    b.hp -= dmg; b.hitFlash(1.6, 1.6, 1.9, 0.09);
    var hy = b.y + BOSS.height * 0.55, dx = b.x - h.x, dz = b.z - h.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
    this.spark(b.x - dx / l * 0.9, hy, b.z - dz / l * 0.9, big ? 34 : 16, big ? 11 : 8, 1.6, 2.0, 2.6, 0.45, 9, dx / l * 0.35, dz / l * 0.35);
    this.spark(b.x, hy, b.z, big ? 12 : 5, 6, 2.4, 0.3, 0.2, 0.5, 12);
    this.num(b.x, b.y + BOSS.height * (0.75 + Math.random() * 0.2), b.z, String(dmg), (big || crit) ? "big" : "");
    this.el.bbar.classList.remove("hit"); void this.el.bbar.offsetWidth; this.el.bbar.classList.add("hit");
    this.trauma = Math.min(1, this.trauma + (big ? 0.5 : 0.25)); this.sfx.hit(big);
    if (b.state !== "stagger") { b.post += post; b.postT = 2.2; }
    if (b.hp <= 0) { this.killBoss(); return; }
    if (b.phase === 1 && b.hp <= BOSS.hp * 0.5) { this.bossSet("roar"); return; }
    if (b.post >= 100 && b.state !== "stagger" && b.state !== "leap") { this.bossSet("stagger"); this.num(b.x, b.y + BOSS.height, b.z, "STAGGERED", "txt"); this.sfx.chime(); this.hitstop = 0.16; }
    this.updHud();
  };
  Game.prototype.hurtHero = function (dmg, fx, fz, kb) {
    var h = this.hero; if (h.state === "dead" || this.phase !== "fight") return false;
    if (h.inv > 0) { if (h.state === "dash" && !h.perfect) this.perfectDodge(); return false; }
    h.hp -= dmg; h.inv = 0.7; h.state = "hurt"; h.t = 0; h.kx = fx * kb; h.kz = fz * kb; h.combo = 0; h.queued = false;
    h.hitFlash(2.2, 0.3, 0.3, 0.12); h.play("hit", { once: true, restart: true, fade: 0.05 });
    this.num(h.x, h.y + 2.2, h.z, String(dmg), "pl");
    this.spark(h.x, h.y + 1.1, h.z, 14, 7, 2.4, 0.35, 0.3, 0.5, 9);
    this.trauma = Math.min(1, this.trauma + 0.6); this.hitstop = 0.09; this.sfx.hit(true);
    this.vig.classList.add("hurt"); var v = this.vig, self = this; setTimeout(function () { v.classList.remove("hurt"); v.classList.toggle("low", self.hero.hp > 0 && self.hero.hp < 35); }, 90);
    if (h.hp <= 0) { h.hp = 0; h.state = "dead"; h.t = 0; if (!h.play("death", { once: true, fade: 0.1 })) h.fall = true; this.slow = 1.2; this.clearTele(); this.endCard(false); }
    this.updHud(); return true;
  };
  Game.prototype.perfectDodge = function () {
    var h = this.hero; h.perfect = true; h.emp = 4.5; h.dashCd = 0.4; this.slow = 0.55; h.hp = Math.min(HERO.hp, h.hp + 8);
    this.num(h.x, h.y + 2.4, h.z, "MOONSTEP", "txt"); this.sfx.chime();
    this.spark(h.x, h.y + 1, h.z, 26, 6, 1.2, 1.8, 2.6, 0.7, 0);
  };
  Game.prototype.killBoss = function () {
    var b = this.boss; b.hp = 0; b.state = "dead"; b.t = 0; this.clearTele(); this.strikes.length = 0; this.ring.on = false;
    if (!b.play("death", { once: true, fade: 0.15 })) b.fall = true;
    this.slow = 2.2; this.hitstop = 0.28; this.trauma = 1; this.sfx.boom(); this.sfx.roar();
    this.spark(b.x, b.y + 2, b.z, 120, 14, 2.4, 1.6, 1.4, 1.6, 3);
    this.rageT = 0; this.windT = 0.7; this.updHud(); this.endCard(true); this.vig.className = "hm-vig";
  };
  Game.prototype.bossSet = function (s) {
    var b = this.boss, U = this.U; b.state = s; b.t = 0; b.sub = 0; b.pitch = 0; b.sink = 0; b.air = 0;
    U.uConeA.value.w = 0; U.uLineA.value.w = 0;
    var p2 = b.phase === 2;
    if (s === "idle") { b.cd = (p2 ? 0.3 : 0.65) + Math.random() * 0.55; b.play("idle", { fade: 0.25 }); }
    else if (s === "sweep") { b.W = p2 ? 0.72 : 0.95; b.play("sweep", { once: true, dur: b.W + 0.55, restart: true }); this.sfx.warn(); }
    else if (s === "leap") { b.W = 0.55; b.A = 0.8; b.sx = b.x; b.sz = b.z; b.play("leap", { once: true, dur: b.W + b.A + 0.5, restart: true }); this.sfx.warn(); }
    else if (s === "charge") { b.W = p2 ? 0.8 : 1.05; b.len = 0; b.chHit = false; b.play("roar", { once: true, dur: b.W + 0.3, restart: true }) || b.play("idle"); this.sfx.warn(); }
    else if (s === "moonfall") { b.n = 0; b.play("roar", { once: true, dur: 1.6, restart: true }); this.sfx.roar(); }
    else if (s === "roar") { b.phase = 2; b.post = 0; b.play("roar", { once: true, dur: 2.4, restart: true }); this.sfx.roar(); this.rageT = 1; this.windT = 1.9; this.slow = 0.5; this.strikes.length = 0; this.clearTele(); this.ring.on = false; this.num(b.x, b.y + BOSS.height + 0.4, b.z, "THE MOON HOLLOWS", "txt"); }
    else if (s === "stagger") { b.post = 100; if (!b.play("stagger", { fade: 0.1, restart: true })) b.play("idle"); this.ring.on = false; }
    b.last = s === "idle" ? b.last : s;
  };

  Game.prototype.updHero = function (dt) {
    var h = this.hero, b = this.boss, U = this.U;
    if (h.inv > 0) h.inv -= dt; if (h.dashCd > 0) h.dashCd -= dt; if (h.emp > 0) h.emp -= dt;
    if (this.wantAtk > 0) this.wantAtk -= dt; if (this.wantSkl > 0) this.wantSkl -= dt;
    // input vector (screen space == world xz, the camera never rotates)
    var mx = this.stick.x, mz = this.stick.y, k = this.keys;
    if (k.a || k.arrowleft) mx -= 1; if (k.d || k.arrowright) mx += 1; if (k.w || k.arrowup) mz -= 1; if (k.s || k.arrowdown) mz += 1;
    var ml = Math.sqrt(mx * mx + mz * mz); if (ml > 1) { mx /= ml; mz /= ml; ml = 1; } if (ml < 0.14) { mx = mz = ml = 0; }
    var dxb = b.x - h.x, dzb = b.z - h.z, db = Math.sqrt(dxb * dxb + dzb * dzb) || 1, bossAlive = b.state !== "dead";
    var fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    h.twist *= Math.exp(-10 * dt); h.pitch = lerp(h.pitch, 0, 1 - Math.exp(-10 * dt));

    if (h.state === "dead") { h.t += dt; if (h.fall) { h.pitch = -Math.min(1.5, h.t * 4); h.sink = Math.min(0.2, h.t); } return; }
    var canAct = this.phase === "fight";

    if (h.state === "hurt") {
      h.t += dt; h.x += h.kx * dt; h.z += h.kz * dt; var dr = Math.exp(-7 * dt); h.kx *= dr; h.kz *= dr; h.pitch = -0.35 * Math.max(0, 1 - h.t / 0.3);
      if (h.t > 0.34) { h.state = "move"; }
    }
    if (h.state === "move") {
      if (ml > 0) {
        h.x += mx * HERO.speed * ml * dt; h.z += mz * HERO.speed * ml * dt; h.yaw = turnTo(h.yaw, Math.atan2(mx, mz), 14 * dt);
        h.play("run", { speed: 0.75 + ml * 0.5 });
      } else { h.play("idle", { fade: 0.2 }); if (bossAlive && db < 9 && canAct) h.yaw = turnTo(h.yaw, Math.atan2(dxb, dzb), 5 * dt); }
      h.comboT -= dt; if (h.comboT <= 0) h.combo = 0;
      if (canAct && this.wantSkl > 0 && h.dashCd <= 0) { this.startDash(mx, mz, ml); }
      else if (canAct && this.wantAtk > 0) { this.startAttack(mx, mz, ml); }
    } else if (h.state === "attack") {
      var c = COMBO[h.combo]; h.t += dt;
      var lt = clamp(h.t / (c.wind + 0.1), 0, 1), sp = c.lunge / (c.wind + 0.1) * (1 - lt) * 2;
      if (db > BOSS.radius + 1.3 || !bossAlive) { h.x += fx * sp * dt; h.z += fz * sp * dt; }
      h.twist = c.dir * 0.5 * Math.sin(Math.min(1, h.t / c.total) * Math.PI);
      if (this.wantAtk > 0 && h.t > c.wind) { h.queued = true; this.wantAtk = 0; }
      if (!h.didHit && h.t >= c.wind) {
        h.didHit = true; var big = h.combo === 2, col = h.emp > 0 ? [1.8, 1.5, 0.8] : [0.55, 1.1, 1.8];
        this.spawnArc(h.x + fx * 0.3, h.y + 1.15, h.z + fz * 0.3, h.yaw, big ? 3.6 : 2.9, c.dir, col, big ? 0.3 : 0.2, c.dir * (big ? 0.5 : 0.18));
        this.sfx.slash(big); this.cutArc(h.x, h.z, big ? 3.5 : 2.8, h.yaw, 1.15, 0.12); this.clippings(h.x + fx * 1.6, h.z + fz * 1.6, 1.3, big ? 16 : 9);
        this.pushFx(h.x + fx * 1.5, h.z + fz * 1.5, 3.2, 0.9);
        if (bossAlive && db < HERO.reach + BOSS.radius + (big ? 0.6 : 0) && (dxb * fx + dzb * fz) / db > 0.2) {
          this.hitstop = Math.max(this.hitstop, c.stop); this.hurtBoss(c.dmg, c.post, big);
        }
      }
      if (h.t >= c.total * 0.72 && h.queued && h.combo < 2) { h.combo++; this.swing(mx, mz, ml); }
      else if (h.t >= c.total) { h.state = "move"; h.comboT = 0.45; if (h.combo === 2) h.combo = 0; else h.combo++; }
      if (canAct && this.wantSkl > 0 && h.dashCd <= 0 && h.t > c.wind) this.startDash(mx, mz, ml);
    } else if (h.state === "dash") {
      h.t += dt; var u = h.t / HERO.dashTime, v = HERO.dashDist / HERO.dashTime * (1.5 - u);
      var px = h.x, pz = h.z; h.x += h.dx * v * dt; h.z += h.dz * v * dt; h.pitch = 0.45;
      this.spark(h.x, h.y + 1.0, h.z, 2, 1.5, 0.9, 1.5, 2.4, 0.35, 0);
      this.cut(h.x, h.z, 0.8, 0.3);
      if (!h.dashHit && bossAlive) {
        var ddx = b.x - h.x, ddz = b.z - h.z; if (ddx * ddx + ddz * ddz < (BOSS.radius + 1.5) * (BOSS.radius + 1.5)) {
          h.dashHit = true; this.hitstop = 0.1; this.spawnArc(b.x, b.y + 1.5, b.z, h.yaw, 3.4, 1, [2.6, 2.2, 1.2], 0.26, 0.9); this.hurtBoss(30, 11, true);
        }
      }
      if (h.t >= HERO.dashTime) { h.state = "move"; h.inv = Math.max(h.inv, 0.1); }
    }
    // keep out of the boss and inside the arena
    if (bossAlive && h.state !== "dash") {
      dxb = h.x - b.x; dzb = h.z - b.z; db = Math.sqrt(dxb * dxb + dzb * dzb) || 1; var minD = BOSS.radius + 0.5;
      if (db < minD && b.air < 0.5) { h.x = b.x + dxb / db * minD; h.z = b.z + dzb / db * minD; }
    }
    var r = Math.sqrt(h.x * h.x + h.z * h.z); if (r > ARENA_R) { h.x *= ARENA_R / r; h.z *= ARENA_R / r; }
  };
  Game.prototype.swing = function (mx, mz, ml) {
    var h = this.hero, b = this.boss, dx = b.x - h.x, dz = b.z - h.z, d = Math.sqrt(dx * dx + dz * dz);
    h.state = "attack"; h.t = 0; h.didHit = false; h.queued = false; this.wantAtk = 0;
    if (b.state !== "dead" && d < 8.5) h.yaw = Math.atan2(dx, dz); else if (ml > 0) h.yaw = Math.atan2(mx, mz);
    var c = COMBO[h.combo]; h.play("slash" + (h.combo + 1), { once: true, restart: true, dur: c.total + 0.12, fade: 0.06, from: 0.12 });
  };
  Game.prototype.startAttack = function (mx, mz, ml) { this.swing(mx, mz, ml); };
  Game.prototype.startDash = function (mx, mz, ml) {
    var h = this.hero; this.wantSkl = 0; h.state = "dash"; h.t = 0; h.dashCd = HERO.dashCd; h.inv = HERO.dashTime + 0.1; h.perfect = false; h.dashHit = false; h.combo = 0;
    if (ml > 0) { h.dx = mx / ml; h.dz = mz / ml; } else { h.dx = Math.sin(h.yaw); h.dz = Math.cos(h.yaw); }
    h.yaw = Math.atan2(h.dx, h.dz); h.play("dash", { once: true, restart: true, dur: HERO.dashTime + 0.2, fade: 0.04 }) || h.play("run", { speed: 2 });
    this.sfx.whoosh(600, 5200, 0.3, 0.45); this.pushFx(h.x, h.z, 3, 0.8);
  };
  Game.prototype.pushFx = function (x, z, r, s) { this.fxPush = { x: x, z: z, r: r, s: s, t: 0 }; };

  Game.prototype.updBoss = function (dt) {
    var b = this.boss, h = this.hero, U = this.U, p2 = b.phase === 2;
    var dx = h.x - b.x, dz = h.z - b.z, d = Math.sqrt(dx * dx + dz * dz) || 1, aim = Math.atan2(dx, dz);
    var fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    b.t += dt;
    if (b.postT > 0) b.postT -= dt; else if (b.state !== "stagger" && b.post > 0) b.post = Math.max(0, b.post - 9 * dt);
    switch (b.state) {
      case "wait": break;
      case "dead": if (b.fall) { b.pitch = Math.min(1.45, b.t * 1.6); b.sink = Math.min(0.5, b.t * 0.4); } break;
      case "idle":
        b.yaw = turnTo(b.yaw, aim, 2.6 * dt);
        if (d > 3.4) { var sp = BOSS.walk * (p2 ? 1.4 : 1); b.x += fx * sp * dt; b.z += fz * sp * dt; b.play("walk", { speed: p2 ? 1.3 : 1, fade: 0.25 }); }
        else b.play("idle", { fade: 0.25 });
        b.cd -= dt;
        if (b.cd <= 0 && h.state !== "dead") {
          var opts = []; function add(n, w) { if (n !== b.last) w *= 1; else w *= 0.25; for (var i = 0; i < w * 4; i++) opts.push(n); }
          if (d < 6) add("sweep", 3); add("leap", d > 4.5 ? 2.2 : 0.8); if (d > 5.5) add("charge", 2.6); if (p2) add("moonfall", 1.8);
          this.bossSet(opts[(Math.random() * opts.length) | 0] || "sweep");
        }
        break;
      case "sweep": {
        var W = b.W, t = b.t - b.sub * (W * 0.62 + 0.3), range = 6.2;
        if (t < W * 0.62) b.yaw = turnTo(b.yaw, aim, 4.5 * dt);
        if (t < W) {
          U.uConeA.value.set(b.x, b.z, range, 0.5 + 0.5 * t / W); U.uConeB.value.set(fx, fz, Math.cos(1.25), t / W);
          b.twist = -0.7 * (t / W) * (b.sub ? -1 : 1);
        } else if (!b.did) {
          b.did = true; U.uConeA.value.w = 0; b.twist = 0.9 * (b.sub ? -1 : 1);
          this.spawnArc(b.x, b.y + 1.3, b.z, b.yaw, range, b.sub ? -1 : 1, [1.9, 0.25, 0.15], 0.3, 0); this.spawnArc(b.x, b.y + 0.8, b.z, b.yaw, range * 0.8, b.sub ? -1 : 1, [1.4, 0.5, 0.2], 0.36, 0.1);
          this.cutArc(b.x, b.z, range, b.yaw, 1.25, 0.1); this.clippings(b.x + fx * 3.5, b.z + fz * 3.5, 3, 40);
          this.sfx.slash(true); this.sfx.tone("sawtooth", 160, 60, 0.3, 0.25); this.trauma = Math.min(1, this.trauma + 0.35);
          if (d < range + 0.3 && (dx * fx + dz * fz) / d > Math.cos(1.3)) this.hurtHero(22, dx / d, dz / d, 13);
        }
        b.twist *= Math.exp(-3 * dt);
        if (t > W + 0.3 && p2 && b.sub === 0) { b.sub = 1; b.did = false; b.play("sweep", { once: true, dur: W + 0.55, restart: true, fade: 0.2 }); }
        else if (t > W + (p2 ? 0.75 : 1.0)) { b.did = false; this.bossSet("idle"); }
        break;
      }
      case "leap": {
        var c0 = U.uCirc.value[0];
        if (b.t < b.W) { b.tx = h.x; b.tz = h.z; b.yaw = turnTo(b.yaw, aim, 6 * dt); b.sink = 0.35 * b.t / b.W; c0.set(b.tx, b.tz, 4.0, 0.35 + 0.3 * b.t / b.W); }
        else if (b.t < b.W + b.A) {
          var u = (b.t - b.W) / b.A; if (u < 0.45) { b.tx = lerp(b.tx, h.x, 1 - Math.exp(-3 * dt)); b.tz = lerp(b.tz, h.z, 1 - Math.exp(-3 * dt)); }
          var e = u * u * (3 - 2 * u); b.x = lerp(b.sx, b.tx, e); b.z = lerp(b.sz, b.tz, e); b.air = Math.sin(u * Math.PI) * 6.5; b.sink = 0;
          c0.set(b.tx, b.tz, 4.0, 0.6 + 0.4 * u);
        } else if (!b.did) {
          b.did = true; b.air = 0; b.x = b.tx; b.z = b.tz; c0.w = 0;
          this.cut(b.x, b.z, 4.3, 0.04); this.clippings(b.x, b.z, 4, 60); this.spark(b.x, b.y + 0.5, b.z, 60, 13, 2.6, 0.7, 0.4, 0.8, 10);
          this.sfx.boom(); this.trauma = 1; this.hitstop = 0.07;
          this.ring.on = true; this.ring.r = 2.5; this.ring.x = b.x; this.ring.z = b.z; this.ring.hit = false;
          var ddx = h.x - b.x, ddz = h.z - b.z, dd = Math.sqrt(ddx * ddx + ddz * ddz) || 1; if (dd < 4.1) { if (this.hurtHero(28, ddx / dd, ddz / dd, 16)) this.ring.hit = true; }
          b.sink = 0.45;
        } else { b.sink = Math.max(0, b.sink - dt * 0.5); if (b.t > b.W + b.A + (p2 ? 1.0 : 1.5)) { b.did = false; this.bossSet("idle"); } }
        break;
      }
      case "charge": {
        var LEN = 19;
        if (b.t < b.W) {
          if (b.t < b.W * 0.72) b.yaw = turnTo(b.yaw, aim, 5 * dt);
          U.uLineA.value.set(b.x, b.z, LEN, 0.45 + 0.55 * b.t / b.W); U.uLineB.value.set(fx, fz, 1.5, b.t / b.W); b.pitch = -0.25 * b.t / b.W; b.sink = 0.25 * b.t / b.W;
        } else if (b.len < LEN) {
          if (!b.did) { b.did = true; U.uLineA.value.w = 0; b.play("run", { speed: 1.8, fade: 0.08 }); this.sfx.whoosh(200, 1800, 0.8, 0.6); }
          var v = 27 * dt; b.x += fx * v; b.z += fz * v; b.len += v; b.pitch = 0.3; b.sink = 0;
          this.cut(b.x, b.z, 1.7, 0.08); if (Math.random() < 0.8) this.clippings(b.x, b.z, 1.4, 3); this.trauma = Math.max(this.trauma, 0.3);
          this.spark(b.x, b.y + 1.5, b.z, 2, 3, 2.4, 0.4, 0.25, 0.4, 0);
          if (!b.chHit && d < BOSS.radius + 1.05) { b.chHit = true; var side = (dx * fz - dz * fx) > 0 ? 1 : -1; this.hurtHero(26, fz * side * 0.8 + fx * 0.4, -fx * side * 0.8 + fz * 0.4, 17); }
          if (Math.sqrt(b.x * b.x + b.z * b.z) > ARENA_R + 1.5) b.len = LEN;
        } else { if (b.did) { b.did = false; b.t2 = b.t; b.play("idle", { fade: 0.3 }); } b.pitch = 0.5 * Math.max(0, 1 - (b.t - b.t2) / 0.5); if (b.t - b.t2 > (p2 ? 0.9 : 1.4)) this.bossSet("idle"); }
        break;
      }
      case "moonfall": {
        b.yaw = turnTo(b.yaw, aim, 2 * dt); var total = 7;
        while (b.n < total && b.t > 0.55 + b.n * 0.3) {
          var lead = b.n % 2 ? 0.35 : 0, sx = h.x + (Math.random() - 0.5) * 2.4 + (this.heroVx || 0) * lead, sz = h.z + (Math.random() - 0.5) * 2.4 + (this.heroVz || 0) * lead;
          this.strikes.push({ x: sx, z: sz, t: 0, fuse: 0.95, r: 1.9 }); b.n++;
        }
        if (b.t > 1.7) this.bossSet("idle");
        break;
      }
      case "roar": {
        b.sink = 0;
        if (b.t > 0.5 && !b.did) { b.did = true; this.trauma = 1; if (d < 9) { h.kx = dx / d * 15; h.kz = dz / d * 15; h.state = "hurt"; h.t = 0.1; h.inv = Math.max(h.inv, 0.8); } this.cut(b.x, b.z, 5, 0.25); this.spark(b.x, b.y + 2.2, b.z, 80, 12, 2.6, 0.5, 0.4, 1.2, 0); this.ring.on = true; this.ring.r = 1; this.ring.x = b.x; this.ring.z = b.z; this.ring.hit = true; }
        if (b.t > 2.4) { b.did = false; this.bossSet("idle"); b.cd = 0.3; }
        break;
      }
      case "stagger":
        if (!b.has("stagger")) { b.pitch = 0.55; b.sink = 0.7; }
        b.post = 100 * Math.max(0, 1 - b.t / 2.3);
        if (b.t > 2.3) { b.post = 0; this.bossSet("idle"); }
        break;
    }
    var r = Math.sqrt(b.x * b.x + b.z * b.z); if (r > ARENA_R + 0.5 && b.state !== "dead") { b.x *= (ARENA_R + 0.5) / r; b.z *= (ARENA_R + 0.5) / r; }

    // shockwave ring
    var ring = this.ring;
    if (ring.on) {
      ring.r += 10.5 * dt; U.uRing.value.set(ring.x, ring.z, ring.r, clamp(1.25 - ring.r / 14, 0, 1));
      var rx = h.x - ring.x, rz = h.z - ring.z, rd = Math.sqrt(rx * rx + rz * rz) || 1;
      if (!ring.hit && Math.abs(rd - ring.r) < 0.75) { if (this.hurtHero(14, rx / rd, rz / rd, 10)) ring.hit = true; else if (h.inv > 0.3) ring.hit = true; }
      if (ring.r > 15) { ring.on = false; U.uRing.value.w = 0; }
    }
    // moonfall strikes
    for (var i = this.strikes.length - 1; i >= 0; i--) {
      var s = this.strikes[i]; s.t += dt;
      if (s.t >= s.fuse) {
        this.strikes.splice(i, 1);
        var bm = null; for (var j = 0; j < this.beams.length; j++) if (this.beams[j].t >= 1) { bm = this.beams[j]; break; }
        if (bm) { bm.t = 0; bm.mesh.visible = true; bm.mesh.position.set(s.x, hill(s.x, s.z), s.z); }
        this.cut(s.x, s.z, s.r, 0.06); this.spark(s.x, hill(s.x, s.z) + 0.5, s.z, 22, 9, 2.6, 1.2, 1.0, 0.6, 8); this.sfx.tone("sine", 700, 90, 0.35, 0.4); this.trauma = Math.min(1, this.trauma + 0.2);
        var qx = h.x - s.x, qz = h.z - s.z, qd = Math.sqrt(qx * qx + qz * qz) || 1; if (qd < s.r) this.hurtHero(16, qx / qd, qz / qd, 8);
      }
    }
    for (i = 0; i < 7; i++) { var c = U.uCirc.value[i + 1], st = this.strikes[i]; if (st) c.set(st.x, st.z, st.r, 0.35 + 0.65 * st.t / st.fuse); else c.w = 0; }
  };

  // --- frame ---------------------------------------------------------------
  Game.prototype.frame = function (now) {
    var rdt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.paused) return;
    this.step(rdt); this.render(rdt);
  };
  Game.prototype.step = function (rdt) {
    var h = this.hero, b = this.boss, U = this.U;
    var ts = 1; if (this.slow > 0) { this.slow -= rdt; ts = 0.28; } if (this.hitstop > 0) { this.hitstop -= rdt; ts = 0.02; }
    var dt = rdt * ts; this.time += dt; this.rt = (this.rt || 0) + rdt;

    if (this.phase === "intro") {
      this.introT += rdt;
      if (this.introT > 1.2 && b.state === "wait" && !this.roared) { this.roared = true; b.play("roar", { once: true, dur: 2.2 }); this.sfx.roar(); this.trauma = 0.7; this.cut(b.x, b.z, 4, 0.3); this.ring.on = true; this.ring.r = 1; this.ring.x = b.x; this.ring.z = b.z; this.ring.hit = true; }
      if (this.introT > 3.8) { this.phase = "fight"; this.roared = false; this.bossSet("idle"); this.bars.classList.remove("on"); this.bossHud.classList.add("on"); this.plHud.classList.add("on"); }
    }
    var px = h.x, pz = h.z;
    this.updHero(dt); this.updBoss(dt);
    if (dt > 0) { this.heroVx = (h.x - px) / dt; this.heroVz = (h.z - pz) / dt; }
    h.update(dt); b.update(dt);

    // weapons follow the hands
    var hp = _v1.clone(), hd = _v2.clone();
    h.handPose(hp, hd); var fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    hd.multiplyScalar(0.75).add(new THREE.Vector3(fx * 0.55, 0.22, fz * 0.55)).normalize();
    this.blade.position.copy(hp); this.blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hd);
    var glow = h.emp > 0 ? 1 : 0; this.bladeMat.color.setRGB(1.5 + glow * 1.6, 2.0 + glow * 0.6, 2.6 - glow * 1.2);
    this.bladeLight.position.set(h.x + fx * 0.6, h.y + 1.5, h.z + fz * 0.6); this.bladeLight.intensity = 5 + glow * 8; this.bladeLight.color.setRGB(0.6 + glow * 0.4, 0.83, 1 - glow * 0.4);
    this.blade.visible = h.state !== "dead" || !h.fall;
    b.handPose(hp, hd); fx = Math.sin(b.yaw); fz = Math.cos(b.yaw);
    hd.multiplyScalar(0.5).add(new THREE.Vector3(fx * 0.3, 0.85, fz * 0.3)).normalize();
    this.scythe.position.copy(hp); this.scythe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hd);
    this.scythe.rotateY(b.yaw); this.scythe.scale.setScalar(BOSS.height / 3.7);
    this.eyeLight.position.set(b.x + fx * 0.8, b.y + b.air + BOSS.height * 0.8, b.z + fz * 0.8); this.eyeLight.intensity = b.state === "dead" ? Math.max(0, 6 - b.t * 4) : 6 + this.rage * 8;
    this.scythe.visible = !(b.state === "dead" && b.t > 1.2);
    if (b.head) { b.head.getWorldPosition(hp); b.head.getWorldQuaternion(this.antlers.quaternion); hp.y += 0.0; this.antlers.position.copy(hp); this.antlers.translateY(BOSS.height * 0.085); }
    else { this.antlers.position.set(b.x, b.y + b.air + BOSS.height * 0.95, b.z); this.antlers.rotation.set(0, b.yaw, 0); }
    this.antlers.scale.setScalar(BOSS.height / 3.7);

    // world mood
    this.rage = lerp(this.rage, this.rageT, 1 - Math.exp(-1.2 * rdt)); this.wind = lerp(this.wind, this.windT, 1 - Math.exp(-0.9 * rdt));
    U.uTime.value += dt * (0.6 + 0.4 * this.wind); U.uWind.value = this.wind; U.uRage.value = this.rage;
    this.skyMat.uniforms.uRage.value = this.rage; this.skyMat.uniforms.uTime.value = this.rt;
    this.moonMat.color.setRGB(1.5 + this.rage * 0.7, 1.65 - this.rage * 0.85, 1.95 - this.rage * 1.2);
    this.moonLight.color.setRGB(0.62 + this.rage * 0.38, 0.74 - this.rage * 0.3, 1 - this.rage * 0.5);
    this.flyMat.uniforms.uTime.value = this.rt; this.flyMat.uniforms.uWind.value = this.wind;
    this.sfx.wind(this.wind, this.rt);
    // grass interaction
    var P = U.uPush.value; P[0].set(h.x, h.z, 1.7, 0.85); P[1].set(b.x, b.z, b.air > 0.5 ? 0.1 : 3.0, 1.0);
    if (this.fxPush) { var f = this.fxPush; f.t += dt; var a = Math.max(0, 1 - f.t / 0.45); P[2].set(f.x, f.z, f.r, f.s * a); if (a <= 0) this.fxPush = null; } else P[2].w = 0;
    this.regrow(dt); this.stepSparks(dt);
    for (var i = 0; i < this.arcs.length; i++) { var A = this.arcs[i]; if (A.t < 1) { A.t += dt / A.dur; A.mesh.material.uniforms.uT.value = A.t; if (A.t >= 1) A.mesh.visible = false; } }
    for (i = 0; i < this.beams.length; i++) { var B = this.beams[i]; if (B.t < 1) { B.t += dt / 0.45; var w = 1.9 * (1 - B.t) * (B.t < 0.15 ? B.t / 0.15 : 1); B.mesh.scale.set(w + 0.02, 1, w + 0.02); B.mesh.material.opacity = 1 - B.t; if (B.t >= 1) B.mesh.visible = false; } }

    // skill button
    var cdf = clamp(h.dashCd / HERO.dashCd, 0, 1); this.el.skl.style.setProperty("--cd", (cdf * 360) + "deg"); this.el.skl.classList.toggle("ready", cdf <= 0);
    this.updHud();
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - rdt * 1.7);
  };

  Game.prototype.render = function (rdt) {
    var h = this.hero, b = this.boss, cam = this.camera;
    // camera: fixed heading, frames both fighters, low enough to see the moon
    var w = this.phase === "title" ? 0.5 : 0.36, fx = lerp(h.x, b.x, w), fz = lerp(h.z, b.z, w);
    var sep = Math.sqrt((h.x - b.x) * (h.x - b.x) + (h.z - b.z) * (h.z - b.z));
    var dist = (this.portrait ? 11.5 : 8.2) + sep * (this.portrait ? 0.7 : 0.5);
    if (this.phase === "title") dist += 5;
    if (this.phase === "intro") { var u = clamp(this.introT / 3.6, 0, 1); fx = lerp(b.x, fx, u * u); fz = lerp(b.z, fz, u * u); dist = lerp(8.5, dist, u * u); }
    var pitch = this.portrait ? 0.5 : 0.4;
    var tx = fx, ty = hill(fx, fz) + Math.sin(pitch) * dist, tz = fz + Math.cos(pitch) * dist;
    var k = 1 - Math.exp(-(this.snapCam ? 999 : 3.2) * rdt);
    this.camPos.x = lerp(this.camPos.x, tx, k); this.camPos.y = lerp(this.camPos.y, ty, k); this.camPos.z = lerp(this.camPos.z, tz, k);
    this.camLook.x = lerp(this.camLook.x, fx, k); this.camLook.y = lerp(this.camLook.y, hill(fx, fz) + 2.0 + dist * (this.portrait ? 0.16 : 0.115), k); this.camLook.z = lerp(this.camLook.z, fz, k);
    var sh = this.trauma * this.trauma * 0.55, t = this.rt * 60;
    cam.position.set(this.camPos.x + Math.sin(t * 1.3) * sh, this.camPos.y + Math.sin(t * 1.7 + 2) * sh, this.camPos.z + Math.sin(t * 1.1 + 4) * sh * 0.5);
    cam.lookAt(this.camLook);
    this.moon.position.copy(cam.position).addScaledVector(this.moonDir, 180); this.moon.lookAt(cam.position);
    var px = this.h * this.pr / 900; this.flyMat.uniforms.uPx.value = px * 5; this.sparks.material.uniforms.uPx.value = px * 3.6;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, cam);
  };

  Game.prototype.fatal = function (msg) {
    this.paused = true; this.el.card.innerHTML = '<h1 style="font-size:28px">HOLLOW MOON</h1><p>' + msg + '</p><div><button data-act="menu">MENU</button></div>'; this.el.card.classList.remove("off");
  };
  Game.prototype.destroy = function () {
    this.dead = true; cancelAnimationFrame(this.raf); window.removeEventListener("resize", this.onResize);
    (this.listeners || []).forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
    try { this.renderer.dispose(); this.renderer.forceContextLoss(); } catch (e) {}
  };

  // ------------------------------------------------------------- loading / launch
  function loadLibs() {
    if (THREE) return Promise.resolve();
    return import(resolve("../vendor/three.module.min.js")).then(function (m) {
      THREE = m;
      return Promise.all([
        import(resolve("../vendor/jsm/loaders/GLTFLoader.js")).then(function (m) { GLTFLoader = m.GLTFLoader; }).catch(function () {}),
        Promise.all(["EffectComposer", "RenderPass", "UnrealBloomPass", "OutputPass"].map(function (n) { return import(resolve("../vendor/jsm/postprocessing/" + n + ".js")); }))
          .then(function (ms) { PP = { EffectComposer: ms[0].EffectComposer, RenderPass: ms[1].RenderPass, UnrealBloomPass: ms[2].UnrealBloomPass, OutputPass: ms[3].OutputPass }; }).catch(function () { PP = null; })
      ]);
    });
  }
  function loadArt() {
    if (!GLTFLoader || PARAMS.get("art") === "0") return Promise.resolve();
    var loader = new GLTFLoader();
    function get(url) { return new Promise(function (res) { loader.load(url, res, undefined, function () { res(null); }); }); }
    function one(kind) {
      if (ART[kind]) return Promise.resolve();
      return get(resolve("hollow-moon/" + kind + ".glb")).then(function (g) {
        if (!g) return;
        var art = { scene: g.scene, clips: {} };
        return Promise.all(CLIPS[kind].map(function (n) {
          return get(resolve("hollow-moon/" + kind + "-" + n + ".glb")).then(function (a) {
            if (!a || !a.animations.length) return;
            var c = a.animations[0]; c.tracks = c.tracks.filter(function (t) { return /\.quaternion$/.test(t.name); }); art.clips[n] = c;
          });
        })).then(function () { ART[kind] = art; });
      });
    }
    return Promise.all([one("hero"), one("foe")]);
  }

  window.launchHollowMoon = function () {
    if (window.hollowMoonGame) return;
    var container = document.getElementById("game-container") || document.body;
    if (!document.getElementById("hm-style")) { var st = document.createElement("style"); st.id = "hm-style"; st.textContent = CSS; document.head.appendChild(st); }
    var root = document.createElement("div"); root.id = "hm-root"; root.innerHTML = HUD_HTML; container.appendChild(root);
    var sfx = new Sfx(), handle = { game: null, cancelled: false };
    handle.destroy = function () { handle.cancelled = true; if (handle.game) handle.game.destroy(); sfx.close(); if (root.parentNode) root.parentNode.removeChild(root); };
    window.hollowMoonGame = handle;
    root.querySelector('[data-hm="menu"]').addEventListener("click", function () { if (!handle.game && typeof window.returnToMenu === "function") window.returnToMenu(); });
    loadLibs().then(loadArt).then(function () {
      if (handle.cancelled) return;
      handle.game = new Game(root, sfx);
    }).catch(function (err) {
      if (handle.cancelled) return;
      var c = root.querySelector('[data-hm="card"]'); c.innerHTML = '<h1 style="font-size:28px">HOLLOW MOON</h1><p>' + ((err && err.message) || "Could not start.") + "</p>";
    });
  };
})();
