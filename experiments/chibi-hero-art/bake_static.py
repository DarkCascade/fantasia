#!/usr/bin/env python3
"""Shrink a Meshy (smart-topology, textured) static GLB into the small foe GLB Chibi Crawl ships.

Usage: python3 -I bake_static.py <model.glb> <out.glb> [texture size, default 256]
  pip install pygltflib pillow numpy

Foes that are not humanoid (slimes, mushrooms...) are not rigged: the game squashes and hops the whole
mesh with its pose vector. So this keeps one mesh, drops everything but position / normal / uv /
indices, and bakes the base colour to a small JPEG. See bake_hero.py for the skinned version.
"""
import io
import os
import sys

import numpy as np
from PIL import Image
from pygltflib import (
    GLTF2, Accessor, Asset, Buffer, BufferView, Image as GImage, Material, Mesh, Node,
    PbrMetallicRoughness, Primitive, Attributes, Sampler, Scene, Texture, TextureInfo,
    ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER,
)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
from bake_hero import read_accessor  # noqa: E402

FLOAT, USHORT, UINT = 5126, 5123, 5125


def world_matrix(g, target):
    """Compose node transforms down to the first node carrying a mesh (Meshy may nest it)."""
    def walk(i, m):
        n = g.nodes[i]
        t = np.eye(4)
        if n.matrix:
            t = np.array(n.matrix).reshape(4, 4).T
        else:
            if n.scale:
                t = t @ np.diag(list(n.scale) + [1])
            if n.rotation:
                x, y, z, w = n.rotation
                r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
                              [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
                              [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
                              [0, 0, 0, 1]])
                t = r @ t
            if n.translation:
                tr = np.eye(4)
                tr[:3, 3] = n.translation
                t = tr @ t
        m = m @ t
        if n.mesh is not None:
            return m
        for c in n.children or []:
            r = walk(c, m)
            if r is not None:
                return r
        return None
    for root in g.scenes[0].nodes:
        r = walk(root, np.eye(4))
        if r is not None:
            return r
    return np.eye(4)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 256
    g = GLTF2().load(src)
    blob = g.binary_blob()
    prim = g.meshes[0].primitives[0]
    pos = read_accessor(g, blob, prim.attributes.POSITION).astype(np.float32)
    nrm = read_accessor(g, blob, prim.attributes.NORMAL).astype(np.float32)
    uv = read_accessor(g, blob, prim.attributes.TEXCOORD_0).astype(np.float32)
    idx = read_accessor(g, blob, prim.indices).astype(np.uint32).reshape(-1)
    m = world_matrix(g, None)
    pos = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3].astype(np.float32)
    nrm = (nrm @ np.linalg.inv(m[:3, :3]))  # inverse-transpose for row vectors
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-8)
    nrm = nrm.astype(np.float32)
    # stand on y = 0, centred in x / z
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    pos -= np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2], dtype=np.float32)

    tex_idx = g.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index
    im = g.images[g.textures[tex_idx].source]
    bv = g.bufferViews[im.bufferView]
    raw = blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength]
    pic = Image.open(io.BytesIO(raw)).convert("RGB").resize((size, size), Image.LANCZOS)
    jb = io.BytesIO()
    pic.save(jb, "JPEG", quality=86, optimize=True)
    jpeg = jb.getvalue()

    out = GLTF2()
    out.asset = Asset(version="2.0", generator="chibi-crawl bake_static.py")
    chunks, offset = [], 0

    def add_view(data, target=None):
        nonlocal offset
        pad = (-len(data)) % 4
        out.bufferViews.append(BufferView(buffer=0, byteOffset=offset, byteLength=len(data), target=target))
        chunks.append(data + b"\0" * pad)
        offset += len(data) + pad
        return len(out.bufferViews) - 1

    def add(arr, ctype, atype, target, minmax=False):
        bvi = add_view(arr.tobytes(), target)
        acc = Accessor(bufferView=bvi, byteOffset=0, componentType=ctype, count=arr.shape[0], type=atype)
        if minmax:
            acc.min = [float(x) for x in arr.min(axis=0)]
            acc.max = [float(x) for x in arr.max(axis=0)]
        out.accessors.append(acc)
        return len(out.accessors) - 1

    a_pos = add(pos, FLOAT, "VEC3", ARRAY_BUFFER, True)
    a_nrm = add(nrm, FLOAT, "VEC3", ARRAY_BUFFER)
    a_uv = add(uv, FLOAT, "VEC2", ARRAY_BUFFER)
    if len(pos) < 65536:
        a_idx = add(idx.astype(np.uint16), USHORT, "SCALAR", ELEMENT_ARRAY_BUFFER)
    else:
        a_idx = add(idx, UINT, "SCALAR", ELEMENT_ARRAY_BUFFER)
    bvi = add_view(jpeg)
    out.images.append(GImage(bufferView=bvi, mimeType="image/jpeg", name="baseColor"))
    out.samplers.append(Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071))
    out.textures.append(Texture(source=0, sampler=0))
    out.materials.append(Material(name="foe", doubleSided=True, pbrMetallicRoughness=PbrMetallicRoughness(
        baseColorTexture=TextureInfo(index=0), metallicFactor=0.0, roughnessFactor=1.0)))
    out.meshes.append(Mesh(name="foe", primitives=[Primitive(
        attributes=Attributes(POSITION=a_pos, NORMAL=a_nrm, TEXCOORD_0=a_uv), indices=a_idx, material=0)]))
    out.nodes.append(Node(name="foe", mesh=0))
    out.scenes.append(Scene(nodes=[0]))
    out.scene = 0
    out.buffers.append(Buffer(byteLength=offset))
    out.set_binary_blob(b"".join(chunks))
    out.save_binary(dst)
    h = pos.max(axis=0) - pos.min(axis=0)
    print(f"{dst}: {offset // 1024} KB ({len(idx) // 3} tris, {len(pos)} verts, {size}px, size {h[0]:.2f} x {h[1]:.2f} x {h[2]:.2f})")


if __name__ == "__main__":
    main()
