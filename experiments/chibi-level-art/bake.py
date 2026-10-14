#!/usr/bin/env python3
"""Bake Meshy level-art GLBs into src/chibi-crawl/props.json.

Usage: python3 -I bake.py <dir with <name>.glb> <out.json>
  pip install trimesh fast-simplification scipy rtree networkx numpy pillow

Each Meshy model is: normalised (y-up, sitting on y=0, scaled to game size),
stripped of the ground slab Meshy likes to add, decimated, and its texture is
baked to per-vertex colour. A per-vertex `mask` marks the parts the game
re-tints per biome (foliage / petals / mushroom cap): for those vertices
`col` holds a grey *shade* instead of a colour, and the game multiplies it by
the biome colour. Output is one small JSON of base64 typed arrays.
"""
import base64, colorsys, json, sys
import numpy as np
import trimesh
from PIL import Image

# name: (target faces, size axis, size in game units, y squash, tint kind, slab rule)
SPECS = {
    "tree":     (1000, "h", 2.7, 1.0, "green", None),
    "pine":     (800, "h", 3.0, 1.0, "green", None),
    "bush":     (700, "w", 1.25, 1.0, "all", None),
    "flowers":  (1100, "w", 1.35, 0.7, "petal", ("tan", 0.30)),
    "rock":     (400,  "w", 1.3, 0.75, None, ("tan", 0.30)),
    "mushroom": (2200, "h", 0.95, 1.0, "cap", None),
    "fence":    (700, "w", 2.6, 0.62, None, ("green", 0.22)),
    # pond: Meshy's came out as a flat disc that vertex colour can't hold detail on,
    # so the game keeps its primitive pond.
    "grass":    (550, "w", 1.05, 1.0, "green", ("grey", 0.20)),
}

TRUNK = {"tree": (0.34, 0.5), "pine": (0.2, 0.62)}  # name: (height fraction, radius fraction)

def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def hsv(rgb):
    return np.array([colorsys.rgb_to_hsv(*p) for p in rgb])  # h 0..1

def sample(mesh, tex, pts):
    """Texture colour (sRGB 0..1) at the nearest surface point of `mesh` to each pt."""
    closest, _, tid = trimesh.proximity.closest_point(mesh, pts)
    tri = mesh.vertices[mesh.faces[tid]]
    bary = trimesh.triangles.points_to_barycentric(tri, closest)
    uv = (mesh.visual.uv[mesh.faces[tid]] * bary[:, :, None]).sum(1)
    w, h = tex.size
    px = np.asarray(tex.convert("RGB"), dtype=np.float64) / 255.0
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(int)
    y = np.clip((1.0 - (uv[:, 1] % 1.0)) * h, 0, h - 1).astype(int)
    return px[y, x]

def is_green(hh, s): return (hh > 0.17) & (hh < 0.47) & (s > 0.22)

def slab_faces(kind, frac, cen_rgb, ycen, H):
    h = hsv(cen_rgb)
    low = ycen < frac * H
    if kind == "tan":   return low & (h[:, 0] > 0.06) & (h[:, 0] < 0.2) & (h[:, 1] > 0.1)
    if kind == "green": return low & (h[:, 0] > 0.17) & (h[:, 0] < 0.45)
    if kind == "grey":  return low & (h[:, 1] < 0.32)
    return np.zeros(len(ycen), bool)

