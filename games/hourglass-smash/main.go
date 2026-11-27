// Hourglass Smash: drag back, let go, and fling a heavy cube at a stack of
// cubes built in the shape of an hourglass. The neck is the keystone: knock it
// out and the whole top half comes down on the bottom half.
//
// Physics lives in ./sim (pure Go, unit-tested); this file is input, drawing
// and effects on top of Ebitengine.
package main

import (
	"bytes"
	"fmt"
	"image/color"
	"math"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/inpututil"
	"github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"github.com/jakecoffman/cp/v2"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"

	"fantasia/hourglass-smash/sim"
)

const bgScale = 2

var (
	fontReg, fontBold *text.GoTextFaceSource
	cubeSprite        *ebiten.Image
	backdrop          *ebiten.Image
)

// Buttons, in world units.
type rectF struct{ x, y, w, h float64 }

func (r rectF) has(p cp.Vector) bool {
	return p.X >= r.x && p.X <= r.x+r.w && p.Y >= r.y && p.Y <= r.y+r.h
}

var (
	btnMenu  = rectF{14, 14, 88, 40}
	btnReset = rectF{sim.W - 14 - 88, 14, 88, 40}
	btnAgain = rectF{sim.W/2 - 115, 548, 230, 58}
)

type particle struct {
	x, y, vx, vy float64
	life, max    float64
	size         float64
	r, g, b      float64
	spark        bool
}

// pointer tracks the one finger or mouse button currently driving the game.
type pointer struct {
	active  bool
	isTouch bool
	id      ebiten.TouchID
	pos     cp.Vector // world units
}

type Game struct {
	w *sim.World

	// view transform, refreshed by LayoutF
	vs, vox, voy float64

	p       pointer
	aiming  bool
	anchor  cp.Vector
	cur     cp.Vector
	idbuf   []ebiten.TouchID
	parts   []particle
	shake   float64
	tick    int
	over    bool
	newBest bool
	best    int
	dispTop float64 // eased "toppled" number for the HUD
}

func newGame() *Game {
	g := &Game{w: sim.NewWorld(), vs: 1}
	g.best = loadBest()
	return g
}

func (g *Game) reset() {
	g.w = sim.NewWorld()
	g.aiming = false
	g.parts = g.parts[:0]
	g.shake = 0
	g.over = false
	g.newBest = false
	g.dispTop = 0
}

// ---------------------------------------------------------------- input

func (g *Game) toWorld(px, py int) cp.Vector {
	return cp.Vector{X: (float64(px) - g.vox) / g.vs, Y: (float64(py) - g.voy) / g.vs}
}

// poll reads the mouse/touch state once per tick.
func (g *Game) poll() (pressed, released bool) {
	if !g.p.active {
		g.idbuf = inpututil.AppendJustPressedTouchIDs(g.idbuf[:0])
		if len(g.idbuf) > 0 {
			id := g.idbuf[0]
			x, y := ebiten.TouchPosition(id)
			g.p = pointer{active: true, isTouch: true, id: id, pos: g.toWorld(x, y)}
			return true, false
		}
		if inpututil.IsMouseButtonJustPressed(ebiten.MouseButtonLeft) {
			x, y := ebiten.CursorPosition()
			g.p = pointer{active: true, pos: g.toWorld(x, y)}
			return true, false
		}
		return false, false
	}
	if g.p.isTouch {
		if inpututil.IsTouchJustReleased(g.p.id) {
			g.p.active = false
			return false, true
		}
		x, y := ebiten.TouchPosition(g.p.id)
		g.p.pos = g.toWorld(x, y)
		return false, false
	}
	if inpututil.IsMouseButtonJustReleased(ebiten.MouseButtonLeft) {
		g.p.active = false
		return false, true
	}
	x, y := ebiten.CursorPosition()
	g.p.pos = g.toWorld(x, y)
	return false, false
}

