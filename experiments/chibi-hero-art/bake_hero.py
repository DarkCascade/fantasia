#!/usr/bin/env python3
"""Shrink a Meshy rigged character GLB into the small hero GLB Chibi Crawl ships.

Usage: python3 -I bake_hero.py <rigged char.glb> <out.glb> [texture size, default 512]
  pip install pygltflib pillow numpy

Meshy's rigged export is ~7 MB: three 2K JPEGs (base colour, normal, metal/rough),
tangents, float32 weights. The game only needs the base colour (it re-shades the
mesh with its own toon material), so this keeps the node/skin hierarchy and the
mesh, drops everything else and repacks the buffer:
  POSITION/NORMAL/TEXCOORD_0 float32, JOINTS_0 uint8, WEIGHTS_0 normalised uint16,
  indices uint16, one baseColor JPEG downscaled to <size> px.
Animations are dropped too: the game drives the bones itself (see buildMeshyHero).
"""
import io
import sys

import numpy as np
from PIL import Image
from pygltflib import (
    GLTF2, Accessor, Asset, Buffer, BufferView, Image as GImage, Material, Mesh,
    Node, PbrMetallicRoughness, Primitive, Attributes, Sampler, Scene, Skin, Texture, TextureInfo,
    ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER,
)

FLOAT, UBYTE, USHORT = 5126, 5121, 5123


def read_accessor(g, blob, idx):
    a = g.accessors[idx]
    bv = g.bufferViews[a.bufferView]
    comps = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a.type]
    dt = {5126: np.float32, 5121: np.uint8, 5123: np.uint16, 5125: np.uint32}[a.componentType]
    start = (bv.byteOffset or 0) + (a.byteOffset or 0)
    stride = bv.byteStride or (np.dtype(dt).itemsize * comps)
    if stride == np.dtype(dt).itemsize * comps:
        return np.frombuffer(blob, dtype=dt, count=a.count * comps, offset=start).reshape(a.count, comps).copy()
    out = np.empty((a.count, comps), dtype=dt)
    for i in range(a.count):
        out[i] = np.frombuffer(blob, dtype=dt, count=comps, offset=start + i * stride)
    return out


def main():
    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    g = GLTF2().load(src)
    blob = g.binary_blob()
    prim = g.meshes[0].primitives[0]

    pos = read_accessor(g, blob, prim.attributes.POSITION).astype(np.float32)
    nrm = read_accessor(g, blob, prim.attributes.NORMAL).astype(np.float32)
    uv = read_accessor(g, blob, prim.attributes.TEXCOORD_0).astype(np.float32)
    jnt = read_accessor(g, blob, prim.attributes.JOINTS_0).astype(np.uint8)
    wgt = read_accessor(g, blob, prim.attributes.WEIGHTS_0).astype(np.float32)
    idx = read_accessor(g, blob, prim.indices).astype(np.uint16).reshape(-1)
    ibm = read_accessor(g, blob, g.skins[0].inverseBindMatrices).astype(np.float32)

    wgt = wgt / np.maximum(wgt.sum(axis=1, keepdims=True), 1e-8)
    w16 = np.clip(np.round(wgt * 65535), 0, 65535).astype(np.uint16)

    # base colour -> small JPEG
    tex_idx = g.materials[0].pbrMetallicRoughness.baseColorTexture.index
    img_idx = g.textures[tex_idx].source
    im = g.images[img_idx]
    bv = g.bufferViews[im.bufferView]
    raw = blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength]
    pic = Image.open(io.BytesIO(raw)).convert("RGB")
    pic = pic.resize((size, size), Image.LANCZOS)
    jb = io.BytesIO()
    pic.save(jb, "JPEG", quality=84, optimize=True)
    jpeg = jb.getvalue()

    out = GLTF2()
    out.asset = Asset(version="2.0", generator="chibi-crawl bake_hero.py")
    chunks = []
    offset = 0

    def add(arr, ctype, atype, target=None, minmax=False, normalized=False):
        nonlocal offset
        data = arr.tobytes()
        pad = (-len(data)) % 4
        bvi = len(out.bufferViews)
        out.bufferViews.append(BufferView(buffer=0, byteOffset=offset, byteLength=len(data), target=target))
        chunks.append(data + b"\0" * pad)
        offset += len(data) + pad
        count = arr.shape[0] if arr.ndim > 1 else arr.shape[0]
        acc = Accessor(bufferView=bvi, byteOffset=0, componentType=ctype, count=count, type=atype, normalized=normalized or None)
        if minmax:
            acc.min = [float(x) for x in arr.min(axis=0)]
            acc.max = [float(x) for x in arr.max(axis=0)]
        out.accessors.append(acc)
        return len(out.accessors) - 1

    a_pos = add(pos, FLOAT, "VEC3", ARRAY_BUFFER, minmax=True)
    a_nrm = add(nrm, FLOAT, "VEC3", ARRAY_BUFFER)
    a_uv = add(uv, FLOAT, "VEC2", ARRAY_BUFFER)
    a_jnt = add(jnt, UBYTE, "VEC4", ARRAY_BUFFER)
    a_wgt = add(w16, USHORT, "VEC4", ARRAY_BUFFER, normalized=True)
    a_idx = add(idx, USHORT, "SCALAR", ELEMENT_ARRAY_BUFFER)
    a_ibm = add(ibm.reshape(-1, 16), FLOAT, "MAT4")

    # image
    bvi = len(out.bufferViews)
    pad = (-len(jpeg)) % 4
    out.bufferViews.append(BufferView(buffer=0, byteOffset=offset, byteLength=len(jpeg)))
    chunks.append(jpeg + b"\0" * pad)
    offset += len(jpeg) + pad
    out.images.append(GImage(bufferView=bvi, mimeType="image/jpeg", name="baseColor"))
    out.samplers.append(Sampler(magFilter=9729, minFilter=9987, wrapS=33071, wrapT=33071))
    out.textures.append(Texture(source=0, sampler=0))
    out.materials.append(Material(name="hero", doubleSided=True, pbrMetallicRoughness=PbrMetallicRoughness(baseColorTexture=TextureInfo(index=0), metallicFactor=0.0, roughnessFactor=1.0)))

    out.meshes.append(Mesh(name=g.meshes[0].name, primitives=[Primitive(
        attributes=Attributes(POSITION=a_pos, NORMAL=a_nrm, TEXCOORD_0=a_uv, JOINTS_0=a_jnt, WEIGHTS_0=a_wgt),
        indices=a_idx, material=0)]))

    # nodes + skin + scene copied as they are (indices stay valid)
    for n in g.nodes:
        out.nodes.append(Node(name=n.name, mesh=n.mesh, skin=n.skin, rotation=n.rotation, translation=n.translation,
                              scale=n.scale, children=n.children or []))
    sk = g.skins[0]
    out.skins.append(Skin(name=sk.name, inverseBindMatrices=a_ibm, joints=sk.joints, skeleton=sk.skeleton))
    out.scenes.append(Scene(nodes=g.scenes[0].nodes))
    out.scene = 0
    out.buffers.append(Buffer(byteLength=offset))
    out.set_binary_blob(b"".join(chunks))
    out.save_binary(dst)
    print(f"{dst}: {offset // 1024} KB ({len(idx) // 3} tris, {len(pos)} verts, {size}px)")


if __name__ == "__main__":
    main()
