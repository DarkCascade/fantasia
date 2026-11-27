package sim

import (
	"math"
	"testing"

	"github.com/jakecoffman/cp/v2"
)

func run(w *World, secs float64) {
	for i := 0; i < int(secs/Dt); i++ {
		w.Step()
	}
}

// maxDrift is the furthest any hourglass cube has strayed from where it was built.
func maxDrift(w *World) float64 {
	m := 0.0
	for _, b := range w.Blocks {
		if d := b.Body.Position().Distance(b.Start); d > m {
			m = d
		}
	}
	return m
}

// The whole point of the shape: it must stand by itself, overhangs and all.
func TestHourglassStandsUnaided(t *testing.T) {
	w := NewWorld()
	run(w, 12)
	if d := maxDrift(w); d > 3 {
		t.Fatalf("hourglass drifted %.1f px in 12 s with nobody touching it", d)
	}
	if n := w.Toppled(); n != 0 {
		t.Fatalf("%d cubes toppled on their own", n)
	}
	asleep := 0
	for _, b := range w.Blocks {
		if b.Body.IsSleeping() {
			asleep++
		}
	}
	if asleep < w.Total()*9/10 {
		t.Errorf("only %d/%d cubes went to sleep; the stack is still jittering", asleep, w.Total())
	}
}

func TestCubeCount(t *testing.T) {
	w := NewWorld()
	want := 0
	for _, c := range RowWidths {
		want += c
	}
	if w.Total() != want {
		t.Fatalf("got %d cubes, want %d", w.Total(), want)
	}
}

// The preview dots must follow the real flight until something is hit.
func TestPreviewMatchesFlight(t *testing.T) {
	for _, v := range []cp.Vector{{X: 700, Y: -150}, {X: 500, Y: -600}, {X: 900, Y: -50}} {
		w := NewWorld()
		pts := w.Preview(v, 0.05, 0.6)
		if len(pts) < 3 {
			t.Fatalf("v=%v: preview too short (%d)", v, len(pts))
		}
		w.Launch(v)
		sh := w.Shots[0]
		worst := 0.0
		for i, p := range pts {
			// 0.05 s = 3 ticks
			for k := 0; k < 3; k++ {
				w.Step()
			}
			if i == len(pts)-1 {
				break // the last dot is the contact point; flight may already have deflected
			}
			if d := sh.Body.Position().Distance(p); d > worst {
				worst = d
			}
		}
		if worst > 2.5 {
			t.Errorf("v=%v: preview strayed %.2f px from the real flight", v, worst)
		}
	}
}

// Launch input: a tap does nothing, a drag goes the opposite way, clamped.
func TestVelocityFor(t *testing.T) {
	if _, ok := VelocityFor(cp.Vector{X: 3, Y: 3}); ok {
		t.Error("tiny drag should be ignored")
	}
	v, ok := VelocityFor(cp.Vector{X: -100, Y: 20})
	if !ok || v.X <= 0 || v.Y >= 0 {
		t.Errorf("drag left+down should fling right+up, got %v", v)
	}
	v, _ = VelocityFor(cp.Vector{X: -1000, Y: 0})
	if math.Abs(v.Length()-MaxPull*PullGain) > 1e-6 {
		t.Errorf("clamp failed: speed %.1f", v.Length())
	}
}

func TestShotsAndReload(t *testing.T) {
	w := NewWorld()
	if !w.Ready() {
		t.Fatal("not ready at start")
	}
	w.Launch(cp.Vector{X: 600, Y: -300})
	if w.Ready() {
		t.Error("ready instantly after a launch")
	}
	run(w, ReloadDelay+0.1)
	if !w.Ready() || w.ShotsLeft != ShotsPerRound-1 {
		t.Errorf("reload broken: ready=%v left=%d", w.Ready(), w.ShotsLeft)
	}
}

func TestRoundEnds(t *testing.T) {
	w := NewWorld()
	for i := 0; i < ShotsPerRound; i++ {
		for !w.Ready() {
			w.Step()
		}
		w.Launch(cp.Vector{X: 400, Y: -100})
	}
	run(w, RoundTimeout+1)
	if !w.Over() {
		t.Fatal("round never ended")
	}
}

func TestDeterministic(t *testing.T) {
	a, b := NewWorld(), NewWorld()
	for _, w := range []*World{a, b} {
		w.Launch(cp.Vector{X: 900, Y: -200})
		run(w, 5)
	}
	if a.Toppled() != b.Toppled() {
		t.Fatalf("two identical runs disagree: %d vs %d", a.Toppled(), b.Toppled())
	}
	for i := range a.Blocks {
		if a.Blocks[i].Body.Position() != b.Blocks[i].Body.Position() {
			t.Fatalf("cube %d differs between identical runs", i)
		}
	}
}

// Sweep launch angle x power with one cube each. This is the design check:
// the neck has to be reachable by a decent slice of aims, and taking it out
// must bring down far more of the hourglass than hitting anything else does.
func TestAimSweep(t *testing.T) {
	if testing.Short() {
		t.Skip("slow design sweep")
	}
	var shots, neckShots, neckTopple, otherTopple int
	for deg := 0.0; deg <= 42; deg += 6 {
		for speed := 700.0; speed <= 1350; speed += 100 {
			w := NewWorld()
			run(w, 2) // let the stack settle and fall asleep, as in a real game
			rad := deg * math.Pi / 180
			w.Launch(cp.Vector{X: speed * math.Cos(rad), Y: -speed * math.Sin(rad)})
			run(w, 3.5)
			neckOut := 0
			for _, b := range w.Blocks {
				if b.Kind == Neck && b.Body.Position().Distance(b.Start) > Cube*0.8 {
					neckOut++
				}
			}
			shots++
			if neckOut == 2 {
				neckShots++
				neckTopple += w.Toppled()
			} else {
				otherTopple += w.Toppled()
			}
		}
	}
	avgNeck := float64(neckTopple) / math.Max(1, float64(neckShots))
	avgOther := float64(otherTopple) / math.Max(1, float64(shots-neckShots))
	t.Logf("%d/%d aims took out the neck: avg %.1f of %d cubes toppled, versus %.1f for every other aim",
		neckShots, shots, avgNeck, NewWorld().Total(), avgOther)
	if float64(neckShots)/float64(shots) < 0.08 {
		t.Errorf("neck shots too rare: %d/%d", neckShots, shots)
	}
	if avgNeck < 25 {
		t.Errorf("taking out the neck only topples %.1f cubes; the top half should come down", avgNeck)
	}
	if avgNeck < 2*avgOther {
		t.Errorf("the neck should be worth far more than other targets (%.1f vs %.1f)", avgNeck, avgOther)
	}
}
