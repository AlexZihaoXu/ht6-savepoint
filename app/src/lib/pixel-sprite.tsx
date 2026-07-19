/**
 * PixelSprite — a person's real PixelLab pixel-art character (SAV-61), with
 * the deterministic `ParametricSprite` as the fallback for anyone whose
 * sheet hasn't generated yet (sprites appear per person as the backend
 * finishes them; un-sprited people keep their parametric stand-in).
 *
 * Animation contract (diamondpixals):
 *   idle         → `static.south` (face forward);
 *   moving right → cycle `walk.east[]` at ~8 fps — frames advance ONLY
 *                  while moving;
 *   moving left  → the SAME east frames mirrored (`scaleX(-1)`) — every
 *                  sheet's side view faces right, left is the flip.
 *   talking      → `static.east` (mirrored when facing -1) — a plaza chat
 *                  pair stands still visibly facing each other.
 *
 * Tiles carry transparent padding (the drawn character stands ~70px of the
 * 92px tile, feet at ~88% height), so the img renders slightly larger than
 * the `size` box and is anchored so the feet sit on the box's bottom edge —
 * matching the visual footprint of the ParametricSprite it replaces.
 */

import { useEffect, useState } from "react";
import { spriteUrl, type AvatarParams, type SpriteManifest } from "./api";
import { ParametricSprite } from "./sprite";
import { spriteFrameFile } from "./sprite-sheet";

/** Walk-cycle frame rate (diamondpixals: ~8 fps feels right). */
const WALK_FPS = 8;
/** Upscale so the drawn character (~70/92 of the tile) fills `size`. */
const TILE_SCALE = 1.3;
/** Feet sit at ~88% of the tile — drop the img so they touch the box bottom. */
const FOOT_FRAC = 0.12;

export function PixelSprite({
  localId,
  sprite,
  params,
  size = 64,
  facing = 1,
  moving = false,
  talking = false,
  pixelScale,
  className,
}: {
  localId: string;
  /** The person's sheet manifest — null until the backend has generated it. */
  sprite: SpriteManifest | null | undefined;
  /** Fallback axes — un-sprited people render their parametric character. */
  params: AvatarParams;
  size?: number;
  /** 1 = right/east, -1 = left/west (the mirrored east frames). */
  facing?: 1 | -1;
  /** True while actually walking — runs the frame cycle. */
  moving?: boolean;
  /** Standing in a plaza chat — side-facing idle pose (east, mirrorable). */
  talking?: boolean;
  /**
   * Crisp big-render mode (the day-view stage): draw the tile at exactly
   * this integer multiple of its source pixels instead of the `size`-derived
   * scale — every source pixel maps to a whole screen-pixel square, so the
   * blow-up stays sharp. Feet still anchor to the `size` box's bottom.
   */
  pixelScale?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(0);
  const usable = Boolean(sprite) && !failed;

  // A fresh manifest gets a fresh chance (e.g. the sheet just generated).
  useEffect(() => {
    setFailed(false);
  }, [sprite, localId]);

  // Preload the whole sheet once so frame swaps never flash; any missing
  // file downgrades to the parametric fallback instead of a broken image.
  useEffect(() => {
    if (!sprite) return;
    let stale = false;
    const files = [
      sprite.static.south,
      sprite.static.east,
      ...sprite.walk.east,
    ];
    const imgs = files.map((f) => {
      const img = new Image();
      img.onerror = () => {
        if (!stale) setFailed(true);
      };
      img.src = spriteUrl(localId, f);
      return img;
    });
    return () => {
      stale = true;
      for (const img of imgs) img.onerror = null;
    };
  }, [sprite, localId]);

  // The walk clock: ticking (and therefore frame advance) happens only
  // while moving, per the animation contract.
  useEffect(() => {
    if (!usable || !moving) return;
    const id = window.setInterval(
      () => setFrame((f) => f + 1),
      1000 / WALK_FPS,
    );
    return () => window.clearInterval(id);
  }, [usable, moving]);

  if (!sprite || failed) {
    // Fallback keeps the wander facing readable: parametric characters flip
    // whole (their base art is symmetric enough), pivoting at the feet.
    return facing === -1 ? (
      <span
        className={className}
        style={{
          display: "block",
          transform: "scaleX(-1)",
          transformOrigin: "50% 100%",
        }}
      >
        <ParametricSprite params={params} size={size} />
      </span>
    ) : (
      <ParametricSprite params={params} size={size} className={className} />
    );
  }

  const scaled = pixelScale
    ? sprite.tile.w * Math.max(1, Math.round(pixelScale))
    : Math.round(size * TILE_SCALE);
  const flip = (moving || talking) && facing === -1;
  return (
    <span
      role="img"
      aria-label="character sprite"
      className={className}
      style={{
        position: "relative",
        display: "block",
        width: size,
        height: size,
      }}
    >
      <img
        src={spriteUrl(
          localId,
          spriteFrameFile(sprite, moving, frame, talking),
        )}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        style={{
          position: "absolute",
          left: Math.round((size - scaled) / 2),
          bottom: -Math.round(scaled * FOOT_FRAC),
          width: scaled,
          height: scaled,
          // Tailwind preflight caps img at max-width:100% — undo it, the
          // tile intentionally overflows its box (transparent padding).
          maxWidth: "none",
          imageRendering: "pixelated",
          // The overflow must never steal taps meant for neighboring rows;
          // the wrapping button/link handles interaction.
          pointerEvents: "none",
          transform: flip ? "scaleX(-1)" : undefined,
        }}
      />
    </span>
  );
}
