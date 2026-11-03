# balance simulations: thousands of headless bot-vs-bot 1v1 matches (tools/balance.js), one side
# changed (a building banned or the only one allowed, a perk), the other the normal bot.
# win share > 50% = the change makes a bot stronger. also prints a price-vs-impact table.
# usage: python tools/balance.py [buildings|perks|all] [--seeds N] [--maps N] [--set farm.cost=40 ...]
#   --set changes a price or effect for both sides (e.g. to test a new price before editing config.js)
import argparse
import asyncio
import json
import socket
import subprocess
import sys
import re
import time
from pathlib import Path

from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8")
root = Path(__file__).resolve().parent.parent

ap = argparse.ArgumentParser()
ap.add_argument("suite", nargs="?", default="all", choices=["buildings", "perks", "all"])
ap.add_argument("--seeds", type=int, default=4, help="games per map and personality")
ap.add_argument("--maps", type=int, default=12)
ap.add_argument("--cells", type=int, default=15)
ap.add_argument("--pages", type=int, default=4, help="parallel browser pages")
ap.add_argument("--set", nargs="*", default=[], help="price/effect overrides, e.g. farm.cost=40 farmGrowth=0.5")
ap.add_argument("--out", default=None, help="json results file")
args = ap.parse_args()

# --set: building.field=value goes to buildings, plain name=value to effects (or rules if it's a rule)
overrides = {"buildings": {}, "effects": {}, "rules": {}}
for kv in args.set:
    k, v = kv.split("=")
    if "." in k:
        b, f = k.split(".")
        overrides["buildings"].setdefault(b, {})[f] = float(v)
    elif k in ("growthRate", "capMax", "armySpeed", "startTroops", "timeScale"):
        overrides["rules"][k] = float(v)
    else:
        overrides["effects"][k] = float(v)

blds = ["farm", "barracks", "fort", "hospital", "lab"]
perk_ids = ["march", "veterans", "granary", "healers", "scholars", "fertile", "engineers",
            "conscription", "walls", "recruiters", "plunder", "masons"]

# variants: baseline (normal vs normal, should land near 50%), no buildings, each building banned,
# each building the only one; perks in a conquest-like start (capitals with 600 foglets, camps)
variants = []
if args.suite in ("buildings", "all"):
    variants.append({"label": "baseline (normal vs normal)", "group": "buildings"})
    variants.append({"label": "no buildings", "allow": [], "group": "buildings"})
    for b in blds:
        variants.append({"label": f"no {b}", "allow": [x for x in blds if x != b], "group": "ban", "b": b})
    for b in blds:
        variants.append({"label": f"only {b}", "allow": [b], "group": "only", "b": b})
if args.suite in ("perks", "all"):
    variants.append({"label": "perk baseline (no perk)", "capital": 600, "group": "perks"})
    for p in perk_ids:
        variants.append({"label": f"perk {p}", "perk": p, "capital": 600, "group": "perks"})
for v in variants:
    v["overrides"] = overrides


async def main():
    with socket.socket() as s:
        s.bind(("localhost", 0))
        port = s.getsockname()[1]
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=root,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    t0 = time.time()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            queue = asyncio.Queue()
            for v in variants:
                queue.put_nowait(v)
            results, stats = [], {}

            async def worker(i):
                page = await browser.new_page()
                page.on("pageerror", lambda e: print("page error:", e))
                await page.goto(f"http://localhost:{port}/tools/")
                await page.evaluate("async ([n, c]) => { window.bal = await import('/tools/balance.js'); window.bal.makePool(n, c); }", [args.maps, args.cells])
                if i == 0:
                    stats.update(await page.evaluate("() => bal.poolStats()"))
                while not queue.empty():
                    v = queue.get_nowait()
                    r = await page.evaluate("([v, o]) => bal.run(v, o)", [v, {"seeds": args.seeds}])
                    r.update({k: v[k] for k in ("group", "b") if k in v})
                    results.append(r)
                    print(f"  {r['label']:<30} {r['score'] / r['games']:6.1%}  ({r['games']} games, {time.time() - t0:.0f}s)", flush=True)

            await asyncio.gather(*(worker(i) for i in range(args.pages)))
            await browser.close()
    finally:
        server.terminate()

    order = {v["label"]: i for i, v in enumerate(variants)}
    results.sort(key=lambda r: order[r["label"]])
    report(results, stats)
    if args.out:
        Path(args.out).write_text(json.dumps({"stats": stats, "results": results, "overrides": overrides}, indent=1), encoding="utf-8")


