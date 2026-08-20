# 3D Models Directory (`public/models/`)

This directory is the recommended location for binary 3D model assets (`.glb` / `.gltf`) in Vite + Babylon.js.

### Why `public/models/`?
- Files placed here are served as static assets at `/models/<filename>.glb` during development (`npm run dev`).
- During production build (`npm run build`), they are copied directly into `dist/models/` without bundle overhead or memory duplication.
- Works seamlessly with Babylon's `SceneLoader.ImportMeshAsync()` and `SceneLoader.AppendAsync()`.

### Usage Example:
```typescript
import { SceneLoader } from '@babylonjs/core'
import '@babylonjs/loaders'

// Load a model from public/models/chair.glb
const result = await SceneLoader.ImportMeshAsync(
  '',
  '/models/',
  'chair.glb',
  scene
)

const rootMesh = result.meshes[0]
rootMesh.position.set(0, 0, 0)
```
