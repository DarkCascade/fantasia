//go:build js

package main

import (
	"fmt"
	"syscall/js"

	"github.com/jakecoffman/cp/v2"

	"fantasia/hourglass-smash/sim"
)

// The game runs inside an <iframe> on the Fantasia menu page, so "Menu" asks
// the parent page to tear the iframe down (and with it, this wasm instance).
func hostMenu() {
	defer func() { _ = recover() }()
	parent := js.Global().Get("parent")
	if parent.Truthy() && parent.Get("returnToMenu").Truthy() {
		parent.Call("returnToMenu")
	}
}

const bestKey = "hourglass-smash-best"

func loadBest() (n int) {
	defer func() { _ = recover() }() // localStorage can throw (blocked storage)
	v := js.Global().Get("localStorage").Call("getItem", bestKey)
	if v.Truthy() {
		fmt.Sscanf(v.String(), "%d", &n)
	}
	return n
}

func saveBest(n int) {
	defer func() { _ = recover() }()
	js.Global().Get("localStorage").Call("setItem", bestKey, fmt.Sprint(n))
}

var debugFuncs []js.Func

// installDebug exposes window.hourglassSmash for headless tests: Playwright can
// read the state, fire a launch and fast-forward the sim without waiting on
// software-rendered frames.
func installDebug(g *Game) {
	fn := func(f func(args []js.Value) any) js.Func {
		jf := js.FuncOf(func(_ js.Value, args []js.Value) any { return f(args) })
		debugFuncs = append(debugFuncs, jf)
		return jf
	}
	api := map[string]any{
		"state": fn(func([]js.Value) any {
			return fmt.Sprintf(`{"toppled":%d,"total":%d,"shotsLeft":%d,"ready":%t,"over":%t,"time":%.2f,"best":%d}`,
				g.w.Toppled(), g.w.Total(), g.w.ShotsLeft, g.w.Ready(), g.over, g.w.Time, g.best)
		}),
		"launch": fn(func(a []js.Value) any {
			return g.launch(cp.Vector{X: a[0].Float(), Y: a[1].Float()})
		}),
		"advance": fn(func(a []js.Value) any {
			for i := 0; i < a[0].Int(); i++ {
				g.w.Step()
				for _, im := range g.w.DrainImpacts() {
					g.spawnImpact(im)
				}
				g.stepParticles()
			}
			return nil
		}),
		"reset": fn(func([]js.Value) any { g.reset(); return nil }),
		"layout": fn(func([]js.Value) any {
			return fmt.Sprintf(`{"scale":%.4f,"ox":%.1f,"oy":%.1f,"w":%v,"h":%v}`, g.vs, g.vox, g.voy, sim.W, sim.H)
		}),
	}
	js.Global().Set("hourglassSmash", api)
}
