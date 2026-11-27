// Package sim is the pure physics + rules for Hourglass Smash. It knows
// nothing about rendering or the browser, so it runs (and is tested) under
// plain `go test` while the Ebitengine front end only reads from it.
//
// Coordinates are logical pixels with y pointing DOWN, matching the screen,
// so the renderer can draw bodies at their physics positions unchanged.
package sim

import (
	"math"

	"github.com/jakecoffman/cp/v2"
)

const (
	W = 540.0 // logical playfield size (the renderer's Layout)
	H = 960.0

	Cube    = 36.0  // edge of every cube, launch cube included
	FloorY  = 880.0 // top surface of the floor
	Gravity = 1500.0

	// Fixed timestep. The front end calls Step once per Ebitengine tick (60
	// TPS) and each tick is split into Substeps for a steadier tall stack.
	Dt       = 1.0 / 60.0
	Substeps = 2

	PadX    = 74.0  // the launch post
	PadTopY = 700.0 // top of the post; the cube sits on it while you aim

	MaxPull  = 150.0 // longest drag that still counts (px)
	MinPull  = 14.0  // shorter drags are treated as a tap and ignored
	PullGain = 9.0   // launch speed = pull length * PullGain (max 1350 px/s)

	ShotMass      = 7.0 // a hourglass cube weighs 1; the launch cube is a wrecking block
	ShotsPerRound = 5
	ReloadDelay   = 0.9  // seconds before the next cube is on the post
	SettleTime    = 1.0  // calm for this long and the round is over
	RoundTimeout  = 14.0 // ...or this long after the last launch, whatever happens
)

// RowWidths lists the hourglass top to bottom: a wide bulb that narrows to a
// two-cube neck, then widens again. The upper rows overhang the ones below
// by half a cube per side, so the neck is the keystone holding the whole top
// half up. Knock it out and the top comes down on the bottom half.
var RowWidths = []int{8, 7, 6, 5, 4, 3, 2, 3, 4, 5, 6, 7, 8}

// NeckRow is the index of the narrowest row.
const NeckRow = 6

// A tall inverted stack of loose cubes can't stand: each row hangs half a
// cube over the one below, which leaves the end cubes with their weight
// exactly on the edge of their support. So the rows of the top bulb are
// glued, cube to neighbouring cube, into stiff planks. Planks are happy to
// overhang symmetrically, the hourglass stands, and a hard enough knock
// snaps the glue so the top half bursts into loose cubes on impact.
const (
	GlueRows            = NeckRow // rows 0..GlueRows-1 are glued
	BreakImpulseDefault = 300.0
)

// HourglassX is the x of the hourglass's centre line.
const HourglassX = 376.0

type Kind int

const (
	Sand Kind = iota // an ordinary cube of the hourglass
	Neck             // a cube of the neck row (the one worth aiming for)
	Shot             // a launched cube
)

const (
	ctWorld cp.CollisionType = iota
	ctSand
	ctShot
)

// Block is one cube in play.
type Block struct {
	Body  *cp.Body
	Shape *cp.Shape
	Kind  Kind
	Row   int // row in RowWidths, -1 for shots
	Start cp.Vector
}

// Impact is something the renderer might want to puff dust or shake for.
type Impact struct {
	X, Y  float64
	Power float64 // impulse magnitude
	Shot  bool    // involved a launched cube
	Snap  bool    // glue between two cubes snapped here
}

// World owns the physics space and the round state.
type World struct {
	Space  *cp.Space
	Blocks []*Block // the hourglass
	Shots  []*Block // cubes already launched

	ShotsLeft int
	Time      float64

	launched   bool
	lastLaunch float64
	calm       float64
	done       bool

	// Impacts queued since the last DrainImpacts call.
	Impacts []Impact

	welds []*weld
}

// BreakImpulse is the joint impulse (per physics substep) above which glue
// snaps. A variable only so the design sweep can compare values.
var BreakImpulse = BreakImpulseDefault

// weld glues two neighbouring cubes of one row (a pivot plus a lock on their
// relative angle). It snaps when the joint has to push harder than the glue.
type weld struct {
	a, b        *Block
	pivot, gear *cp.Constraint
	snapped     bool
}

// NewWorld builds a fresh hourglass.
func NewWorld() *World { return NewWorldWith(RowWidths, HourglassX) }

