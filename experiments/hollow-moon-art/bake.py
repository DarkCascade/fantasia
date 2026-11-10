#!/usr/bin/env python3
"""Hollow Moon art bake (pip install pygltflib pillow).
  bake.py char <meshy rigged.glb> <out.glb> [texsize]  -> mesh + skeleton, base-colour JPEG only, no clips
  bake.py anim <meshy animation.glb> <out.glb>         -> nodes + first animation only (no mesh/texture)
Run with python3 -I on downloaded files."""
import sys, io, struct
from pygltflib import GLTF2, Buffer, BufferView, Accessor, Image as GImage, Texture, TextureInfo
from PIL import Image

NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
CSIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}

def main():
    mode, src, dst = sys.argv[1:4]
    g = GLTF2().load(src); blob = g.binary_blob()
    out = bytearray(); views = []; accs = []; amap = {}

    def add_view(data, target=None):
        while len(out) % 4: out.append(0)
        views.append(BufferView(buffer=0, byteOffset=len(out), byteLength=len(data), target=target))
        out.extend(data); return len(views) - 1

    def acc(i, target=None):
        if i is None: return None
        if i in amap: return amap[i]
        a = g.accessors[i]; bv = g.bufferViews[a.bufferView]
        size = NCOMP[a.type] * CSIZE[a.componentType]; stride = bv.byteStride or size
        base = (bv.byteOffset or 0) + (a.byteOffset or 0)
        data = b"".join(blob[base + k * stride: base + k * stride + size] for k in range(a.count)) if stride != size else blob[base: base + a.count * size]
        v = add_view(data, target)
        accs.append(Accessor(bufferView=v, byteOffset=0, componentType=a.componentType, count=a.count, type=a.type, max=a.max, min=a.min, normalized=a.normalized))
        amap[i] = len(accs) - 1; return amap[i]

    if mode == "anim":
        g.animations = g.animations[:1]
        for s in g.animations[0].samplers: s.input = acc(s.input); s.output = acc(s.output)
        for n in g.nodes: n.mesh = None; n.skin = None
        g.meshes = []; g.skins = []; g.materials = []; g.textures = []; g.images = []; g.samplers = []
    else:
        size = int(sys.argv[4]) if len(sys.argv) > 4 else 1024
        g.animations = []
        tris = 0
        for m in g.meshes:
            for p in m.primitives:
                at = p.attributes
                for k in ("POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"):
                    if getattr(at, k) is not None: setattr(at, k, acc(getattr(at, k), 34962))
                at.TANGENT = None; at.COLOR_0 = None; at.TEXCOORD_1 = None
                tris += g.accessors[p.indices].count // 3
                p.indices = acc(p.indices, 34963)
        for s in g.skins: s.inverseBindMatrices = acc(s.inverseBindMatrices)
        imgs = []; imap = {}
        for mat in g.materials:
            pbr = mat.pbrMetallicRoughness
            mat.normalTexture = None; mat.occlusionTexture = None; mat.emissiveTexture = None
            if pbr:
                pbr.metallicRoughnessTexture = None; pbr.metallicFactor = 0.0; pbr.roughnessFactor = 0.8
                if pbr.baseColorTexture is not None:
                    src_i = g.textures[pbr.baseColorTexture.index].source
                    if src_i not in imap:
                        bv = g.bufferViews[g.images[src_i].bufferView]
                        im = Image.open(io.BytesIO(blob[bv.byteOffset or 0:(bv.byteOffset or 0) + bv.byteLength])).convert("RGB")
                        im = im.resize((size, size), Image.LANCZOS); b = io.BytesIO(); im.save(b, "JPEG", quality=84)
                        imgs.append(GImage(bufferView=add_view(b.getvalue()), mimeType="image/jpeg")); imap[src_i] = len(imgs) - 1
                    pbr.baseColorTexture = TextureInfo(index=imap[src_i])
        g.images = imgs; g.textures = [Texture(source=i, sampler=0 if g.samplers else None) for i in range(len(imgs))]
        print("tris", tris)
    g.accessors = accs; g.bufferViews = views
    g.buffers = [Buffer(byteLength=len(out))]; g.set_binary_blob(bytes(out)); g.save_binary(dst)
    print(dst, len(out) // 1024, "KB")

main()
