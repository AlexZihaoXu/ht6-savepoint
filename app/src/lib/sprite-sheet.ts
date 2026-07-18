/**
 * Pure PixelLab sprite-sheet logic (SAV-61) — which file of a person's
 * generated sheet to show for a given animation state. Kept apart from the
 * `PixelSprite` component (pixel-sprite.tsx) so it stays unit-testable and
 * the component file exports only a component (react-refresh friendly).
 */

import type { SpriteManifest } from "./api";

/**
 * Which sheet file to show: `static.south` when idle (face forward), the
 * east walk cycle on the move (wrapping `frame` around however many frames
 * the sheet has), and the side-facing `static.east` while standing in a
 * plaza conversation (`talking`) so the pair visibly faces each other.
 * Left-facing anything reuses the east art mirrored — that flip is the
 * renderer's job.
 */
export function spriteFrameFile(
  sprite: SpriteManifest,
  moving: boolean,
  frame: number,
  talking = false,
): string {
  const frames = sprite.walk.east;
  if (moving && frames.length > 0)
    return frames[((frame % frames.length) + frames.length) % frames.length];
  if (talking) return sprite.static.east;
  return sprite.static.south;
}
