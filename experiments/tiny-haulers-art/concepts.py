"""Step 1: one Meshy concept image per model (text-to-image, nano-banana-2).

Usage: python3 -I concepts.py models.json OUT_DIR [name ...]
Writes OUT_DIR/<name>.png and OUT_DIR/<name>.img.json (task id). Uses the
pinned Meshy CLI; the API key is injected by the session's proxy.
"""
import json, os, subprocess, sys, threading

STYLE = ("A clean 3D game asset render of {s}. Cute chibi toy-like style, chunky rounded proportions, "
         "soft hand-painted pastel colors, smooth simple shapes, three-quarter front view from slightly above, "
         "the whole object visible and centered, isolated on a plain white background. "
         "No ground, no base, no platform, no shadow, no text.")
MESHY = ["npm", "exec", "--yes", "--package=meshy-cli@0.4.0", "--", "meshy"]
FLAGS = ["--output-schema", "v1", "--format", "json", "--no-update-check"]


def run(m, out):
    env = dict(os.environ, MESHY_API_KEY="proxy-injected", NODE_USE_ENV_PROXY="1")
    r = subprocess.run(MESHY + ["text-to-image", "create", "--ai-model", "nano-banana-2", "--prompt", STYLE.format(s=m["subject"])] + FLAGS,
                       capture_output=True, text=True, env=env)
    try:
        d = json.loads(r.stdout)
    except Exception:
        print(m["name"], "bad output", r.stdout[-400:], r.stderr[-400:], flush=True)
        return
    json.dump(d, open(os.path.join(out, m["name"] + ".img.json"), "w"), indent=1)
    task = d.get("result", {}).get("task", {}) if isinstance(d.get("result"), dict) else {}
    urls = task.get("image_urls") or []
    tid = task.get("task_id")
    print(m["name"], tid, task.get("status"), flush=True)
    if urls:
        subprocess.check_call(["curl", "-sS", "--retry", "3", "-o", os.path.join(out, m["name"] + ".png"), urls[0]])


def main():
    models = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(out, exist_ok=True)
    th = [threading.Thread(target=run, args=(m, out)) for m in models if not only or m["name"] in only]
    for t in th:
        t.start()
    for t in th:
        t.join()


if __name__ == "__main__":
    main()
