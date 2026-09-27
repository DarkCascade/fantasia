"""Convert a .glb to a print-ready .stl next to it (model.glb -> model.stl).

Same conversion as meshy_batch.py's --stl step: decimate if dense, rotate
Y-up -> Z-up, centre on the origin and drop onto z=0.

    pip install trimesh fast-simplification
    python glb_to_stl.py path/to/model.glb                 # keep the model's own size
    python glb_to_stl.py path/to/model.glb --height-mm 32  # scale to stand 32 mm tall
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def to_stl(glb: Path, height_mm: float | None = None, max_faces: int = 300_000) -> Path:
    import trimesh

    mesh = trimesh.load(glb, force="mesh")
    if len(mesh.faces) > max_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
    # Meshy exports Y-up; printers want Z-up.
    mesh.apply_transform(trimesh.transformations.rotation_matrix(1.5707963, [1, 0, 0]))
    if height_mm is not None:
        mesh.apply_scale(height_mm / mesh.extents[2])
    mesh.apply_translation([-mesh.centroid[0], -mesh.centroid[1], -mesh.bounds[0][2]])
    stl = glb.with_suffix(".stl")
    mesh.export(stl)
    watertight = "watertight" if mesh.is_watertight else "NOT watertight (repair before slicing)"
    print(f"{stl}: {len(mesh.faces):,} faces, {mesh.extents[2]:.2f} tall, {watertight}")
    return stl


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb", type=Path, help="path to the .glb file")
    ap.add_argument("--height-mm", type=float, help="scale so the model stands this tall (default: unscaled)")
    ap.add_argument("--max-faces", type=int, default=300_000, help="decimate above this face count (default: 300000)")
    a = ap.parse_args(argv)
    if not a.glb.is_file():
        sys.exit(f"not found: {a.glb}")
    to_stl(a.glb.resolve(), a.height_mm, a.max_faces)


if __name__ == "__main__":
    main()