def bake(name, glb, spec):
    faces, axis, size, ysq, tint, slab = spec
    scene = trimesh.load(glb)
    m = list(scene.geometry.values())[0]
    tex = m.visual.material.baseColorTexture
    m = trimesh.Trimesh(m.vertices.copy(), m.faces.copy(), process=False,
                        visual=trimesh.visual.TextureVisuals(uv=m.visual.uv.copy()))
    m.visual.material = list(scene.geometry.values())[0].visual.material
    H = m.bounds[1][1] - m.bounds[0][1]
    if slab:  # drop the ground slab by colour + height; tiny floaters go after decimation
        cen = m.triangles_center
        rgb = sample(m, tex, cen)
        drop = slab_faces(slab[0], slab[1], rgb, cen[:, 1] - m.bounds[0][1], H)
        m = trimesh.Trimesh(m.vertices, m.faces[~drop], process=False,
                            visual=trimesh.visual.TextureVisuals(uv=m.visual.uv))
    src = m
    # decimate geometry only
    import fast_simplification as fs
    # Meshy meshes are unwelded triangle soup: weld by position or the
    # decimator sees every triangle as its own island and tears holes.
    welded = trimesh.Trimesh(src.vertices, src.faces, process=True)
    welded.merge_vertices(digits_vertex=5)
    v2, f2 = fs.simplify(welded.vertices.astype(np.float32), welded.faces.astype(np.int32),
                         target_count=faces, agg=5)
    d = trimesh.Trimesh(v2, f2, process=True)
    d.remove_unreferenced_vertices()
    # drop tiny floating shards
    comps = d.split(only_watertight=False)
    big = max(len(c.faces) for c in comps)
    floor = 1.0 if name == "mushroom" else 0.03  # mushroom: stem+cap only, no base weeds
    d = trimesh.util.concatenate([c for c in comps if len(c.faces) >= floor * big])
    v = np.asarray(d.vertices, dtype=np.float64)
    # normalise: sit on y=0, centred in xz (by bbox), scale
    v[:, 1] -= v[:, 1].min()
    ctr = (v[:, [0, 2]].max(0) + v[:, [0, 2]].min(0)) / 2
    v[:, 0] -= ctr[0]; v[:, 2] -= ctr[1]
    ext = {"w": max(np.ptp(v[:, 0]), np.ptp(v[:, 2])), "h": np.ptp(v[:, 1])}[axis]
    v *= size / ext
    v[:, 1] *= ysq
    # colours
    col_srgb = sample(src, tex, np.asarray(d.vertices))
    hsvv = hsv(col_srgb)
    hh, s, val = hsvv[:, 0], hsvv[:, 1], hsvv[:, 2]
    if tint == "green":   mask = is_green(hh, s)
    elif tint == "petal": mask = ((hh > 0.78) | (hh < 0.05) | ((s < 0.14) & (val > 0.78))) & ~is_green(hh, s) & (val > 0.55)
    elif tint == "all":   mask = np.ones(len(v), bool)  # bush: berries smear under vertex colour, so tint it all
    elif tint == "cap":   mask = ((hh > 0.94) | (hh < 0.04)) & (s > 0.5)
    else:                 mask = np.zeros(len(v), bool)
    col = srgb_to_lin(col_srgb)
    if name in TRUNK:  # Meshy trunks come out mossy/mauve: repaint as the game's bark brown
        frac, rad = TRUNK[name]
        r = np.hypot(v[:, 0], v[:, 2]) / max(np.ptp(v[:, 0]), np.ptp(v[:, 2])) * 2
        trunk = (v[:, 1] < frac * v[:, 1].max()) & (r < rad)
        mask &= ~trunk
        bark = srgb_to_lin(np.array([0x9a, 0x6b, 0x4b]) / 255.0)
        tl = (col @ np.array([0.2126, 0.7152, 0.0722]))[trunk]
        col[trunk] = bark * np.clip(tl / max(tl.mean(), 1e-6), 0.7, 1.25)[:, None]
    lum = col @ np.array([0.2126, 0.7152, 0.0722])
    if mask.any():
        shade = lum / max(lum[mask].mean(), 1e-6)
        grey = np.clip(shade, 0.45, 1.5) / 1.5
        col[mask] = grey[mask, None]
    col8 = np.clip(np.round(col * 255), 0, 255).astype(np.uint8)
    out = {
        "n": len(v), "tris": len(d.faces),
        "pos": base64.b64encode(v.astype(np.float32).tobytes()).decode(),
        "col": base64.b64encode(col8.tobytes()).decode(),
        "mask": base64.b64encode((mask * 255).astype(np.uint8).tobytes()).decode(),
        "idx": base64.b64encode(np.asarray(d.faces, dtype=np.uint16).tobytes()).decode(),
        "bounds": [round(float(x), 3) for x in (v.min(0).tolist() + v.max(0).tolist())],
    }
    print(f"{name}: {len(v)} verts {len(d.faces)} tris  masked {int(mask.sum())}  bounds {out['bounds']}")
    return out

if __name__ == "__main__":
    src_dir, out_path = sys.argv[1], sys.argv[2]
    res = {n: bake(n, f"{src_dir}/{n}.glb", s) for n, s in SPECS.items()}
    json.dump(res, open(out_path, "w"), separators=(",", ":"))
    print("wrote", out_path)
