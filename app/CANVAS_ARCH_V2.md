# Canvas engine v2 — TWO coordinate systems (world camera + scaled UI)

**This supersedes the scaling model in CANVAS_SPEC.md.** Alex's spec: build it like Terraria /
Stardew Valley — a **world** rendered through a **camera**, and a **UI** layer in its own screen
space. The old "fixed portrait world + letterbox" is WRONG and must be removed. Keep everything else
from CANVAS_SPEC.md (assets, the `api.ts` client, the scene list, pixel-art discipline).

## The two coordinate systems

### 1. WORLD space — the scene (ground, fences, trees, people, decor)
- The scene lives in **world units** (1 world unit = 1 source-art pixel; a 92px sprite is 92 world
  units tall, a 48px tile is 48). Author scenes in world coordinates — a plaza is a world rectangle
  with trees/people/decor at world positions.
- A **Camera** `{ x, y, zoom }` maps world→screen: `sx = round((wx - cam.x) * zoom + viewW/2)`,
  `sy = round((wy - cam.y) * zoom + viewH/2)`. `cam.x/y` is the world point at screen center.
- **`zoom` is an INTEGER** (screen px per world px), derived from the viewport so the world is shown
  at a good "zoomed-in" size and CRISP (nearest-neighbor, `imageSmoothingEnabled=false`). Pick zoom
  from the viewport, e.g. `zoom = clamp(round(min(viewW, viewH) / WORLD_VIEW), 1, 6)` where
  `WORLD_VIEW ≈ 220` world-units — so a phone and a desktop both show a similar slice of world at a
  sensible character size, just crisper/bigger blocks on bigger screens. **Never a fractional zoom.**
- **Fills ANY dimension — no letterbox.** The world must cover the whole viewport at every aspect
  ratio: the ground (grass) tiles across the *entire screen* (draw grass over the full viewport in
  world space, offset by the camera), and wider screens simply reveal MORE world horizontally. Never
  phone-locked, never black bars around the world.
- The camera is **translated by camera coordinates** — center it on the scene's focus (for the plaza,
  the centre of the plaza/crowd). Panning is just changing `cam.x/y`. (A gentle drift or drag-pan is
  fine but optional; the key is the camera *system*, not a locked view.)
- Draw world sprites at `native_size * zoom` (integer × integer = integer → crisp). Round all screen
  positions to whole pixels.

### 2. UI space — chrome (header, nav bar, buttons, panels, scrubber, dialogue box)
- Drawn AFTER the world, in **screen pixels**, and **NOT affected by the camera** (no world translate,
  no world zoom).
- Has its own **integer GUI scale** from the window size (Minecraft/Stardew "GUI Scale"):
  `guiScale = clamp(floor(min(viewW, viewH) / UI_BASE), 1, 4)` (UI_BASE ≈ 180). UI art/text is authored
  in UI-units and blitted at `× guiScale` (nearest-neighbor). Bigger window → bigger integer UI.
- **Auto-layout — the hard requirement.** UI elements are placed by **anchor** (top-left, top-center,
  top-right, bottom-left, bottom-center, bottom-right, center, left-edge, right-edge) with a margin,
  in screen space at the current guiScale, and must:
  - never render **off-screen** (clamp each element's rect into the viewport),
  - never **overlap** another element — when the window is too small to fit an anchored row at the
    current guiScale, resolve it (drop guiScale by one for that row, and/or reflow: stack vertically,
    shrink, or collapse a group). No element may become partially or fully invisible or sit on top of
    another. Provide a small layout pass that detects overlap/overflow and adjusts.
  - Build a tiny `UiContext` the scenes use: it exposes `guiScale`, `viewW/viewH`, and helpers like
    `place(anchor, wUnits, hUnits, {margin}) -> screenRect` (already guiScaled + clamped +
    overlap-resolved), plus `button()/panel()/text()` that draw at guiScale and register their rects
    for hit-testing + the overlap pass.

## Engine changes
- **`surface.ts`**: the canvas backbuffer is the **full device viewport** in *device* pixels
  (`canvas.width = round(innerWidth * dpr)` etc., CSS size = innerWidth/Height), `imageSmoothingEnabled
  = false`. No fixed design res, no CSS upscaling trick, no letterbox. All scaling now comes from the
  camera `zoom` (world) and `guiScale` (UI). Expose `viewW`, `viewH` (CSS px), `dpr`. (Apply a
  `ctx.setTransform(dpr,0,0,dpr,0,0)` so drawing is in CSS px.) Round everything to whole *device*
  pixels where it matters for crispness.
- **`camera.ts`** (new): the `Camera` above — `worldToScreen`, `screenToWorld`, `pickZoom(view)`,
  `centerOn(wx, wy)`, and a `withWorld(ctx, fn)` that sets the world transform (translate+scale) so a
  scene can draw in world coords, or provide explicit `drawWorldImage(ctx, img, wx, wy, {anchor})`
  helpers. Zoom integer.
- **`ui.ts`** (rework): the `UiContext` + anchored auto-layout above (guiScale, place(), button(),
  panel(), text(), overlap/clamp pass). No world knowledge.
- **`scene.ts`**: Scene interface v2 — `renderWorld(ctx, cam, surface)` then `renderUI(ctx, ui)`;
  `update(dt, input)` where `input` gives BOTH screen coords and (via `cam.screenToWorld`) world
  coords. Input routing: **hit-test UI first in screen space**, and only if no UI element was hit,
  hit-test the world (tap a character) using world coords. The SceneManager calls renderWorld under
  the camera, then renderUI on top.
- Keep `text.ts`, `assets.ts`, `sprite.ts`, `tilemap.ts` but they now draw either in world space (via
  the camera helpers) or UI space (via guiScale) as appropriate.

## Reference scene: PlazaScene (refactor it fully)
- **World**: an "infinite" grass ground tiled across the whole viewport; a dirt **plaza** rectangle
  (world rect) with a fence border; trees/lamp/log/rock/decor at world positions (trees fully visible,
  not clipped); the people **wander in world coords** (existing sim, now in world units), idle→front /
  moving→walk cycle + flip, y-sorted. Camera centers on the plaza; zoom integer from viewport. On a
  phone it's zoomed in on the plaza; on a wide window you see the plaza plus more grass around it —
  filling the screen, crisp, no bars.
- **UI**: SavePoint header (top-center), whistle (top-left), Past (top-right), the bottom nav
  (Today/Journal/People, bottom, full width), mic (bottom-right), garden arrows (left/right edges) —
  all via the `UiContext` at guiScale, auto-laid-out so nothing overlaps or clips at any window size.
- Tap routing: a tap on a UI control acts on the UI; a tap on empty world that lands on a character
  opens their Person view (screenToWorld + hit-test the walkers).

## Verify (critical — this is the whole point)
`cd /home/agent/sp-canvas/app && npm run typecheck && npm run build` clean. Dev server on
`http://127.0.0.1:5273`. Screenshot the plaza at **THREE window sizes** with puppeteer
(`/usr/local/bin/google-chrome`): **portrait phone 390×844**, **wide landscape 1200×620**, and
**near-square 700×700**. In ALL THREE: the world must FILL the viewport (grass to every edge, no
letterbox), pixels crisp (integer zoom), and the UI must be fully on-screen, correctly scaled, and
non-overlapping (header/nav/buttons all readable, nothing cut off). 0 console errors. Save shots to
`/home/agent/sp-canvas/shots/`. Report the camera + UiContext API you settled on (so the other scenes
can be refactored to match) and the three screenshot paths. Local-only repo — never push.