func (g *Game) Update() error {
	g.tick++
	pressed, released := g.poll()

	if pressed {
		switch {
		case btnMenu.has(g.p.pos):
			hostMenu()
		case btnReset.has(g.p.pos):
			g.reset()
		case g.over:
			if btnAgain.has(g.p.pos) {
				g.reset()
			}
		case g.w.ShotsLeft > 0:
			g.aiming = true
			g.anchor = g.p.pos
			g.cur = g.p.pos
		}
	} else if g.aiming {
		g.cur = g.p.pos
	}
	if released && g.aiming {
		g.aiming = false
		if v, ok := sim.VelocityFor(g.cur.Sub(g.anchor)); ok {
			g.launch(v)
		}
	}

	g.w.Step()
	for _, im := range g.w.DrainImpacts() {
		g.spawnImpact(im)
	}
	g.stepParticles()
	g.shake *= 0.9
	if t := float64(g.w.Toppled()); g.dispTop < t {
		g.dispTop = math.Min(t, g.dispTop+math.Max(0.5, (t-g.dispTop)*0.2))
	} else {
		g.dispTop = t
	}

	if !g.over && g.w.Over() {
		g.over = true
		if n := g.w.Toppled(); n > g.best {
			g.best, g.newBest = n, true
			saveBest(n)
		}
	}
	return nil
}

func (g *Game) launch(v cp.Vector) bool {
	if !g.w.Launch(v) {
		return false
	}
	g.shake += 0.3
	p := sim.LaunchPos()
	for i := 0; i < 8; i++ {
		a := -0.6 + 1.2*float64(i)/7
		sp := 80 + 120*float64(i%3)/2
		g.parts = append(g.parts, particle{x: p.X + 14, y: p.Y + 10, vx: math.Cos(a) * sp * math.Copysign(1, v.X), vy: math.Sin(a) * sp * 0.6,
			life: 0.4, max: 0.4, size: 6, r: 255, g: 230, b: 190})
	}
	return true
}

// ---------------------------------------------------------------- effects

func (g *Game) spawnImpact(im sim.Impact) {
	if im.Snap {
		for i := 0; i < 6; i++ {
			a := float64(i)*math.Pi/3 + float64(g.tick)
			g.parts = append(g.parts, particle{x: im.X, y: im.Y, vx: math.Cos(a) * 190, vy: math.Sin(a) * 190,
				life: 0.3, max: 0.3, size: 3.5, r: 255, g: 240, b: 170, spark: true})
		}
		return
	}
	n := int(clamp(im.Power/160, 1, 7))
	for i := 0; i < n; i++ {
		a := float64(g.tick*7+i*53) * 0.37
		sp := 40 + 110*math.Abs(math.Sin(a*1.7))
		g.parts = append(g.parts, particle{x: im.X, y: im.Y, vx: math.Cos(a) * sp, vy: math.Sin(a)*sp - 50,
			life: 0.55, max: 0.55, size: 5 + 5*math.Abs(math.Sin(a*2.3)), r: 232, g: 205, b: 170})
	}
	if im.Shot && im.Power > 700 {
		g.shake = math.Min(1, g.shake+im.Power/6000)
	}
	if len(g.parts) > 600 {
		g.parts = g.parts[len(g.parts)-600:]
	}
}

func (g *Game) stepParticles() {
	k := 0
	for _, p := range g.parts {
		p.life -= sim.Dt
		if p.life <= 0 {
			continue
		}
		p.x += p.vx * sim.Dt
		p.y += p.vy * sim.Dt
		if !p.spark {
			p.vy += 160 * sim.Dt
			p.vx *= 0.97
		}
		g.parts[k] = p
		k++
	}
	g.parts = g.parts[:k]
}

// ---------------------------------------------------------------- drawing

func (g *Game) LayoutF(ow, oh float64) (float64, float64) {
	f := 1.0
	if m := ebiten.Monitor(); m != nil {
		f = m.DeviceScaleFactor()
	}
	pw, ph := math.Max(ow*f, 2), math.Max(oh*f, 2)
	g.vs = math.Min(pw/sim.W, ph/sim.H)
	g.vox = (pw - sim.W*g.vs) / 2
	g.voy = (ph - sim.H*g.vs) / 2
	return pw, ph
}

