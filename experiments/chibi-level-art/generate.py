import json, sys, time, subprocess, urllib.request
API="https://api.meshy.ai/openapi/v2/text-to-3d"
def call(method, url, body=None):
    cmd=["curl","-sS","-X",method,url,"-H","Content-Type: application/json"]
    if body is not None: cmd+=["-d",json.dumps(body)]
    return json.loads(subprocess.check_output(cmd))
def wait(tid):
    while True:
        r=call("GET",f"{API}/{tid}")
        if r["status"] in("SUCCEEDED","FAILED","CANCELED"): return r
        time.sleep(6)
name, prompt = sys.argv[1], sys.argv[2]
tex = sys.argv[3] if len(sys.argv)>3 else None
r=call("POST",API,{"mode":"preview","prompt":prompt,"ai_model":"meshy-6-lite","topology":"triangle","target_polycount":6000,"should_remesh":True})
print(name,"preview",r,flush=True)
pid=r["result"]; p=wait(pid)
print(name,p["status"],flush=True)
if p["status"]!="SUCCEEDED": print(p); sys.exit(1)
r=call("POST",API,{"mode":"refine","preview_task_id":pid,"enable_pbr":False,"texture_prompt":tex or prompt,"ai_model":"meshy-6-lite"})
print(name,"refine",r,flush=True)
t=wait(r["result"])
print(name,t["status"],flush=True)
if t["status"]!="SUCCEEDED": print(t); sys.exit(1)
json.dump(t,open(f"{name}.json","w"))
subprocess.check_call(["curl","-sS","-o",f"{name}.glb",t["model_urls"]["glb"]])
print(name,"saved",flush=True)