def report(results, stats):
    # win share with a rough 95% margin (binomial); built = buildings the variant had at the end per game
    print(f"\n{'variant':<30} {'win':>6} {'±':>5} {'avg s':>6}  buildings at end (per game)")
    for r in results:
        n = r["games"]
        w = r["score"] / n
        m = 1.96 * (w * (1 - w) / n) ** 0.5
        built = ", ".join(f"{k} {c / n:.1f}" for k, c in sorted(r["built"].items(), key=lambda x: -x[1]))
        print(f"{r['label']:<30} {w:6.1%} {m:5.1%} {r['time'] / n:6.0f}  {built}")
    if stats:
        price_table(stats)


def price_table(st):
    # price vs impact from config.js numbers and the map pool's typical tiles. growth is 1% of a
    # tile's cap per game second; payback = cost / extra foglets per second (real s = game s / 0.8)
    cfg = (root / "js" / "config.js").read_text(encoding="utf-8")
    num = lambda name: float(re.search(rf"{name}:\s*([\d.]+)", cfg).group(1))
    cost = {b: float(re.search(rf"{b}:\s*{{[^}}]*cost:\s*(\d+)", cfg).group(1)) for b in blds}
    for b, f in overrides["buildings"].items():
        cost[b] = f.get("cost", cost[b])
    eff = {k: overrides["effects"].get(k, num(k)) for k in ("farmGrowth", "hospitalGrowth", "labGrowth", "barracksAttack", "fortDefense")}
    rate, ts = num("growthRate"), num("timeScale")
    cap, adj = st["capMedian"], st["adjCapMedian"]
    print(f"\nprice vs impact (median tile cap {cap}, median cap next to a tile {adj}, {st['tiles']} tiles in the pool)")
    rows = [
        ("farm", f"+{eff['farmGrowth']:.0%} of own growth = +{eff['farmGrowth'] * rate * cap:.2f}/s", cost["farm"] / (eff["farmGrowth"] * rate * cap)),
        ("hospital", f"+{eff['hospitalGrowth']:.0%} on owned neighbours = +{eff['hospitalGrowth'] * rate * adj:.2f}/s (all owned)", cost["hospital"] / (eff["hospitalGrowth"] * rate * adj)),
        ("lab (5 tiles)", f"+{eff['labGrowth']:.0%} everywhere = +{eff['labGrowth'] * rate * cap * 5:.2f}/s", cost["lab"] / (eff["labGrowth"] * rate * cap * 5)),
        ("lab (12 tiles)", f"+{eff['labGrowth']:.0%} everywhere = +{eff['labGrowth'] * rate * cap * 12:.2f}/s", cost["lab"] / (eff["labGrowth"] * rate * cap * 12)),
    ]
    print(f"{'building':<15} {'cost':>5}  {'impact':<52} {'payback':>8}")
    for name, what, secs in rows:
        print(f"{name:<15} {cost[name.split()[0]]:>5.0f}  {what:<52} {secs / ts:6.0f} s")
    for name, k in (("barracks", "barracksAttack"), ("fort", "fortDefense")):
        extra = eff[k] - 1
        print(f"{name:<15} {cost[name]:>5.0f}  {'x' + str(eff[k]) + ' = +' + format(extra, '.0%') + ' per foglet':<52} pays after {cost[name] / extra:.0f} foglets {'sent' if name == 'barracks' else 'defending'}")


asyncio.run(main())
