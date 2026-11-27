package main

import (
	"image/color"
	"math"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
)

// canvas wraps a destination image together with the world->screen transform,
// so all drawing code can speak in logical world units (540x960) while still
// rendering at the device's native resolution.
type canvas struct {
	dst       *ebiten.Image
	s, ox, oy float64
}

func (c canvas) x(v float64) float32 { return float32(c.ox + v*c.s) }
func (c canvas) y(v float64) float32 { return float32(c.oy + v*c.s) }
func (c canvas) l(v float64) float32 { return float32(v * c.s) }

// rgba builds a premultiplied colour from 0..255 channels and a 0..1 alpha.
func rgba(r, g, b, a float64) color.RGBA {
	a = clamp(a, 0, 1)
	return color.RGBA{uint8(clamp(r, 0, 255) * a), uint8(clamp(g, 0, 255) * a), uint8(clamp(b, 0, 255) * a), uint8(a * 255)}
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func lerp(a, b, t float64) float64    { return a + (b-a)*t }

func (c canvas) rect(x, y, w, h float64, clr color.Color) {
	vector.FillRect(c.dst, c.x(x), c.y(y), c.l(w), c.l(h), clr, false)
}

func (c canvas) circle(x, y, r float64, clr color.Color) {
	vector.FillCircle(c.dst, c.x(x), c.y(y), c.l(r), clr, true)
}

func (c canvas) ring(x, y, r, wd float64, clr color.Color) {
	vector.StrokeCircle(c.dst, c.x(x), c.y(y), c.l(r), c.l(wd), clr, true)
}

func (c canvas) line(x0, y0, x1, y1, wd float64, clr color.Color) {
	vector.StrokeLine(c.dst, c.x(x0), c.y(y0), c.x(x1), c.y(y1), c.l(wd), clr, true)
}

func (c canvas) round(x, y, w, h, r float64, clr color.Color) {
	var p vector.Path
	X, Y, W, H, R := c.x(x), c.y(y), c.l(w), c.l(h), c.l(r)
	p.MoveTo(X+R, Y)
	p.LineTo(X+W-R, Y)
	p.ArcTo(X+W, Y, X+W, Y+R, R)
	p.LineTo(X+W, Y+H-R)
	p.ArcTo(X+W, Y+H, X+W-R, Y+H, R)
	p.LineTo(X+R, Y+H)
	p.ArcTo(X, Y+H, X, Y+H-R, R)
	p.LineTo(X, Y+R)
	p.ArcTo(X, Y, X+R, Y, R)
	p.Close()
	op := &vector.DrawPathOptions{AntiAlias: true}
	op.ColorScale.ScaleWithColor(clr)
	vector.FillPath(c.dst, &p, nil, op)
}

// sprite draws img centred on (x,y) in world units, `size` world units wide,
// rotated by ang, tinted by (r,g,b) in 0..1.
func (c canvas) sprite(img *ebiten.Image, x, y, size, ang, r, g, b, a float64) {
	var op ebiten.DrawImageOptions
	w := float64(img.Bounds().Dx())
	op.GeoM.Translate(-w/2, -w/2)
	k := size * c.s / w
	op.GeoM.Scale(k, k)
	op.GeoM.Rotate(ang)
	op.GeoM.Translate(c.ox+x*c.s, c.oy+y*c.s)
	op.ColorScale.Scale(float32(r*a), float32(g*a), float32(b*a), float32(a))
	op.Filter = ebiten.FilterLinear
	c.dst.DrawImage(img, &op)
}

// makeCubeSprite bakes one white, bevelled, rounded cube (96x96). It is
// tinted per cube at draw time through the colour scale, so the dark outline
// and bevel come out as darker shades of whatever colour the cube is.
func makeCubeSprite() *ebiten.Image {
	const n, rad = 96, 13.0
	pix := make([]byte, n*n*4)
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			u, v := float64(x)+0.5-n/2, float64(y)+0.5-n/2
			dx := math.Max(math.Abs(u)-(n/2-rad), 0)
			dy := math.Max(math.Abs(v)-(n/2-rad), 0)
			e := rad - math.Hypot(dx, dy) // distance inside the rounded edge
			cov := clamp(e+0.5, 0, 1)
			if cov <= 0 {
				continue
			}
			var shade float64
			switch {
			case e < 5: // outline
				shade = 0.42
			case e < 15: // bevel: lit top-left, shaded bottom-right
				if u+v < 0 {
					shade = 1.0
				} else {
					shade = 0.74
				}
			case e > 24 && e < 27 && math.Max(math.Abs(u), math.Abs(v)) < n/2-24: // inset plate line
				shade = 0.78
			default: // face, a touch darker toward the bottom
				shade = 0.93 - 0.08*(v+n/2)/n
			}
			i := (y*n + x) * 4
			s := uint8(clamp(shade, 0, 1) * cov * 255)
			pix[i], pix[i+1], pix[i+2], pix[i+3] = s, s, s, uint8(cov*255)
		}
	}
	img := ebiten.NewImage(n, n)
	img.WritePixels(pix)
	return img
}