// NewWorldWith builds a stack from arbitrary row widths (tests use this to
// compare shapes).
func NewWorldWith(widths []int, cx float64) *World {
	w := &World{ShotsLeft: ShotsPerRound}
	sp := cp.NewSpace()
	sp.Iterations = 40
	sp.SetGravity(cp.Vector{X: 0, Y: Gravity})
	sp.SetCollisionSlop(0.4)
	sp.SleepTimeThreshold = 0.5
	sp.IdleSpeedThreshold = 6
	w.Space = sp

	// Floor and side walls: thick segments so cubes can't tunnel, positioned
	// so their inner faces sit exactly on FloorY / x=0 / x=W.
	const t = 40.0
	for _, s := range []*cp.Shape{
		cp.NewSegment(sp.StaticBody, cp.Vector{X: -200, Y: FloorY + t}, cp.Vector{X: W + 200, Y: FloorY + t}, t),
		cp.NewSegment(sp.StaticBody, cp.Vector{X: -t, Y: -4000}, cp.Vector{X: -t, Y: FloorY + 2*t}, t),
		cp.NewSegment(sp.StaticBody, cp.Vector{X: W + t, Y: -4000}, cp.Vector{X: W + t, Y: FloorY + 2*t}, t),
	} {
		s.SetFriction(0.9)
		s.SetElasticity(0.05)
		sp.AddShape(s)
	}

	// The launch post.
	post := cp.NewStaticBody()
	post.SetPosition(cp.Vector{X: PadX, Y: (PadTopY + FloorY) / 2})
	ps := cp.NewBox(post, 26, FloorY-PadTopY, 0)
	ps.SetFriction(0.8)
	sp.AddBody(post)
	sp.AddShape(ps)

	// Collision handlers: all we want is a note of the hard knocks.
	rec := func(shot bool) cp.CollisionPostSolveFunc {
		return func(arb *cp.Arbiter, _ *cp.Space, _ any) {
			if !arb.IsFirstContact() {
				return
			}
			p := arb.TotalImpulse().Length()
			if p < 50 {
				return
			}
			a, b := arb.Bodies()
			pos := a.Position().Add(b.Position()).Mult(0.5)
			if a.GetType() == cp.BODY_STATIC {
				pos = b.Position()
			} else if b.GetType() == cp.BODY_STATIC {
				pos = a.Position()
			}
			if len(w.Impacts) < 64 {
				w.Impacts = append(w.Impacts, Impact{X: pos.X, Y: pos.Y, Power: p, Shot: shot})
			}
		}
	}
	for _, pair := range [][2]cp.CollisionType{{ctSand, ctSand}, {ctSand, ctWorld}} {
		sp.NewCollisionHandler(pair[0], pair[1]).PostSolveFunc = rec(false)
	}
	for _, pair := range [][2]cp.CollisionType{{ctShot, ctSand}, {ctShot, ctShot}, {ctShot, ctWorld}} {
		sp.NewCollisionHandler(pair[0], pair[1]).PostSolveFunc = rec(true)
	}

	// The hourglass itself.
	n := len(widths)
	for r, count := range widths {
		y := FloorY - (float64(n-r)-0.5)*Cube
		var prev *Block
		for i := 0; i < count; i++ {
			x := cx + (float64(i)-float64(count-1)/2)*Cube
			kind := Sand
			if r == NeckRow {
				kind = Neck
			}
			b := w.addCube(cp.Vector{X: x, Y: y}, kind, r, 1.0)
			w.Blocks = append(w.Blocks, b)
			if prev != nil && r < GlueRows {
				w.glue(prev, b)
			}
			prev = b
		}
	}
	return w
}

// glue welds two side-by-side cubes together.
func (w *World) glue(a, b *Block) {
	mid := a.Body.Position().Add(b.Body.Position()).Mult(0.5)
	piv := cp.NewPivotJoint(a.Body, b.Body, mid)
	gear := cp.NewGearJoint(a.Body, b.Body, 0, 1)
	piv.SetCollideBodies(false)
	gear.SetCollideBodies(false)
	w.Space.AddConstraint(piv)
	w.Space.AddConstraint(gear)
	w.welds = append(w.welds, &weld{a: a, b: b, pivot: piv, gear: gear})
}

// snapWelds breaks any glue that was asked to carry too much this step.
func (w *World) snapWelds() {
	for _, g := range w.welds {
		if g.snapped {
			continue
		}
		if g.pivot.Class.GetImpulse() > BreakImpulse || g.gear.Class.GetImpulse() > BreakImpulse*Cube/2 {
			g.snapped = true
			w.Space.RemoveConstraint(g.pivot)
			w.Space.RemoveConstraint(g.gear)
			g.a.Body.Activate()
			g.b.Body.Activate()
			p := g.a.Body.Position().Add(g.b.Body.Position()).Mult(0.5)
			if len(w.Impacts) < 64 {
				w.Impacts = append(w.Impacts, Impact{X: p.X, Y: p.Y, Power: BreakImpulse, Snap: true})
			}
		}
	}
}

func (w *World) addCube(pos cp.Vector, kind Kind, row int, mass float64) *Block {
	// The box is drawn Cube wide; the 0.5 corner radius is added around a box
	// 1 px smaller so the outer size is exactly Cube. Rounding the corners a
	// hair makes tall stacks much steadier than razor-sharp ones.
	const r = 0.5
	body := cp.NewBody(mass, cp.MomentForBox(mass, Cube, Cube))
	body.SetPosition(pos)
	sh := cp.NewBox(body, Cube-2*r, Cube-2*r, r)
	sh.SetFriction(0.8)
	sh.SetElasticity(0.05)
	if kind == Shot {
		sh.SetCollisionType(ctShot)
		sh.SetFriction(0.6)
		sh.SetElasticity(0.1)
	} else {
		sh.SetCollisionType(ctSand)
	}
	w.Space.AddBody(body)
	w.Space.AddShape(sh)
	return &Block{Body: body, Shape: sh, Kind: kind, Row: row, Start: pos}
}

