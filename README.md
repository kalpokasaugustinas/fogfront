# Frontlines

A single-player territory strategy game for the browser (mobile later). Conquer a world map region by region. Each region is a battle against computer opponents on a map split into segments. Grow troops, build, and do the math on which fights to pick.

Prototype stage.

## How it plays
- **Campaign:** a world map of 16 regions held by 3 rival empires. Attack any region next to one you own. Difficulty grows with distance from home: more segments, more enemies, stronger neutrals, faster bots. Progress is saved in the browser.
- **Battle:** each segment you own grows troops up to its cap. Bigger segments grow faster and hold more.
  - Tap your segment, then tap a neighbour to attack it with the chosen % (25/50/75/100).
  - Drag from your segment to any neighbour (your own too) to send troops.
  - Fight: attack = troops × attack bonus, defense = defenders × defense bonus. The higher number wins and keeps the difference.
  - Neutral segments don't grow. Bots also fight each other.
  - You win when every enemy faction is gone.
- **Buildings** (one per segment, paid with that segment's troops; captured buildings switch sides):

| Building | Cost | Effect |
|---|---|---|
| 🌾 Farm | 15 | +100% growth in this segment |
| ⚔️ Barracks | 20 | troops sent from here attack x1.5 |
| 🛡️ Fort | 20 | defenders here count x1.5 |
| ➕ Hospital | 25 | +50% growth in your adjacent segments |
| 🔬 Lab | 30 | +10% growth in all your segments |

- **Bots** have personalities (aggressive, builder, turtle). They pick targets by value per troop needed, build according to position (front line: fort or barracks; behind the front: farm, hospital or lab), and push troops from the back to the front.

Keys: space = pause, 1–4 = send %, Esc = deselect.

## Code
Vanilla JS modules plus canvas 2D. No build step, no dependencies.

| File | Purpose |
|---|---|
| `js/config.js` | all balance numbers (growth, caps, buildings, colours) |
| `js/mapgen.js` | seeded map generator: noisy island split into voronoi-like segments, adjacency, label points |
| `js/battle.js` | battle simulation (fixed 0.1 s step, no drawing, runs headless) |
| `js/ai.js` | bot decisions and personalities |
| `js/campaign.js` | world map, empires, region difficulty, save/load |
| `js/render.js` | map drawing (raster painted once, scaled per frame) |
| `js/main.js` | screens, input, HUD, frame loop |

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