func (g *Game) Layout(ow, oh int) (int, int) { return ow, oh }

func hash01(n int) float64 {
	h := uint32(n)*2654435761 + 0x9e3779b9
	h ^= h >> 15
	h *= 2246822519
	h ^= h >> 13
	return float64(h&0xffff) / 65535
}

func sandTint(b *sim.Block, idx int) (r, g, bl float64) {
	if b.Kind == sim.Neck {
		return 1.0, 0.47, 0.38
	}
	d := math.Abs(float64(b.Row-sim.NeckRow)) / float64(sim.NeckRow)
	r, g, bl = lerp(1.0, 0.90, d), lerp(0.86, 0.62, d), lerp(0.50, 0.30, d)
	j := 0.93 + 0.07*hash01(idx)
	return r * j, g * j, bl * j
}

func (g *Game) Draw(screen *ebiten.Image) {
	sw, sh := float64(screen.Bounds().Dx()), float64(screen.Bounds().Dy())
	shx := math.Sin(float64(g.tick)*1.9) * g.shake * 7
	shy := math.Cos(float64(g.tick)*2.3) * g.shake * 5
	c := canvas{dst: screen, s: g.vs, ox: g.vox + shx*g.vs, oy: g.voy + shy*g.vs}

	screen.Fill(color.RGBA{22, 18, 58, 255}) // letterbox: the top sky colour...
	if g.voy > 0 {                           // ...and the table colour below the floor
		vector.FillRect(screen, 0, float32(g.voy+sim.H*g.vs-1), float32(sw), float32(g.voy+2), color.RGBA{58, 36, 44, 255}, false)
	}
	// backdrop (unshaken, so only the foreground rattles)
	{
		var op ebiten.DrawImageOptions
		k := g.vs / bgScale
		op.GeoM.Scale(k, k)
		op.GeoM.Translate(g.vox, g.voy)
		op.Filter = ebiten.FilterLinear
		screen.DrawImage(backdrop, &op)
	}
	_ = sh

	g.drawFloor(c)
	g.drawCubes(c)
	g.drawParticles(c)
	g.drawAim(c)
	c.ox, c.oy = g.vox, g.voy // HUD does not shake
	g.drawHUD(c)
	if g.over {
		g.drawOver(c)
	}
}

func (g *Game) drawFloor(c canvas) {
	// table top
	c.rect(-40, sim.FloorY, sim.W+80, sim.H-sim.FloorY+40, rgba(58, 36, 44, 1))
	c.rect(-40, sim.FloorY, sim.W+80, 6, rgba(122, 82, 84, 1))
	c.rect(-40, sim.FloorY+6, sim.W+80, 3, rgba(30, 18, 26, 0.55))
	for i := 0; i < 5; i++ {
		y := sim.FloorY + 22 + float64(i)*14
		c.rect(-40, y, sim.W+80, 1.5, rgba(34, 20, 28, 0.55))
	}
	// launch post
	px, top := sim.PadX, sim.PadTopY
	c.rect(px-13, top, 26, sim.FloorY-top, rgba(112, 74, 62, 1))
	c.rect(px-13, top, 6, sim.FloorY-top, rgba(150, 104, 84, 1))
	c.rect(px+7, top, 6, sim.FloorY-top, rgba(80, 50, 46, 1))
	c.round(px-20, top-5, 40, 12, 4, rgba(150, 104, 84, 1))
}

