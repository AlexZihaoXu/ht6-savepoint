/**
 * Renderers for the modular custom character (see customizer.ts for the
 * atlas math). Pure CSS sprite-sheet compositing — three absolutely
 * positioned layers share the one parts.png via background-position, so
 * rendering is synchronous, deterministic and pixel-crisp at any integer
 * scale (half-integer scales stay exact on ≥2× displays).
 */

import type { CSSProperties } from "react";
import {
  CANVAS_H,
  CANVAS_W,
  characterLayers,
  partRect,
  SHEET_H,
  SHEET_URL,
  SHEET_W,
  slotBoxHeight,
  type CharacterParts,
  type Slot,
  type SourceRect,
} from "./customizer";

function layerStyle(r: SourceRect, scale: number): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    width: r.sw * scale,
    height: r.sh * scale,
    backgroundImage: `url(${SHEET_URL})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${SHEET_W * scale}px ${SHEET_H * scale}px`,
    backgroundPosition: `${-r.sx * scale}px ${-r.sy * scale}px`,
    imageRendering: "pixelated",
  };
}

/**
 * The assembled head+body+legs character, feet on the box's bottom edge.
 * Box = CANVAS_W×CANVAS_H at `scale`; layers are centered horizontally
 * (the v2 sheet's cells alternate 18/19px wide).
 */
export function CustomAvatar({
  parts,
  scale = 2,
  className,
  style,
}: {
  parts: CharacterParts;
  scale?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role="img"
      aria-label="your custom character"
      className={className}
      style={{
        position: "relative",
        display: "block",
        width: CANVAS_W * scale,
        height: CANVAS_H * scale,
        ...style,
      }}
    >
      {characterLayers(parts).map((l) => (
        <span
          key={l.slot}
          aria-hidden
          style={{
            ...layerStyle(l, scale),
            left: l.x * scale,
            top: l.y * scale,
          }}
        />
      ))}
    </span>
  );
}

/**
 * One part cell for the picker grids — the raw strip art, vertically
 * centered in a uniform per-slot box so rows of thumbnails line up.
 */
export function PartThumb({
  slot,
  index,
  scale = 2,
  className,
}: {
  slot: Slot;
  index: number;
  scale?: number;
  className?: string;
}) {
  const r = partRect(slot, index);
  const boxH = slotBoxHeight(slot) * scale;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        position: "relative",
        display: "block",
        width: r.sw * scale,
        height: boxH,
      }}
    >
      <span
        style={{
          ...layerStyle(r, scale),
          top: Math.round((boxH - r.sh * scale) / 2),
        }}
      />
    </span>
  );
}
