# Orb Cascade

A single-file three.js (r160) prototype of a fan of glowing glass orbs with blue
flame tails spraying from one point, recreated from a phone video of a PS5 game
effect. Not part of the deployed site.

Run it: serve this folder (`python3 -m http.server`) and open `index.html`.
three.js and its postprocessing addons load from jsDelivr via an import map, so
it needs a network connection.

How it works:

- **Orbs** are stateless instanced billboards (`InstancedBufferGeometry`, up to
  1,600). Each orb's position is computed in the vertex shader from its age, so
  there is no CPU particle update. Ages wrap, and each re-emission perturbs the
  path with a hash so the stream never visibly loops.
- **Emission** is grouped into loose bursts (`BURSTS`), which makes knots of orbs
  travel down the stream like the reference.
- **Tails** point opposite to the orb's projected screen-space velocity and get
  longer with speed. The quad is built in NDC, so the tail direction is correct
  under perspective.
- **Orb look** (fragment shader): glass rim, dark ring, specular dot, lower-right
  caustic crescent, and a flickering teardrop tail. Additive blending, then
  `UnrealBloomPass` and `OutputPass`.
- **Background** is a fullscreen shader: ribs fanning from the emitter, arches,
  a warm ceiling disk and a blue haze that follows the fan.
- **Sizing:** narrow screens widen the field of view; wide screens widen the fan
  (`uKx`). The quad uses `DoubleSide` because its screen-space winding flips.

Controls: spread, speed, orb count, size, tail, glow, pause. Pointer steers.