func (g *Game) drawCubes(c canvas) {
	for i, b := range g.w.Blocks {
		p := b.Body.Position()
		r, gr, bl := sandTint(b, i)
		c.sprite(cubeSprite, p.X, p.Y, sim.Cube, b.Body.Angle(), r, gr, bl, 1)
	}
	for _, b := range g.w.Shots {
		p := b.Body.Position()
		c.sprite(cubeSprite, p.X, p.Y, sim.Cube, b.Body.Angle(), 0.86, 0.2, 0.22, 1)
	}
	// the cube waiting on the post
	if g.w.ShotsLeft > 0 {
		t := g.w.ReloadProgress()
		sc := 1 + 0.35*math.Sin(clamp(t, 0, 1)*math.Pi)*(1-t)
		if t < 1 {
			sc = clamp(t*1.4, 0, 1) * (1 + 0.15*(1-t))
		}
		ang := 0.0
		if g.aiming {
			if v, ok := sim.VelocityFor(g.cur.Sub(g.anchor)); ok {
				ang = math.Atan2(v.Y, v.X) * 0.25
			}
		}
		p := sim.LaunchPos()
		c.sprite(cubeSprite, p.X, p.Y, sim.Cube*sc, ang, 0.86, 0.2, 0.22, 1)
	}
}

func (g *Game) drawParticles(c canvas) {
	for _, p := range g.parts {
		a := p.life / p.max
		sz := p.size * (0.6 + 0.4*a)
		if p.spark {
			c.line(p.x, p.y, p.x-p.vx*0.04, p.y-p.vy*0.04, 2.4, rgba(p.r, p.g, p.b, a))
			continue
		}
		c.rect(p.x-sz/2, p.y-sz/2, sz, sz, rgba(p.r, p.g, p.b, a*0.75))
	}
}

func (g *Game) drawAim(c canvas) {
	if !g.aiming {
		return
	}
	pull := g.cur.Sub(g.anchor)
	// the drag itself: a faint max-range ring, the band, and the finger
	c.ring(g.anchor.X, g.anchor.Y, sim.MaxPull, 1.5, rgba(255, 240, 210, 0.22))
	c.circle(g.anchor.X, g.anchor.Y, 5, rgba(255, 240, 210, 0.7))
	if pull.Length() > sim.MaxPull {
		pull = pull.Normalize().Mult(sim.MaxPull)
	}
	tip := g.anchor.Add(pull)
	c.line(g.anchor.X, g.anchor.Y, tip.X, tip.Y, 3, rgba(255, 240, 210, 0.55))
	c.circle(tip.X, tip.Y, 11, rgba(255, 240, 210, 0.35))
	c.ring(tip.X, tip.Y, 11, 2, rgba(255, 240, 210, 0.9))

	v, ok := sim.VelocityFor(pull)
	if !ok {
		return
	}
	pts := g.w.Preview(v, 0.04, 1.8)
	for i, p := range pts {
		a := 0.95 - 0.7*float64(i)/float64(len(pts)+1)
		r := 3.6 - 1.4*float64(i)/float64(len(pts)+1)
		c.circle(p.X, p.Y, r, rgba(255, 246, 225, a))
	}
	if n := len(pts); n > 0 {
		last := pts[n-1]
		c.ring(last.X, last.Y, 9, 2, rgba(255, 120, 96, 0.95))
	}
	pct := int(math.Round(v.Length() / (sim.MaxPull * sim.PullGain) * 100))
	c.text(fmt.Sprintf("%d%%", pct), tip.X, tip.Y-42, 18, true, text.AlignCenter, rgba(255, 246, 225, 0.95))
}

func (c canvas) text(str string, x, y, size float64, bold bool, align text.Align, clr color.Color) {
	src := fontReg
	if bold {
		src = fontBold
	}
	face := &text.GoTextFace{Source: src, Size: size * c.s}
	var op text.DrawOptions
	op.GeoM.Translate(c.ox+x*c.s, c.oy+y*c.s)
	op.PrimaryAlign = align
	op.ColorScale.ScaleWithColor(clr)
	text.Draw(c.dst, str, face, &op)
}

func (g *Game) chip(c canvas, r rectF, label string) {
	c.round(r.x, r.y, r.w, r.h, 12, rgba(20, 12, 36, 0.62))
	c.text(label, r.x+r.w/2, r.y+10, 17, true, text.AlignCenter, rgba(255, 238, 205, 0.95))
}

