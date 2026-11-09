"""Step 2: concept image -> textured low-poly model (Meshy image-to-3d, smart topology).

Usage: python3 -I to3d.py models.json CONCEPT_DIR OUT_DIR [name ...]
Reads CONCEPT_DIR/<name>.img.json (the text-to-image task) and writes
OUT_DIR/<name>.glb + OUT_DIR/<name>.3d.json. At most 8 tasks run at once
(Meshy caps pending tasks per account).
"""
import json, os, subprocess, sys, threading

MESHY = ["npm", "exec", "--yes", "--package=meshy-cli@0.4.0", "--", "meshy"]
FLAGS = ["--output-schema", "v1", "--format", "json", "--no-update-check"]
TEX = "hand-painted cartoon style, soft pastel colors, clean simple painted details"
gate = threading.Semaphore(8)


def run(m, cdir, out):
    env = dict(os.environ, MESHY_API_KEY="proxy-injected", NODE_USE_ENV_PROXY="1")
    img = json.load(open(os.path.join(cdir, m["name"] + ".img.json")))
    src = img["result"]["task"]["task_id"]
    with gate:
        r = subprocess.run(MESHY + ["image-to-3d", "create", "--input-task-id", src, "--model-type", "smart-topology",
                                    "--target-polycount", str(m.get("poly", 3000)), "--should-texture", "true",
                                    "--enable-pbr", "false", "--texture-resolution", "2k", "--texture-prompt", TEX,
                                    "--timeout", "1500"] + FLAGS, capture_output=True, text=True, env=env)
    try:
        d = json.loads(r.stdout)
    except Exception:
        print(m["name"], "bad output", r.stdout[-300:], r.stderr[-300:], flush=True)
        return
    json.dump(d, open(os.path.join(out, m["name"] + ".3d.json"), "w"), indent=1)
    if not d.get("ok"):
        print(m["name"], "failed", d.get("error"), flush=True)
        return
    t = d["result"]["task"]
    print(m["name"], t.get("task_id"), t.get("status"), t.get("face_count"), t.get("consumed_credits"), flush=True)
    url = (t.get("model_urls") or {}).get("glb")
    if url:
        subprocess.check_call(["curl", "-sS", "--retry", "3", "-o", os.path.join(out, m["name"] + ".glb"), url])


def main():
    models = json.load(open(sys.argv[1]))
    cdir, out = sys.argv[2], sys.argv[3]
    only = set(sys.argv[4:])
    os.makedirs(out, exist_ok=True)
    th = [threading.Thread(target=run, args=(m, cdir, out)) for m in models if not only or m["name"] in only]
    for t in th:
        t.start()
    for t in th:
        t.join()


if __name__ == "__main__":
    main()
