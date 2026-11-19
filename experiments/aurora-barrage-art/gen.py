#!/usr/bin/env python3 -I
"""Aurora Barrage art: submit Meshy text-to-image tasks, poll, download to raw/.

No API key handling: in the cloud sandbox the proxy authenticates api.meshy.ai,
elsewhere set up your own proxy/key and add the header below.
Usage: python3 -I gen.py [name ...]   (default: every missing asset)
"""
import json, os, subprocess, sys, time, urllib.request

API = "https://api.meshy.ai/openapi/v1/text-to-image"
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
STYLE = ("polished stylized sci-fi arcade game sprite, top-down orthographic view, "
         "symmetrical, crisp clean hard-surface detail, rich saturated colour, glowing emissive parts, "
         "isolated on plain white background, no text, no shadow, no ground")

ASSETS = {
  # player was generated first as a test (task 01a1f25d-aea5-73c0-af29-cc630c41db08)
  "scout": dict(rm=True, ar="1:1", prompt=
    "small fast alien dart fighter drone, nose pointing straight down, sharp swept-forward wings, "
    "crimson red and black hull with glowing orange engine ports and a single orange eye-like cockpit, "
    "compact aggressive silhouette, " + STYLE),
  "gunship": dict(rm=True, ar="1:1", prompt=
    "medium alien gunship, nose pointing straight down, wide crescent wings carrying two forward cannons, "
    "deep purple and gunmetal hull with glowing magenta energy lines and toxic green cockpit glow, "
    "bulky armoured mid-section, " + STYLE),
  "bomber": dict(rm=True, ar="1:1", prompt=
    "heavy armoured alien bomber cruiser, nose pointing straight down, broad blocky armoured hull with "
    "layered plating and a large central cannon, gold and dark teal hull with glowing amber vents and "
    "bomb bays, imposing and slow-looking, " + STYLE),
  "boss": dict(rm=True, ar="1:1", prompt=
    "colossal alien dreadnought mothership boss, nose pointing straight down, enormous symmetrical "
    "biomechanical hull with a huge glowing red core in the centre, multiple turret pods on swept "
    "wing arms, black and crimson armour with glowing red and white energy veins, menacing, "
    "highly detailed, " + STYLE),
  "bg": dict(rm=False, ar="9:16", prompt=
    "vertical deep space scene seen from above, dark indigo and violet nebula clouds with teal and magenta "
    "wisps, scattered tiny stars, a distant ringed planet and faint cosmic dust, painterly game background, "
    "dark enough that bright sprites stand out, low contrast, no ships, no text, no frame, no border"),
}

def curl(*a):
    return subprocess.run(["curl", "-sS", "-m", "60", *a], capture_output=True, text=True, check=True).stdout

def submit(name, d):
    body = {"ai_model": "nano-banana-2", "prompt": d["prompt"], "aspect_ratio": d["ar"]}
    if d["rm"]: body["remove_background"] = True
    out = curl("-X", "POST", API, "-H", "Content-Type: application/json", "-d", json.dumps(body))
    tid = json.loads(out)["result"]
    print(name, "->", tid, flush=True)
    return tid

def main():
    want = sys.argv[1:] or [n for n in ASSETS if not os.path.exists(f"{RAW}/{n}.png")]
    ids = {n: submit(n, ASSETS[n]) for n in want}
    json.dump(ids, open(f"{HERE}/task_ids_{int(time.time())}.json", "w"), indent=1)
    pending = dict(ids)
    while pending:
        time.sleep(8)
        for n, tid in list(pending.items()):
            t = json.loads(curl(f"{API}/{tid}"))
            if t["status"] == "SUCCEEDED":
                urllib.request.urlretrieve(t["image_urls"][0], f"{RAW}/{n}.png")
                print("saved", n, flush=True); del pending[n]
            elif t["status"] in ("FAILED", "CANCELED"):
                print("FAILED", n, t.get("task_error")); del pending[n]

main()
