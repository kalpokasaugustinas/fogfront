# headless smoke test: serves the game, checks for js errors, runs bot-only battles
# to see that they finish, plays a few player moves and saves screenshots.
# usage: python tools/smoke_test.py [screenshot_dir]
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else root / "tools" / "shots")
out.mkdir(parents=True, exist_ok=True)

# pick a free port (a fixed one may already be taken by another local server)
with socket.socket() as s:
    s.bind(("localhost", 0))
    port = s.getsockname()[1]

server = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=root,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []

# bot-vs-bot battles: 4 ai factions on random maps, report how long each takes and who wins
sim_js = """async () => {
  const { generateMap } = await import('./js/mapgen.js');
  const { Battle } = await import('./js/battle.js');
  const { personalities } = await import('./js/ai.js');
  const types = Object.keys(personalities), res = [];
  for (let i = 0; i < 12; i++) {
    const map = generateMap({ seed: 100 + i, cells: 22, grid: 480 });
    const factions = [0, 1, 2, 3].map((c) => ({ ai: true, color: c, think: 2, personality: personalities[types[(i + c) % 3]] }));
    const b = new Battle(map, { seed: i, factions, neutral: [8, 28] });
    const t0 = performance.now();
    b.simulate(1200);
    const owners = b.segs.map((s) => s.owner);
    res.push({ seed: 100 + i, segs: map.segs.length, state: b.state, time: Math.round(b.time),
      ms: Math.round(performance.now() - t0),
      buildings: b.segs.filter((s) => s.building).length,
      left: [0, 1, 2, 3].map((f) => owners.filter((o) => o === f).length) });
  }
  return res;
}"""

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, vp in [("portrait", {"width": 390, "height": 844}), ("landscape", {"width": 1280, "height": 720})]:
            page = browser.new_page(viewport=vp, device_scale_factor=2 if name == "portrait" else 1)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(f"http://localhost:{port}/index.html")
            page.wait_for_timeout(500)
            page.screenshot(path=str(out / f"{name}-menu.png"))

            if name == "portrait":
                t0 = time.time()
                res = page.evaluate(sim_js)
                print(f"bot battles ({time.time() - t0:.1f}s):")
                for r in res:
                    print("  ", json.dumps(r))

            # campaign map
            page.click("#btn-campaign")
            page.wait_for_timeout(300)
            home = page.evaluate("__fl.campaign.map.segs.find(s => __fl.campaign.attackable(s.id)).id")
            box = page.locator("#campaign-canvas").bounding_box()
            seg = page.evaluate(f"__fl.campaign.map.segs[{home}]")
            g = page.evaluate("__fl.campaign.map.grid")
            page.mouse.click(box["x"] + seg["x"] / g * box["width"], box["y"] + seg["y"] / g * box["height"])
            page.wait_for_timeout(200)
            page.screenshot(path=str(out / f"{name}-campaign.png"))

            # start that region's battle, then play: select own segment, attack a neighbour
            page.click("#attack-btn")
            page.wait_for_timeout(400)
            b = page.evaluate("""(() => { const b = __fl.battle; const me = b.segs.find(s => s.owner === 0);
                return { me: me.id, x: me.x, y: me.y, target: b.segs[me.adj[0]] }; })()""")
            box = page.locator("#battle-canvas").bounding_box()
            bg = page.evaluate("__fl.battle.map.grid")
            to_px = lambda x, y: (box["x"] + x / bg * box["width"], box["y"] + y / bg * box["height"])
            page.wait_for_timeout(3000)   # let troops grow a bit
            page.mouse.click(*to_px(b["x"], b["y"]))
            page.click("#build .bld[data-type=farm]")
            page.mouse.click(*to_px(b["target"]["x"], b["target"]["y"]))
            page.wait_for_timeout(300)
            state = page.evaluate("({ my_armies: __fl.battle.armies.filter(a => a.owner === 0).length, orders: __fl.battle.stats.sent, building: __fl.battle.segs[%d].building })" % b["me"])
            print(f"{name}: after tap attack + farm -> {state}")
            page.screenshot(path=str(out / f"{name}-battle.png"))
            # tap-to-move: give the player a 2nd neighbouring segment, then tap it while home is selected
            mv = page.evaluate("""(() => { const b = __fl.battle, me = b.segs[%d];
                const n = b.segs[me.adj[me.adj.length - 1]]; n.owner = 0; me.troops = 40; b.version++;
                return { id: n.id, x: n.x, y: n.y }; })()""" % b["me"])
            page.wait_for_timeout(100)
            page.mouse.click(*to_px(mv["x"], mv["y"]))
            moved = page.evaluate("__fl.battle.armies.some(a => a.owner === 0 && a.to === %d)" % mv["id"])
            print(f"{name}: tap own neighbour moves troops -> {moved}")
            # fast-forward to the end and show the result card
            page.evaluate("__fl.battle.simulate(1500)")
            page.wait_for_timeout(300)
            page.screenshot(path=str(out / f"{name}-end.png"))
            print(f"{name}: battle state after fast-forward = {page.evaluate('__fl.battle.state')}")
            page.close()
        browser.close()
finally:
    server.terminate()

print("js errors:", errors or "none")
print("screenshots:", out)
