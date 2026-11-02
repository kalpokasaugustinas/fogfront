# Frontlines

A single-player territory strategy game for the browser (mobile later). Conquer a world map region by region. Each region is a battle against computer opponents on a map split into segments. Grow troops, build, and do the math on which fights to pick.

Prototype stage.

## How it plays
- **Campaign:** a generated world of ~34 regions: a continent with bays, mountain ranges and lakes, plus islands linked by sea routes. 4 rival empires hold the regions. Each region has a climate by location (snowy north, autumn east, moor west, summer south) that its battle uses. Attack any region next to one you own (or across a sea route). Difficulty grows with distance from home: more segments, more enemies, stronger neutrals, faster bots. Progress is saved in the browser.
- **🧭 Expedition (roguelite):** 5 stages that zoom out: Valley (5 km²) → Region → Country → Continent → World (510 million km²). Win a stage and everything you hold collapses into one capital on the next, bigger map:
  - the new capital is one tile with the outline of the island you just won, placed on the coast of the bigger map
  - all your people come along: the capital starts full (400), the rest is a reserve that flows in when there's room
  - buildings become capital bonuses = effect × share of your segments that had them (4 farms of 10 segments → +60% × 40% = +24% growth); nothing can be built in a capital, and old capital bonuses count as one segment, so they fade unless you build again
  - pick 1 of 3 perks at every zoom-out (12 in the pool: faster armies, cheaper buildings, stronger farms, plunder, ...)
  - bots scale with you: each starts with 10 + 70% of your carried people and its own capital with a shuffled bonus mix
  - lose a stage and the run is over; best run (stage reached, time) is saved
  - each stage looks further away: lakes, mountain ridges and trees get smaller and more numerous
- **Battle:** each segment you own grows 1% of its cap per second, up to the cap. Cap scales with segment size: the largest segment on the map holds 400 (+4/s).
  - Tap your segment, then tap a neighbour to send the chosen % (25/50/75/100): attack an enemy/neutral, or move troops to your own. Tap the selected segment again to deselect.
  - Or drag from your segment to any neighbour.
  - 🔁 Auto toggle (key A): when on, sending to your own neighbour also sets a standing route. Every second the source forwards all troops above its reserve (100% − send %, of its cap) to the target. Chain routes to pipe troops from the back to the front. ✕ Stop on the selected tile ends its route; a route also ends when either tile is lost.
  - Troops are shown as small soldiers (1 per 8 troops; battalions of 40 on zoomed-out expedition stages) in each tile and in marching armies.
  - Fight: attacking armies stop at the border and fight for 1–3 s (bigger fights last longer). Attack = troops × attack bonus, defense = defenders × defense bonus. The higher number wins and keeps the difference.
  - Neutral segments start with a garrison that is a share of their cap (bigger tiles hold more) and regrow back to it at 1% of cap per second. Bots also fight each other.
  - Fair starts: you and every bot start on the coast, spread evenly around the island at about the same distance from each other.
  - The island floats in fog, seen at a slight angle. Built segments show their building as a scene: farms turn into fields with farmhouses, forts get stone walls and towers, barracks a castle with tents and soldiers, hospitals an infirmary with medical tents, labs an observatory with crystals. Flags and soldiers take the owner's colour.
  - Each battle has a climate theme (summer, autumn, winter, moor): ground, cliffs, rocks and trees change with it. Owner colours show as glowing borders around each segment.
  - Rivers (visual only) run from the mountains and inland to the coast or a lake.
  - Maps vary: island shape (blob, squiggly square, triangle, diamond, peanut, ring) and 1–4 lakes or mountain ranges that nobody can occupy or cross.
  - You win when every enemy faction is gone.
- **Buildings** (one per segment, paid with that segment's troops; captured buildings switch sides):

| Building | Cost | Effect |
|---|---|---|
| 🌾 Farm | 30 | +60% growth in this segment |
| ⚔️ Barracks | 40 | troops sent from here attack x1.5 |
| 🛡️ Fort | 40 | defenders here count x1.5 |
| ➕ Hospital | 50 | +50% growth in your adjacent segments |
| 🔬 Lab | 60 | +10% growth in all your segments |

- **Bots** have personalities (aggressive, builder, turtle). They pick targets by value per troop needed, build according to position (front line: fort or barracks; behind the front: farm, hospital or lab), and push troops from the back to the front.

Keys: space = pause, 1–4 = send %, A = auto toggle, Esc = deselect.

## Code
Vanilla JS modules plus canvas 2D. No build step, no dependencies.

| File | Purpose |
|---|---|
| `js/config.js` | all balance numbers (growth, caps, buildings, colours) |
| `js/mapgen.js` | seeded map generator: island shapes (signed distance functions), lakes/mountains, voronoi-like segments, adjacency, label points |
| `js/battle.js` | battle simulation (fixed 0.1 s step, no drawing, runs headless) |
| `js/ai.js` | bot decisions and personalities |
| `js/campaign.js` | world map, empires, region difficulty, save/load |
| `js/render.js` | island-diorama renderer: smooth vector outlines (marching squares), tilted camera, static layers + cached per-segment sprites (overlays, trees, buildings), troop pills |
| `js/expedition.js` | expedition stages, perks, carry-over maths, bot scaling, best run |
| `js/structures.js` | building scenes that fill a segment: farmland, fort walls and towers, castle with soldiers, hospital, lab |
| `js/main.js` | screens, input, HUD, frame loop |

## Performance
Runs at the monitor's refresh rate (60, 144 Hz ...). The simulation steps at 10 Hz; armies and route arrows interpolate between steps. Terrain, borders and rocks are drawn once per map; each segment's overlay, trees and building scene is a cached sprite, so captures and new buildings only re-stack sprites (~1 ms). The smoke test prints frame times and the rebuild cost.

## Run locally
```
python -m http.server 8000
```
Open http://localhost:8000.

## Test
```
python tools/smoke_test.py [screenshot_dir]
```
Needs Python Playwright. The test runs 12 bot-only battles headless, plays a campaign battle in portrait and landscape (select, build, attack), checks for JS errors and saves screenshots.

## Build number
The menu shows `build N · date time`. A git pre-commit hook (`tools/pre-commit` → `.git/hooks/pre-commit`) runs `tools/stamp_version.py`, which stamps the label and adds `?v=N` to css/js files so browsers load the new version. After a fresh clone, install the hook with `cp tools/pre-commit .git/hooks/pre-commit`.
