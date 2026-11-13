// Paper Airplane — a "Kinda Hard Golf"-style flick game.
// Loaded as a classic script: uses the global `Phaser` (vendored), no bundler.

class PaperAirplaneScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PaperAirplaneScene' });
  }

  create() {
    // --- CONFIGURATION & STATE ---
    this.levelIndex = 0;
    this.strokes = 0;
    this.isDragging = false;
    this.dragStart = new Phaser.Math.Vector2();
    this.dragCurrent = new Phaser.Math.Vector2();
    this.ghostTrails = []; // Stores past flight paths
    this.currentTrail = [];
    this.trailTimer = 0;

    // Aerodynamic constants (tuned for tactile "Kinda Hard Golf" feel)
    this.GRAVITY = 480;
    this.LIFT_COEFF = 0.0019;
    this.DRAG = 0.993;
    this.MAX_PULL = 180;
    this.LAUNCH_POWER = 5.4;

    // Plane kinematic state
    this.planeState = 'IDLE'; // 'IDLE' | 'FLYING' | 'WIN'
    this.pos = new Phaser.Math.Vector2();
    this.vel = new Phaser.Math.Vector2();
    this.angle = 0;
    this.safePos = new Phaser.Math.Vector2();

    // Graphics layers
    this.bgGraphics = this.add.graphics();
    this.trailGraphics = this.add.graphics();
    this.envGraphics = this.add.graphics();
    this.uiGraphics = this.add.graphics();
    this.planeGraphics = this.add.graphics();

    // HUD Text
    this.hudText = this.add.text(20, 18, '', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#2c3e50',
      fontStyle: 'bold'
    });

    this.hintText = this.add.text(
      20,
      42,
      'Drag anywhere to pull & launch • Click while flying to reset early',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#607d8b'
      }
    );

    // Level Definitions (800x600 reference space)
    this.levels = [
      {
        name: '1. The Cubicle Hop',
        start: { x: 110, y: 470 },
        goal: { x: 680, y: 460, w: 64, h: 52 },
        solids: [
          { x: 0, y: 520, w: 800, h: 80, type: 'desk' }, // Floor desk
          { x: 360, y: 310, w: 24, h: 210, type: 'cork' }, // Cubicle divider
          { x: 520, y: 210, w: 180, h: 18, type: 'glass' } // Overhead shelf
        ],
        fans: [],
        hazards: [{ x: 240, y: 496, w: 34, h: 24, label: 'COFFEE' }]
      },
      {
        name: '2. Updraft Atrium',
        start: { x: 90, y: 500 },
        goal: { x: 690, y: 150, w: 64, h: 52 },
        solids: [
          { x: 0, y: 540, w: 800, h: 60, type: 'desk' },
          { x: 580, y: 202, w: 220, h: 22, type: 'desk' }, // High ledge
          { x: 260, y: 0, w: 24, h: 310, type: 'cork' }, // Hanging partition
          { x: 430, y: 280, w: 24, h: 260, type: 'glass' } // Glass barrier
        ],
        fans: [
          // Floor vent updraft
          { x: 310, y: 160, w: 95, h: 380, forceX: 0, forceY: -760 }
        ],
        hazards: [{ x: 480, y: 516, w: 70, h: 24, label: 'SPILL' }]
      },
      {
        name: '3. Corner Office Bank Shot',
        start: { x: 100, y: 180 },
        goal: { x: 110, y: 470, w: 64, h: 52 },
        solids: [
          { x: 0, y: 522, w: 800, h: 78, type: 'desk' },
          { x: 0, y: 230, w: 510, h: 24, type: 'desk' }, // Mezzanine floor
          { x: 750, y: 60, w: 22, h: 462, type: 'glass' }, // Bouncy glass back wall
          { x: 260, y: 400, w: 24, h: 122, type: 'cork' } // Guard wall before bin
        ],
        fans: [
          // AC crosswind pushing left
          { x: 530, y: 260, w: 190, h: 90, forceX: -480, forceY: 0 }
        ],
        hazards: [{ x: 340, y: 206, w: 45, h: 24, label: 'COFFEE' }]
      }
    ];

    // Input handlers (Zero-delay pull-back even mid-flight)
    this.input.on('pointerdown', (pointer) => {
      if (this.planeState === 'WIN') return;
      if (this.planeState === 'FLYING') {
        this.resetToSafeSpot();
      }
      this.isDragging = true;
      this.dragStart.set(pointer.x, pointer.y);
      this.dragCurrent.set(pointer.x, pointer.y);
    });

    this.input.on('pointermove', (pointer) => {
      if (this.isDragging) {
        this.dragCurrent.set(pointer.x, pointer.y);
      }
    });

    this.input.on('pointerup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;

      const pull = this.dragStart.clone().subtract(this.dragCurrent);
      if (pull.length() < 14) return; // Ignore accidental taps

      pull.limit(this.MAX_PULL);
      this.launchPlane(pull);
    });

    this.loadLevel(0);
  }

  loadLevel(idx) {
    this.levelIndex = idx % this.levels.length;
    const lvl = this.levels[this.levelIndex];
    this.strokes = 0;
    this.ghostTrails = [];
    this.currentTrail = [];
    this.safePos.set(lvl.start.x, lvl.start.y);
    this.resetToSafeSpot();
    this.drawStaticEnvironment();
    this.updateHUD();
  }

  resetToSafeSpot() {
    if (this.currentTrail.length > 2) {
      this.ghostTrails.push([...this.currentTrail]);
      if (this.ghostTrails.length > 6) this.ghostTrails.shift();
    }
    this.currentTrail = [];
    this.pos.copy(this.safePos);
    this.vel.set(0, 0);
    this.angle = -0.15;
    this.planeState = 'IDLE';
    this.drawGhostTrails();
  }

  launchPlane(pullVector) {
    this.strokes++;
    this.updateHUD();
    this.planeState = 'FLYING';
    this.vel.copy(pullVector).scale(this.LAUNCH_POWER);
    this.angle = this.vel.angle();
    this.currentTrail = [{ x: this.pos.x, y: this.pos.y }];
    this.playSound('whoosh', 260 + pullVector.length() * 1.8);
  }

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.033);
    const lvl = this.levels[this.levelIndex];

    if (this.planeState === 'FLYING') {
      // 1. Gravity & Air Drag
      this.vel.y += this.GRAVITY * dt;
      this.vel.scale(Math.pow(this.DRAG, dt * 60));

      // 2. Environmental Wind / Fan Zones
      for (const fan of lvl.fans) {
        if (this.pointInRect(this.pos.x, this.pos.y, fan)) {
          this.vel.x += fan.forceX * dt;
          this.vel.y += fan.forceY * dt;
        }
      }

      // 3. Aerodynamic Wing Lift (perpendicular to nose, scales with forward speed)
      const forward = new Phaser.Math.Vector2(Math.cos(this.angle), Math.sin(this.angle));
      const forwardSpeed = Math.max(0, this.vel.dot(forward));
      const upWing = new Phaser.Math.Vector2(-Math.sin(this.angle), Math.cos(this.angle));
      // Ensure lift opposes gravity regardless of left/right orientation
      if (upWing.y > 0) upWing.negate();

      const liftMag = forwardSpeed * forwardSpeed * this.LIFT_COEFF;
      this.vel.add(upWing.scale(liftMag * dt));

      // 4. Weathervane Nose Alignment (stalls downward if too slow)
      if (this.vel.length() > 25) {
        const targetAngle = this.vel.angle();
        this.angle = Phaser.Math.Angle.RotateTo(this.angle, targetAngle, 3.8 * dt);
      }

      // 5. Sub-stepped movement & collision
      const steps = 3;
      const subDt = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.pos.x += this.vel.x * subDt;
        this.pos.y += this.vel.y * subDt;

        // Screen bounds
        if (this.pos.x < 10 || this.pos.x > 790 || this.pos.y > 610) {
          this.playSound('crumple', 120);
          this.resetToSafeSpot();
          break;
        }

        // Check Hazards (Coffee spills soak the plane)
        for (const haz of lvl.hazards) {
          if (this.pointInRect(this.pos.x, this.pos.y, haz)) {
            this.playSound('splash', 160);
            this.resetToSafeSpot();
            break;
          }
        }
        if (this.planeState !== 'FLYING') break;

        // Check Goal (Inbox / Trash Bin)
        if (this.pointInRect(this.pos.x, this.pos.y, lvl.goal)) {
          this.handleWin();
          break;
        }

        // Check Solid Surfaces
        for (const wall of lvl.solids) {
          if (this.resolveWallCollision(wall)) break;
        }
        if (this.planeState !== 'FLYING') break;
      }

      // Record breadcrumb trail
      this.trailTimer += dt;
      if (this.trailTimer >= 0.04) {
        this.trailTimer = 0;
        this.currentTrail.push({ x: this.pos.x, y: this.pos.y });
      }
    }

    this.drawDynamicFrame(time);
  }

  resolveWallCollision(rect) {
    const pad = 8;
    if (
      this.pos.x + pad < rect.x ||
      this.pos.x - pad > rect.x + rect.w ||
      this.pos.y + pad < rect.y ||
      this.pos.y - pad > rect.y + rect.h
    ) {
      return false;
    }

    // Determine shallowest penetration axis
    const overlapLeft = this.pos.x + pad - rect.x;
    const overlapRight = rect.x + rect.w - (this.pos.x - pad);
    const overlapTop = this.pos.y + pad - rect.y;
    const overlapBottom = rect.y + rect.h - (this.pos.y - pad);
    const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

    // Corkboard = nose sticks immediately on impact
    if (rect.type === 'cork') {
      if (minOverlap === overlapLeft) this.pos.x = rect.x - pad - 2;
      else if (minOverlap === overlapRight) this.pos.x = rect.x + rect.w + pad + 2;
      else if (minOverlap === overlapTop) this.pos.y = rect.y - pad - 2;
      else this.pos.y = rect.y + rect.h + pad + 2;

      this.safePos.copy(this.pos);
      this.playSound('thud', 140);
      this.resetToSafeSpot();
      return true;
    }

    // Glass = high restitution deflection; Desk = medium slide/settle
    const bounce = rect.type === 'glass' ? 0.78 : 0.35;
    const friction = rect.type === 'glass' ? 0.94 : 0.72;

    if (minOverlap === overlapTop) {
      this.pos.y = rect.y - pad;
      this.vel.y = -Math.abs(this.vel.y) * bounce;
      this.vel.x *= friction;
      this.playSound(
        rect.type === 'glass' ? 'ting' : 'thud',
        rect.type === 'glass' ? 680 : 180
      );

      // Come to rest on top of a desk
      if (this.vel.length() < 55) {
        this.safePos.set(this.pos.x, rect.y - 10);
        this.resetToSafeSpot();
        return true;
      }
    } else if (minOverlap === overlapBottom) {
      this.pos.y = rect.y + rect.h + pad;
      this.vel.y = Math.abs(this.vel.y) * bounce;
      this.playSound('ting', 540);
    } else if (minOverlap === overlapLeft) {
      this.pos.x = rect.x - pad;
      this.vel.x = -Math.abs(this.vel.x) * bounce;
      this.playSound('ting', 600);
    } else if (minOverlap === overlapRight) {
      this.pos.x = rect.x + rect.w + pad;
      this.vel.x = Math.abs(this.vel.x) * bounce;
      this.playSound('ting', 600);
    }

    this.angle = this.vel.angle();
    return true;
  }

  handleWin() {
    this.planeState = 'WIN';
    this.vel.set(0, 0);
    this.playSound('win', 520);
    this.hudText.setText(
      `${this.levels[this.levelIndex].name} — Sunk in ${this.strokes} throws!`
    );
    this.time.delayedCall(1400, () => {
      this.loadLevel(this.levelIndex + 1);
    });
  }

  // --- PROCEDURAL RENDERING ---
  drawStaticEnvironment() {
    const lvl = this.levels[this.levelIndex];
    this.bgGraphics.clear();
    this.envGraphics.clear();

    // Subtle notebook / blueprint grid background
    this.bgGraphics.fillStyle(0xf6f7f2, 1);
    this.bgGraphics.fillRect(0, 0, 800, 600);
    this.bgGraphics.lineStyle(1, 0xe4e8df, 1);
    for (let x = 0; x < 800; x += 32) this.bgGraphics.lineBetween(x, 0, x, 600);
    for (let y = 0; y < 600; y += 32) this.bgGraphics.lineBetween(0, y, 800, y);

    // Solids
    for (const s of lvl.solids) {
      if (s.type === 'desk') {
        this.envGraphics.fillStyle(0x8d6e63, 1);
        this.envGraphics.fillRect(s.x, s.y, s.w, s.h);
        this.envGraphics.fillStyle(0xa1887f, 1);
        this.envGraphics.fillRect(s.x, s.y, s.w, 6);
      } else if (s.type === 'cork') {
        this.envGraphics.fillStyle(0xd4a373, 1);
        this.envGraphics.fillRect(s.x, s.y, s.w, s.h);
        this.envGraphics.lineStyle(2, 0xbc6c25, 1);
        this.envGraphics.strokeRect(s.x, s.y, s.w, s.h);
      } else if (s.type === 'glass') {
        this.envGraphics.fillStyle(0x90e0ef, 0.45);
        this.envGraphics.fillRect(s.x, s.y, s.w, s.h);
        this.envGraphics.lineStyle(2, 0x00b4d8, 0.9);
        this.envGraphics.strokeRect(s.x, s.y, s.w, s.h);
      }
    }

    // Hazards (Coffee spills)
    for (const h of lvl.hazards) {
      this.envGraphics.fillStyle(0x4a2c2a, 1);
      this.envGraphics.fillRoundedRect(h.x, h.y, h.w, h.h, 6);
    }

    // Goal (Wire Mesh Inbox / Bin)
    const g = lvl.goal;
    this.envGraphics.fillStyle(0x2b2d42, 0.15);
    this.envGraphics.fillRect(g.x, g.y, g.w, g.h);
    this.envGraphics.lineStyle(3, 0x2b2d42, 1);
    this.envGraphics.beginPath();
    this.envGraphics.moveTo(g.x, g.y);
    this.envGraphics.lineTo(g.x + 6, g.y + g.h);
    this.envGraphics.lineTo(g.x + g.w - 6, g.y + g.h);
    this.envGraphics.lineTo(g.x + g.w, g.y);
    this.envGraphics.strokePath();
  }

  drawGhostTrails() {
    this.trailGraphics.clear();
    this.ghostTrails.forEach((trail, idx) => {
      const alpha = 0.12 + (idx / this.ghostTrails.length) * 0.18;
      this.trailGraphics.lineStyle(2, 0x7f8c8d, alpha);
      this.trailGraphics.beginPath();
      trail.forEach((pt, i) => {
        if (i === 0) this.trailGraphics.moveTo(pt.x, pt.y);
        else this.trailGraphics.lineTo(pt.x, pt.y);
      });
      this.trailGraphics.strokePath();
    });
  }

  drawDynamicFrame(time) {
    const lvl = this.levels[this.levelIndex];
    this.uiGraphics.clear();
    this.planeGraphics.clear();

    // Animated Wind Lines for Fans
    this.uiGraphics.lineStyle(1.5, 0x48cae4, 0.5);
    for (const fan of lvl.fans) {
      const offset = (time * 0.12) % 30;
      if (fan.forceY < 0) {
        for (let x = fan.x + 15; x < fan.x + fan.w; x += 25) {
          for (let y = fan.y + fan.h - offset; y > fan.y; y -= 30) {
            this.uiGraphics.lineBetween(x, y, x, Math.max(fan.y, y - 14));
          }
        }
      } else {
        for (let y = fan.y + 15; y < fan.y + fan.h; y += 22) {
          for (let x = fan.x + fan.w - offset; x > fan.x; x -= 30) {
            this.uiGraphics.lineBetween(x, y, Math.max(fan.x, x - 14), y);
          }
        }
      }
    }

    // Active flight trail
    if (this.currentTrail.length > 1) {
      this.uiGraphics.lineStyle(2, 0x3498db, 0.45);
      this.uiGraphics.beginPath();
      this.currentTrail.forEach((pt, i) => {
        if (i === 0) this.uiGraphics.moveTo(pt.x, pt.y);
        else this.uiGraphics.lineTo(pt.x, pt.y);
      });
      this.uiGraphics.strokePath();
    }

    // Tactile Rubber-Band Slingshot Pull Indicator (Short, no full trajectory)
    if (this.isDragging) {
      const pull = this.dragStart.clone().subtract(this.dragCurrent).limit(this.MAX_PULL);
      const ratio = pull.length() / this.MAX_PULL;
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        new Phaser.Display.Color(46, 204, 113),
        new Phaser.Display.Color(231, 76, 60),
        100,
        Math.floor(ratio * 100)
      );
      const hex = Phaser.Display.Color.GetColor(color.r, color.g, color.b);

      // Pull-back anchor line
      this.uiGraphics.lineStyle(3, hex, 0.85);
      this.uiGraphics.lineBetween(
        this.pos.x,
        this.pos.y,
        this.pos.x - pull.x * 0.55,
        this.pos.y - pull.y * 0.55
      );

      // Short directional stub in front of nose
      const aimTip = pull.clone().normalize().scale(36 + ratio * 28);
      this.uiGraphics.lineStyle(2, 0x2c3e50, 0.6);
      this.uiGraphics.lineBetween(
        this.pos.x,
        this.pos.y,
        this.pos.x + aimTip.x,
        this.pos.y + aimTip.y
      );

      this.angle = pull.angle();
    }

    // Draw Origami Paper Airplane
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const rot = (lx, ly) => ({
      x: this.pos.x + lx * cos - ly * sin,
      y: this.pos.y + lx * sin + ly * cos
    });

    const nose = rot(16, 0);
    const topWing = rot(-12, -9);
    const foldCrease = rot(-8, 0);
    const bottomKeel = rot(-11, 6);

    // Upper wing
    this.planeGraphics.fillStyle(0xffffff, 1);
    this.planeGraphics.lineStyle(1.5, 0x2c3e50, 1);
    this.planeGraphics.beginPath();
    this.planeGraphics.moveTo(nose.x, nose.y);
    this.planeGraphics.lineTo(topWing.x, topWing.y);
    this.planeGraphics.lineTo(foldCrease.x, foldCrease.y);
    this.planeGraphics.closePath();
    this.planeGraphics.fillPath();
    this.planeGraphics.strokePath();

    // Shaded under-fold
    this.planeGraphics.fillStyle(0xdce1e5, 1);
    this.planeGraphics.beginPath();
    this.planeGraphics.moveTo(nose.x, nose.y);
    this.planeGraphics.lineTo(foldCrease.x, foldCrease.y);
    this.planeGraphics.lineTo(bottomKeel.x, bottomKeel.y);
    this.planeGraphics.closePath();
    this.planeGraphics.fillPath();
    this.planeGraphics.strokePath();
  }

  updateHUD() {
    const lvl = this.levels[this.levelIndex];
    this.hudText.setText(`${lvl.name}    |   Throws: ${this.strokes}`);
  }

  pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  // Zero-dependency Web Audio synth for crisp tactile feedback
  playSound(type, freq = 300) {
    const ctx = this.sound.context;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    if (type === 'whoosh') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq * 0.6, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + 0.14);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    } else if (type === 'ting') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    } else if (type === 'thud' || type === 'crumple' || type === 'splash') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    } else if (type === 'win') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.1);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    }

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  }
}

// --- BOOT ---
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#f6f7f2',
  width: 800,
  height: 600,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [PaperAirplaneScene]
});
