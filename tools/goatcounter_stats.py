# usage: python tools/goatcounter_stats.py [out.json]   (token file: D:/Projects/Personal/goatcounter-token.txt, read-only, never in the repo)
# goatcounter stats for fogtide (site 'fogfront'): totals, pages + events, referrers, browsers,
# systems, screen sizes, countries. the token is read from a private file and never printed
import json, sys, urllib.request, urllib.parse
from datetime import date, timedelta

token = open(r"D:\Projects\Personal\goatcounter-token.txt", encoding="utf-8").read().strip()
base = "https://fogfront.goatcounter.com/api/v0"
start = (date.today() - timedelta(days=60)).isoformat()
end = (date.today() + timedelta(days=1)).isoformat()


def get(path, **q):
    q = {"start": start, "end": end, **q}
    req = urllib.request.Request(f"{base}{path}?{urllib.parse.urlencode(q)}",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()[:300]}


out = {
    "total": get("/stats/total"),
    "hits": get("/stats/hits", limit=100),
    "refs": get("/stats/toprefs", limit=20),
    "browsers": get("/stats/browsers", limit=10),
    "systems": get("/stats/systems", limit=10),
    "sizes": get("/stats/sizes", limit=10),
    "locations": get("/stats/locations", limit=15),
}
if len(sys.argv) > 1: json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), indent=1)
# compact summary
t = out["total"]
print("total:", {k: v for k, v in t.items() if k != "stats"} if isinstance(t, dict) else t)
if isinstance(t, dict) and t.get("stats"):
    print("by day:", [(d["day"], d["daily"]) for d in t["stats"] if d.get("daily")])
h = out["hits"]
if "hits" in h:
    for x in h["hits"]:
        print(f"  {'E' if x.get('event') else 'P'} {x['count']:5}  {x['path']}")
else:
    print("hits:", h)
for k in ("refs", "browsers", "systems", "sizes", "locations"):
    v = out[k]
    print(k + ":", [(s.get("name") or "(none)", s.get("count")) for s in v.get("stats", [])] if "stats" in v else v)
