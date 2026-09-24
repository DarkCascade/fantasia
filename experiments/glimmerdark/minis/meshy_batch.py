"""Generate every Glimmerdark miniature with Meshy's text-to-3D API.

Uses the same endpoint and flow as experiments/meshy-prototype/generate.sh
(create a preview task, poll, download the GLB), with the prompts from
minis.json.

    export MESHY_API_KEY=...            # never hard-code it
    python meshy_batch.py                # all figures -> out/<key>.glb
    python meshy_batch.py mira warden    # just these
    python meshy_batch.py --stl          # also export print-ready STLs scaled to each figure's height

Options:
    --art-style realistic|sculpture   Meshy art style (default: sculpture; untextured, suits printing)
    --no-negative                     don't send negative_prompt (if your Meshy API version rejects it)
    --stl                             needs `pip install trimesh`: scales each model so it stands
                                      height_mm tall, drops it onto z=0 and writes out/<key>.stl

Meshy's preview meshes are very dense (the repo's snowman came back at ~1.9M
triangles). That's fine for printing, but slicers get sluggish, so --stl also
decimates to ~300k faces when the mesh is bigger than that.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

API = "https://api.meshy.ai/openapi/v2/text-to-3d"
HERE = Path(__file__).resolve().parent


def _req(method, url, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read())


def generate(fig, key, art_style, send_negative, out: Path) -> Path:
    body = {"mode": "preview", "prompt": fig["prompt"], "art_style": art_style}
    if send_negative:
        body["negative_prompt"] = fig["negative_prompt"]
    task = _req("POST", API, key, body)["result"]
    print(f"[{fig['key']}] task {task}", flush=True)
    while True:
        time.sleep(5)
        st = _req("GET", f"{API}/{task}", key)
        print(f"[{fig['key']}] {st['status']} {st.get('progress', '')}", flush=True)
        if st["status"] == "SUCCEEDED":
            break
        if st["status"] in ("FAILED", "CANCELED", "EXPIRED"):
            raise RuntimeError(f"{fig['key']}: {st}")
    dest = out / f"{fig['key']}.glb"
    urllib.request.urlretrieve(st["model_urls"]["glb"], dest)
    print(f"[{fig['key']}] saved {dest}")
    return dest


def to_stl(glb: Path, height_mm: float, max_faces: int = 300_000) -> Path:
    import trimesh

    mesh = trimesh.load(glb, force="mesh")
    if len(mesh.faces) > max_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
    # Meshy exports Y-up; printers want Z-up.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(1.5707963, [1, 0, 0]))
    ext = mesh.extents
    mesh.apply_scale(height_mm / ext[2])
    mesh.apply_translation([-mesh.centroid[0], -mesh.centroid[1], -mesh.bounds[0][2]])
    stl = glb.with_suffix(".stl")
    mesh.export(stl)
    watertight = "watertight" if mesh.is_watertight else "NOT watertight (repair before slicing)"
    print(f"   {stl.name}: {len(mesh.faces):,} faces, {height_mm} mm tall, {watertight}")
    return stl


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("figures", nargs="*")
    ap.add_argument("--art-style", default="sculpture", choices=["realistic", "sculpture"])
    ap.add_argument("--no-negative", action="store_true")
    ap.add_argument("--stl", action="store_true")
    a = ap.parse_args(argv)
    key = os.environ.get("MESHY_API_KEY")
    if not key:
        sys.exit("MESHY_API_KEY is not set")
    figs = json.loads((HERE / "minis.json").read_text())
    if a.figures:
        figs = [f for f in figs if f["key"] in a.figures]
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    for f in figs:
        glb = generate(f, key, a.art_style, not a.no_negative, out)
        if a.stl:
            to_stl(glb, f["height_mm"])


if __name__ == "__main__":
    main()
