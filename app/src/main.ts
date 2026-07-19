/**
 * Boot: load the pixel font + core sheet art, build the engine (surface →
 * input → scene manager → loop), and start on the PlazaScene.
 *
 * Phase 3 (this file) owns the intent→scene routing: scenes emit `NavIntent`s
 * through `manager.nav`; the router below maps each intent to a fresh scene
 * instance and keeps a small history stack so `{ kind: "back" }` returns to
 * the scene you came from.
 */

import { loadImages, SHEET } from "./engine/assets";
import { Input } from "./engine/input";
import { GameLoop } from "./engine/loop";
import { SceneManager } from "./engine/scene";
import type { NavIntent, Scene } from "./engine/scene";
import { PixelSurface } from "./engine/surface";
import { createDayScene } from "./scenes/day";
import { createGardenScene } from "./scenes/garden";
import { createPastScene } from "./scenes/past";
import { createPeopleScene, createPersonScene } from "./scenes/people";
import { createPlazaScene } from "./scenes/plaza";

/** Sheet art needed by the first frame (everything else lazy-loads). */
const CORE_ASSETS = {
  grass: `${SHEET}/grass.png`,
  dirt: `${SHEET}/dirt-patch.png`,
  fence: `${SHEET}/fence.png`,
  treeOak: `${SHEET}/tree-oak.png`,
  treeRound: `${SHEET}/tree-round.png`,
  lamp: `${SHEET}/lamp.png`,
  log: `${SHEET}/log.png`,
  rock: `${SHEET}/rock.png`,
  mushroom: `${SHEET}/deco-mushroom.png`,
  daisies: `${SHEET}/deco-daisies.png`,
  buttercups: `${SHEET}/deco-buttercups.png`,
  pebbles: `${SHEET}/pebbles.png`,
  panel: `${SHEET}/panel.png`,
  btn: `${SHEET}/btn.png`,
  btnBlue: `${SHEET}/btn-blue.png`,
  btnDark: `${SHEET}/btn-dark.png`,
} as const;

async function boot(): Promise<void> {
  // Pixel font at the three sanctioned sizes, before any text draws.
  const fonts = (document as Document & { fonts: FontFaceSet }).fonts;
  await Promise.all(
    [6, 8, 10].map((s) => fonts.load(`${s}px "PressStart2P"`)),
  ).catch(() => undefined);

  try {
    await loadImages(CORE_ASSETS);
  } catch (err) {
    console.warn("some core assets failed to load; falling back to flats", err);
  }

  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const surface = new PixelSurface(canvas);
  window.addEventListener("resize", () => surface.resize());

  const input = new Input(surface);
  const manager = new SceneManager(surface, input);

  // ---- Phase-3 routing -----------------------------------------------------
  // A "route" is any forward NavIntent (never "back"). Fresh scene instances
  // are built per navigation — each scene's enter() refetches its data.
  type Route = Exclude<NavIntent, { kind: "back" }>;

  const build = (route: Route): Scene => {
    switch (route.kind) {
      case "plaza":
        return createPlazaScene(manager.nav);
      case "garden":
        return createGardenScene(manager.nav);
      case "day":
        return createDayScene(manager.nav, route.date);
      case "people":
        return createPeopleScene(manager.nav);
      case "person":
        return createPersonScene(manager.nav, route.localId);
      case "past":
        return createPastScene(manager.nav);
    }
  };

  const sameRoute = (a: Route, b: Route): boolean =>
    a.kind === b.kind &&
    (a.kind !== "day" || a.date === (b as { date: string }).date) &&
    (a.kind !== "person" ||
      a.localId === (b as { localId: string }).localId);

  /**
   * Optional deep link: `?scene=garden` / `?scene=day&date=2026-07-18` /
   * `?scene=person&id=demo-mia` / people / past. Unknown → plaza.
   * (Also what the screenshot harness uses to open each scene directly.)
   */
  const initialRoute = (): Route => {
    const q = new URLSearchParams(window.location.search);
    switch (q.get("scene")) {
      case "garden":
        return { kind: "garden" };
      case "day":
        return { kind: "day", date: q.get("date") ?? "today" };
      case "people":
        return { kind: "people" };
      case "person": {
        const localId = q.get("id");
        return localId ? { kind: "person", localId } : { kind: "people" };
      }
      case "past":
        return { kind: "past" };
      default:
        return { kind: "plaza" };
    }
  };

  /** History for `{ kind: "back" }`; bottoms out on the plaza. */
  const stack: Route[] = [];
  let current: Route = initialRoute();

  manager.onNav((intent) => {
    if (intent.kind === "back") {
      current = stack.pop() ?? { kind: "plaza" };
      manager.switchTo(build(current));
      return;
    }
    if (sameRoute(intent, current)) return; // already there
    stack.push(current);
    if (stack.length > 24) stack.shift(); // plaza<->garden ping-pong cap
    current = intent;
    manager.switchTo(build(intent));
  });

  manager.switchTo(build(current));

  const loop = new GameLoop(
    (dt) => manager.update(dt),
    () => manager.render(),
  );
  loop.start();
}

void boot();
