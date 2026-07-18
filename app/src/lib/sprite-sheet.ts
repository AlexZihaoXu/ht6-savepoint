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
 * the sheet has). Left-facing movement reuses these same frames mirrored —
 * that flip is the renderer's job.
 */
export function spriteFrameFile(
  sprite: SpriteManifest,
  moving: boolean,
  frame: number,
): string {
  const frames = sprite.walk.east;
  if (!moving || frames.length === 0) return sprite.static.south;
  return frames[((frame % frames.length) + frames.length) % frames.length];
}
