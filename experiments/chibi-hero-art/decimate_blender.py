"""Decimate a textured Meshy GLB in Blender and re-bake its texture onto a fresh UV map.

Usage (Blender 4/5):
  blender --background --python decimate_blender.py -- <in.glb> <out.glb> <target tris> [texture px, default 1024]

Meshy's *standard* (multi-image) models come out at 25-70k tris, far too heavy to draw a few at a time on a
phone, and their texture atlas is a mosaic of projected patches. Collapsing straight across that mosaic
smears the face (what a first attempt did), and trimesh/fast-simplification throws UVs away entirely.
So: decimate a copy, give it a clean smart-UV layout, and bake the colour of the original onto it
(selected-to-active, diffuse colour only). The result keeps the face crisp at a few thousand triangles.
"""
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])
px = int(argv[3]) if len(argv) > 3 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
high = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
high.name = "high"

# low-poly copy
low = high.copy()
low.data = high.data.copy()
low.name = "low"
bpy.context.collection.objects.link(low)
for o in bpy.context.scene.objects:
    o.select_set(False)
bpy.context.view_layer.objects.active = low
low.select_set(True)
tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
mod = low.modifiers.new("dec", "DECIMATE")
mod.decimate_type = "COLLAPSE"
mod.ratio = min(1.0, target / max(tris, 1))
mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier=mod.name)
print("DECIMATED", tris, "->", sum(len(p.vertices) - 2 for p in low.data.polygons))

# fresh UVs
while low.data.uv_layers:
    low.data.uv_layers.remove(low.data.uv_layers[0])
low.data.uv_layers.new(name="bake")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.012)
bpy.ops.object.mode_set(mode="OBJECT")

# target material with an image texture node (the bake writes into the active image node)
img = bpy.data.images.new("baked", px, px)
mat = bpy.data.materials.new("baked")
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
bsdf = nt.nodes["Principled BSDF"]
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
nt.nodes.active = tex
low.data.materials.clear()
low.data.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 1
sc.render.bake.use_pass_direct = False
sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True
sc.render.bake.margin = 6
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = 0.08
for o in bpy.context.scene.objects:
    o.select_set(False)
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type="DIFFUSE")

# keep only the low-poly mesh, export it
bpy.data.objects.remove(high, do_unlink=True)
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_apply=True, export_image_format="JPEG")
print("EXPORTED", dst)
