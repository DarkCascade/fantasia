# Hollow Moon art (Meshy)

Hero and boss for `src/hollow-moon.js`. Made through the Meshy REST API (the session proxy holds the key).
Total spend: **109 credits** (2 previews 40, 2 refines 20, 2 rigs 10, 13 animations 39).

## Pipeline
1. `POST /openapi/v2/text-to-3d` `{mode:"preview", ai_model:"meshy-6", pose_mode:"a-pose", should_remesh:true,
   topology:"triangle", target_polycount:14000|16000, prompt}`
2. `POST /openapi/v2/text-to-3d` `{mode:"refine", preview_task_id, enable_pbr:false}`
3. `POST /openapi/v1/rigging` `{input_task_id:<refine>, height_meters}` (also returns walking / running clips)
4. `POST /openapi/v1/animations` `{rig_task_id, action_id}` per clip (ids from `meshy animation-catalog list --search ...`)
5. `python3 -I bake.py char rigged.glb ../../src/hollow-moon/<kind>.glb 1024` (mesh + skeleton, base colour JPEG only)
   and `python3 -I bake.py anim clip.glb ../../src/hollow-moon/<kind>-<name>.glb` (nodes + one animation, 20-150 KB).

## Prompts
- **hero**: A lone wandering duelist swordswoman, slender athletic build, short silver-white hair, fitted dark indigo
  tunic with pale silver pauldron and bracers, cloth leg wraps, leather boots, moon crescent emblem on chest, elegant
  stylized painterly fantasy game character, full body, standing in A-pose, empty open hands, no weapon, no cape, no cloak
- **foe**: A towering undead knight boss wearing a stag skull helmet with large branching antlers, heavy tattered black
  iron plate armor overgrown with moss and pale bone ribs, huge broad shoulders, long arms, hollow eye sockets, stylized
  painterly dark fantasy game boss character, humanoid, full body, standing in A-pose, empty open hands, no weapon, no cape
  (Meshy ignored the antlers and added a cape; the antlers in game are primitives on the head bone.)

## Task ids
| | preview | refine | rig |
|---|---|---|---|
| hero | 01a1c34a-8208-7420-a0d2-3e579abc7f51 | 01a1c34b-b814-757f-83be-b6102e146113 | 01a1c352-cd54-7206-8c75-7fe0b8baf350 |
| foe | 01a1c34a-8a5e-71c3-a9b8-df93588bfcc9 | 01a1c352-cc99-74cb-b0da-3cd133b64b71 | 01a1c354-12a9-70d1-859e-fd1d50fef493 |

Animation action ids. Hero: idle 89 (Combat Idle), slash1 97 (Left Slash), slash2 219 (Right-hand Sword Slash),
slash3 242 (Charged Slash), dash 384 (Quick Step and Spin Dodge), hit 178, death 189, run = rig's running clip.
Foe: idle 89, walk 119 (Slow Orc Walk), sweep 128 (Heavy Hammer Swing), leap 86 (Jump Attack), roar 386
(Zombie Scream), death 188, run = rig's running clip.
