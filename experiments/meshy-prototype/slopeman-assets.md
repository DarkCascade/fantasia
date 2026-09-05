# The Abominable Slopeman — Meshy asset list

Candidate 3D assets in `src/slopeman.js` for regeneration via the Meshy
pipeline (`experiments/meshy-prototype/generate.sh`). Only the snowman is
currently a Meshy model; the rest are built from primitives at runtime
(`buildTree()`, `buildRock()`, the mountain cones in `buildScene()`) and are
listed here as candidates if procedural geometry ever gets swapped for real
models.

**Reminder before shipping any of these:** Meshy's `preview` output is not
actually low-poly (the snowman and reindeer both came back at ~1.9M
triangles). Decimate with `trimesh` before use:

```python
import trimesh
m = trimesh.load('model.glb', force='mesh')
m.simplify_quadric_decimation(face_count=12000).export('model-simplified.glb')
```

| Name | Role in game | Prompt |
|---|---|---|
| Snowman skier | Player character (already shipped: `src/slopeman/snowman-lowpoly.glb`) | "a cheerful cartoon snowman on skis, wearing a knit beanie with a pompom and a striped scarf, holding two ski poles, low-poly stylized game character, standing pose" |
| Pine tree | Obstacle (currently procedural cone-stack) | "a low-poly stylized snow-covered pine tree, game asset, single tree, snow dusted on branches, no base plane" |
| Rock | Obstacle (currently procedural icosahedron) | "a low-poly stylized granite boulder half-buried in snow, game obstacle asset, irregular angular shape, no base plane" |
| Mountain backdrop | Distant scenery (currently procedural cones) | "a low-poly stylized snow-capped mountain peak silhouette, game background scenery, simple faceted shape, no base plane" |

Not currently in the game, but generated during the prototype and available
at `experiments/meshy-prototype/models/reindeer.glb` if a stretch goal wants
a moving hazard or decorative animal:

| Name | Suggested role | Prompt |
|---|---|---|
| Reindeer | Moving obstacle / decoration | "a low-poly stylized reindeer with antlers, standing pose, game asset, no base plane" |