// makeBackdrop paints the dusk sky once, at 2x, with moon, stars and hills.
// It is scaled to the screen at draw time (gradients scale cleanly).
func makeBackdrop(w, h int) *ebiten.Image {
	img := ebiten.NewImage(w, h)
	sky := []struct{ y, r, g, b float64 }{
		{0.00, 22, 18, 58},
		{0.38, 58, 36, 98},
		{0.62, 150, 68, 112},
		{0.80, 236, 128, 104},
		{0.92, 255, 176, 120},
	}
	for y := 0; y < h; y++ {
		t := float64(y) / float64(h)
		i := 0
		for i < len(sky)-2 && t > sky[i+1].y {
			i++
		}
		k := clamp((t-sky[i].y)/(sky[i+1].y-sky[i].y), 0, 1)
		clr := color.RGBA{uint8(lerp(sky[i].r, sky[i+1].r, k)), uint8(lerp(sky[i].g, sky[i+1].g, k)), uint8(lerp(sky[i].b, sky[i+1].b, k)), 255}
		vector.FillRect(img, 0, float32(y), float32(w), 1, clr, false)
	}
	sc := float64(w) / 540
	// stars (deterministic scatter)
	seed := uint32(7)
	rnd := func() float64 {
		seed = seed*1664525 + 1013904223
		return float64(seed>>8) / float64(1<<24)
	}
	for i := 0; i < 90; i++ {
		x, y := rnd()*540, rnd()*520
		a := 0.25 + 0.6*rnd()*(1-y/620)
		vector.FillCircle(img, float32(x*sc), float32(y*sc), float32((0.6+rnd()*1.1)*sc), rgba(255, 244, 220, a), true)
	}
	// moon with a soft halo
	for r := 9; r >= 1; r-- {
		vector.FillCircle(img, float32(430*sc), float32(300*sc), float32((34+float64(r)*9)*sc), rgba(255, 224, 180, 0.018), true)
	}
	vector.FillCircle(img, float32(430*sc), float32(300*sc), float32(32*sc), rgba(255, 238, 205, 1), true)
	vector.FillCircle(img, float32(440*sc), float32(292*sc), float32(7*sc), rgba(236, 214, 180, 0.7), true)
	vector.FillCircle(img, float32(420*sc), float32(312*sc), float32(5*sc), rgba(236, 214, 180, 0.6), true)
	// two layers of hills
	hill := func(base, amp, f1, f2, ph float64, clr color.RGBA) {
		var p vector.Path
		p.MoveTo(0, float32(h))
		for x := 0; x <= 540; x += 6 {
			y := base + amp*math.Sin(float64(x)*f1+ph) + amp*0.5*math.Sin(float64(x)*f2+ph*2)
			p.LineTo(float32(float64(x)*sc), float32(y*sc))
		}
		p.LineTo(float32(w), float32(h))
		p.Close()
		op := &vector.DrawPathOptions{AntiAlias: true}
		op.ColorScale.ScaleWithColor(clr)
		vector.FillPath(img, &p, nil, op)
	}
	hill(770, 26, 0.012, 0.031, 1.0, color.RGBA{74, 38, 82, 255})
	hill(822, 18, 0.017, 0.043, 3.1, color.RGBA{44, 24, 58, 255})
	return img
}