func (g *Game) drawHUD(c canvas) {
	g.chip(c, btnMenu, "MENU")
	g.chip(c, btnReset, "RESET")

	cx := sim.W / 2
	c.text("TOPPLED", cx, 14, 13, true, text.AlignCenter, rgba(255, 224, 196, 0.8))
	c.text(fmt.Sprintf("%d", int(g.dispTop+0.5)), cx-14, 26, 44, true, text.AlignCenter, rgba(255, 250, 238, 1))
	c.text(fmt.Sprintf("/ %d", g.w.Total()), cx+36, 44, 18, false, text.AlignStart, rgba(255, 224, 196, 0.85))
	c.text(fmt.Sprintf("BEST %d", g.best), cx, 80, 14, true, text.AlignCenter, rgba(255, 224, 196, 0.7))

	// cubes still to throw
	n := g.w.ShotsLeft
	for i := 0; i < sim.ShotsPerRound; i++ {
		x := cx + (float64(i)-float64(sim.ShotsPerRound-1)/2)*26
		if i < n {
			c.sprite(cubeSprite, x, 116, 20, 0, 0.86, 0.2, 0.22, 1)
		} else {
			c.sprite(cubeSprite, x, 116, 20, 0, 0.4, 0.3, 0.45, 0.35)
		}
	}

	if len(g.w.Shots) == 0 && !g.over {
		pulse := 0.65 + 0.35*math.Sin(float64(g.tick)*0.07)
		c.text("Drag back, let go to launch", sim.W/2, 168, 22, true, text.AlignCenter, rgba(255, 246, 225, pulse))
		c.text("Smash the coral neck", sim.W/2, 198, 18, false, text.AlignCenter, rgba(255, 150, 128, pulse))
	}
}

func (g *Game) drawOver(c canvas) {
	c.rect(-200, -200, sim.W+400, sim.H+400, rgba(10, 6, 24, 0.62))
	c.round(sim.W/2-195, 330, 390, 300, 22, rgba(34, 20, 52, 0.96))
	c.round(sim.W/2-195, 330, 390, 300, 22, rgba(255, 224, 196, 0.06))
	c.text("ROUND OVER", sim.W/2, 352, 24, true, text.AlignCenter, rgba(255, 224, 196, 1))
	c.text(fmt.Sprintf("%d", g.w.Toppled()), sim.W/2, 392, 76, true, text.AlignCenter, rgba(255, 250, 238, 1))
	c.text(fmt.Sprintf("of %d cubes toppled", g.w.Total()), sim.W/2, 482, 18, false, text.AlignCenter, rgba(255, 224, 196, 0.85))
	if g.newBest {
		c.text("NEW BEST!", sim.W/2, 512, 18, true, text.AlignCenter, rgba(255, 210, 96, 1))
	} else {
		c.text(fmt.Sprintf("best %d", g.best), sim.W/2, 512, 16, false, text.AlignCenter, rgba(255, 224, 196, 0.6))
	}
	c.round(btnAgain.x, btnAgain.y, btnAgain.w, btnAgain.h, 16, rgba(236, 120, 92, 1))
	c.text("PLAY AGAIN", btnAgain.x+btnAgain.w/2, btnAgain.y+17, 22, true, text.AlignCenter, rgba(255, 250, 238, 1))
}

func main() {
	var err error
	if fontReg, err = text.NewGoTextFaceSource(bytes.NewReader(goregular.TTF)); err != nil {
		panic(err)
	}
	if fontBold, err = text.NewGoTextFaceSource(bytes.NewReader(gobold.TTF)); err != nil {
		panic(err)
	}
	cubeSprite = makeCubeSprite()
	backdrop = makeBackdrop(sim.W*bgScale, sim.H*bgScale)

	g := newGame()
	installDebug(g)
	ebiten.SetWindowTitle("Hourglass Smash")
	ebiten.SetWindowSize(540, 960)
	ebiten.SetWindowResizingMode(ebiten.WindowResizingModeEnabled)
	ebiten.SetRunnableOnUnfocused(true)
	if err := ebiten.RunGame(g); err != nil {
		panic(err)
	}
}