// LaunchPos is where the next cube waits on the post.
func LaunchPos() cp.Vector { return cp.Vector{X: PadX, Y: PadTopY - Cube/2} }

// Ready reports whether a cube is waiting on the post to be launched.
func (w *World) Ready() bool {
	if w.ShotsLeft <= 0 {
		return false
	}
	return !w.launched || w.Time-w.lastLaunch >= ReloadDelay
}

// ReloadProgress is 0..1 while the next cube is being loaded onto the post
// (1 once it is ready).
func (w *World) ReloadProgress() float64 {
	if !w.launched {
		return 1
	}
	p := (w.Time - w.lastLaunch) / ReloadDelay
	if p > 1 {
		return 1
	}
	return p
}

// VelocityFor turns a drag (finger moved by `pull`, in logical px) into a
// launch velocity: the cube flies opposite the drag, like a slingshot.
// ok is false for a tap-sized drag.
func VelocityFor(pull cp.Vector) (v cp.Vector, ok bool) {
	l := pull.Length()
	if l < MinPull {
		return cp.Vector{}, false
	}
	if l > MaxPull {
		pull = pull.Mult(MaxPull / l)
		l = MaxPull
	}
	return pull.Mult(-PullGain), true
}

// Launch fires the next cube with the given velocity.
func (w *World) Launch(v cp.Vector) bool {
	if !w.Ready() {
		return false
	}
	b := w.addCube(LaunchPos(), Shot, -1, ShotMass)
	b.Body.SetVelocityVector(v)
	w.Shots = append(w.Shots, b)
	w.ShotsLeft--
	w.launched = true
	w.lastLaunch = w.Time
	w.calm = 0
	return true
}

// Step advances the world by one front-end tick (Dt seconds).
func (w *World) Step() {
	for i := 0; i < Substeps; i++ {
		w.Space.Step(Dt / Substeps)
		w.snapWelds()
	}
	w.Time += Dt

	if w.ShotsLeft == 0 && w.launched && !w.done {
		if w.isCalm() {
			w.calm += Dt
		} else {
			w.calm = 0
		}
		if w.calm >= SettleTime || w.Time-w.lastLaunch >= RoundTimeout {
			w.done = true
		}
	}
}

func (w *World) isCalm() bool {
	still := func(b *Block) bool {
		if b.Body.IsSleeping() {
			return true
		}
		return b.Body.Velocity().LengthSq() < 20*20 && math.Abs(b.Body.AngularVelocity()) < 0.5
	}
	for _, b := range w.Blocks {
		if !still(b) {
			return false
		}
	}
	for _, b := range w.Shots {
		if !still(b) {
			return false
		}
	}
	return true
}

// Over is true once every cube has been thrown and the wreckage has settled.
func (w *World) Over() bool { return w.done }

// Toppled counts hourglass cubes that have been knocked clear of where they
// started (more than 0.6 of a cube).
func (w *World) Toppled() int {
	n := 0
	for _, b := range w.Blocks {
		if b.Body.Position().Distance(b.Start) > Cube*0.6 {
			n++
		}
	}
	return n
}

// Total is the number of cubes in the hourglass.
func (w *World) Total() int { return len(w.Blocks) }

// DrainImpacts hands over (and clears) the queued impacts.
func (w *World) DrainImpacts() []Impact {
	out := w.Impacts
	w.Impacts = nil
	return out
}

// Preview returns points along the path a launch with velocity v would take,
// sampled every `every` seconds, stopping at the first thing it would hit
// (floor, wall or a cube of the hourglass). It integrates exactly like the
// real step (position, then velocity) so the dots match the flight.
func (w *World) Preview(v cp.Vector, every, maxT float64) []cp.Vector {
	p := LaunchPos()
	vel := v
	h := Dt / Substeps
	steps := int(every / h)
	if steps < 1 {
		steps = 1
	}
	var pts []cp.Vector
	for t := 0.0; t < maxT; t += every {
		for i := 0; i < steps; i++ {
			p = p.Add(vel.Mult(h))
			vel.Y += Gravity * h
		}
		if p.Y > FloorY-Cube/2 || p.X < Cube/2 || p.X > W-Cube/2 {
			break
		}
		if w.hitsBlock(p) {
			pts = append(pts, p)
			break
		}
		pts = append(pts, p)
	}
	return pts
}

func (w *World) hitsBlock(p cp.Vector) bool {
	for _, b := range w.Blocks {
		q := b.Body.Position()
		if math.Abs(q.X-p.X) < Cube*0.92 && math.Abs(q.Y-p.Y) < Cube*0.92 {
			return true
		}
	}
	return false
}
