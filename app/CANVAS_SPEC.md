# SavePoint — Canvas-2D engine spec

A **parallel demo** to the React app: the whole SavePoint UI re-rendered with **our own
Canvas-2D pipeline** (no DOM UI, no React) — everything (scene + UI chrome) drawn on one
`<canvas>`. Same assets, same backend API, runs side-by-side on its own port/tunnel so we can
compare. **Follow pixel-art best practices.** Vanilla TypeScript + Vite. App root:
`/home/agent/sp-canvas/app`.

## Pixel-art rules (non-negotiable)
- One `<canvas>`, a small **art-resolution backbuffer** CSS-upscaled with `image-rendering: pixelated`. `PixelSurface` (built) owns this — never change smoothing (it's off).
- **Integer positions & sizes only.** Wrap every draw coord/size in `px()` (from `engine/surface`). No sub-pixel placement, no fractional scaling of sprites (draw at 1:1, or integer/​simple ratios).
- Draw in **art-pixel coords** (`surface.w` × `surface.h`, which flex with device aspect — lay out relative to edges/center, don't hardcode a resolution).
- Reuse the **existing pixel assets** (below) and the **PressStart2P** font at integer sizes (6 / 8 / 10 px). Palette: warm cozy tones matching the art (dirt `#c9a26a`, ink `#2a2140`, leaf-green accents, parchment panels).
- Target **60fps**; advance animation by `dt`. Sprite frames advance only while moving.

## Already built (do not rewrite — build on these)
- `src/engine/surface.ts` — `PixelSurface` (crisp integer scaling, `resize()`, `toArt(clientX,clientY)`), `px(n)`.
- `src/engine/assets.ts` — `loadImage(url)`, `loadImages({...})`, `cached(url)`, `SHEET` (`/assets/sheet`).
- `src/lib/api.ts` — the backend client. `api.people()`, `api.person(id)`, `api.days()`, `api.day(date)`, `api.today()`, `api.monthSummary(YYYY-MM)`; `spriteUrl(localId, filename)`, `displayName(p)`; types `ApiPerson` (has `.sprite` manifest + `.avatar_params` + `.bio`), `ApiDay` (`.plant_stage`, `.mood_color`), `ApiDayView` (`day/events/people/recap`), `ApiEvent` (`ts`, `type:"seen"|"spoke"`, `text`, `person_id`), `ApiMonthSummary`. `API_BASE` from `VITE_API_BASE` (already set to the backend tunnel in `.env.local`).
- `src/main.ts` — a throwaway pipeline **proof** (tiled grass + a row of live sprites + title). Phase 1 replaces its body with real boot → SceneManager.

## Assets (`/assets/sheet/…`, native px)
ground: `grass.png` 48², `dirt-patch.png` 48², `pebbles.png`; border/decor: `fence.png` 16×24, `tree-oak.png` 33×41, `tree-round.png` 31×41, `lamp.png` 10×40, `log.png` 25×11, `rock.png` 13×13, `deco-mushroom.png` 8², `deco-daisies.png`, `deco-buttercups.png`, `cabin.png` 72×95; UI: `panel.png` 170×60 (parchment panel — use as a 9-slice), `btn.png` 26×28, `btn-blue.png`, `btn-dark.png`; garden: `flower-{pink,gold,green,blue}-{1..4}.png` 16² (4 growth stages). Font: `/assets/fonts/PressStart2P.ttf` (already @font-face'd as `"PressStart2P"`).
**Character sprites** come from the backend: `spriteUrl(localId, manifest.static.south|east|west|north)` and the walk cycle `manifest.walk.east[]` (9 frames, 92² transparent). Idle → `static.south` (front). Walking → cycle `walk.east` (~8fps); facing left → same frames mirrored (`ctx.save(); ctx.scale(-1,1); …`). No sprite (`sprite===null`) → draw a simple placeholder (rounded body from `avatar_params.shirt_color` + a head) so un-sprited people still show.

## Engine to build (Phase 1)
Create under `src/engine/`:
- `input.ts` — pointer/touch normalized to art coords via `surface.toArt`. Emits **tap** (down+up within a few px), and **drag** (start/move/end with dx). Expose current pointer + a per-frame query API scenes can poll. One global listener set on the canvas.
- `loop.ts` — rAF loop calling `update(dt)` then `render()`; clamps dt; starts/stops.
- `text.ts` — `drawText(ctx, str, x, y, {size, color, align})` using PressStart2P; `measure(str,size)`; word-wrap helper. Integer sizes only.
- `ui.ts` — immediate-mode-ish helpers: `panel(ctx, x,y,w,h)` (9-slice `panel.png`), `button(ctx, rect, label, {pressed})` (`btn*.png` + centered label) returning its hit-rect; a `hit(rect, point)` test. Buttons are drawn by scenes and hit-tested against the input tap.
- `scene.ts` — `interface Scene { enter?(): void|Promise<void>; update(dt:number, input:Input): void; render(s:PixelSurface): void; exit?(): void }`. `SceneManager` with `switchTo(scene)` (+ a short crossfade/slide transition), holds the current scene, routes update/render, and a tiny nav intent bus.
- `sprite.ts` — `drawPersonSprite(ctx, person, x, y, {facing, moving, phase, height})` implementing the idle/walk/flip rules above (loads frames lazily via assets, falls back to placeholder). `worldSprite` height ~40–52 art px in the plaza.
- `tilemap.ts` — `fillTiles(ctx, img, x,y,w,h)` and a `fenceBorder(...)` helper.

Then rewrite `src/main.ts` to boot fonts+assets → create `SceneManager` → start on `PlazaScene`. Build a **complete, polished PlazaScene** (`src/scenes/plaza.ts`) as the reference: cozy tiled dirt plaza inside a fence border with trees/lamp/log/decor, a wooden **"SavePoint"** header, people from `api.people()` **wandering** (own simple wander sim: random targets, `facing`, idle pauses; idle→front, moving→walk cycle+flip), tap a character → nav intent to Person, a **whistle** button + **mic** button (visual, can be stubs) and a **Past** button, and a bottom nav bar (Today / journal / People). Left/right edge arrows hint the swipe to Garden. Must `npm run typecheck` + `npm run build` clean and render with **0 console errors** (verify with a puppeteer screenshot against the running dev server on `http://127.0.0.1:5273`).

## Scenes (Phase 2 — one file each under `src/scenes/`, build on the Phase-1 engine + PlazaScene pattern)
- `garden.ts` — **GardenScene**: `api.days()` → a calendar/grid of days as a **garden**; each day a flower (`flower-*` sized by `plant_stage`, hue by `mood_color`). Tap a day → nav to Day. Swipe/arrow back to Plaza (plaza↔garden is one panning world). 
- `day.ts` — **DayScene**: `api.day(date)` → people present on a stage, **dialogue boxes** (9-slice `panel.png`) that play back `events` (typewriter text), a **timeline scrubber** across event `ts`, a transcript toggle, a **back** button. Cinematic/letterbox feel.
- `people.ts` — **PeopleScene** (list) + **PersonScene** (`api.person(id)`: big sprite + `bio` + notes + recent events). Contacts-style list with each person's front sprite + `displayName`.
- `past.ts` — **PastScene**: month picker → `api.monthSummary(YYYY-MM)` → top people + stats + busiest day.
Each scene: export a factory `createXScene(nav): Scene`. **Do NOT edit `main.ts` or a shared scene registry** — Phase 3 wires nav. Use `nav` intents (Phase 1 defines the shape) to request scene changes. Keep everything typed; `npm run typecheck` must stay clean for your file.

## Integration (Phase 3)
Wire all scenes into the SceneManager + nav routing (bottom bar + tap/back/swipe intents), ensure `npm run typecheck` + `npm run build` are clean, run the dev server, screenshot **every** scene (plaza, garden, day, people, person, past) via puppeteer on `:5273`, confirm **0 console errors**, and report the screenshot paths + any rough edges.

## Verify (every phase)
`cd /home/agent/sp-canvas/app && npm run typecheck && npm run build`. Dev server is at `http://127.0.0.1:5273` (already running; restart with `fuser -k 5273/tcp; nohup npm run dev >/tmp/canvas-dev.log 2>&1 &` if needed). Screenshot with puppeteer-core + `/usr/local/bin/google-chrome` (example: `/tmp/claude-1000/-home-agent/2016a970-e87c-4f3c-8890-89c86b5f2e23/scratchpad/cap-canvas.js`). **Local-only repo — never push.**
