/**
 * Scene COMPONENTS for the pixel screens: the growth-stage plant sprite and
 * scenery props (trees, rocks, fences) built from the LPC tile crops in
 * `public/assets/tiles/`. Pure helpers live in scene-utils.ts.
 */

import { useId } from "react";

/* ---- growth-stage plant sprite ----------------------------------------- */

const LEAF = "#3d8b40";
const LEAF_LIGHT = "#66bb5a";
const STEM = "#2f6b33";
const BLOOM = "#e8a33d";
const BLOOM_CORE = "#c25b3f";

/**
 * A day's plant, drawn as crisp pixel rects: stage 0 (bare soil) .. 4 (bloom).
 * Bigger stage = bigger, fuller plant — the garden reads at a glance.
 */
export function PlantSprite({
  stage,
  size = 22,
  className,
}: {
  stage: number;
  size?: number;
  className?: string;
}) {
  const s = Math.max(0, Math.min(4, stage));
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden
    >
      {s === 0 && (
        <rect x="6" y="12" width="4" height="2" fill="#7a5136" opacity="0.55" />
      )}
      {s >= 1 && (
        <g>
          <rect x="7" y="10" width="2" height="4" fill={STEM} />
          <rect x="5" y="9" width="2" height="2" fill={LEAF_LIGHT} />
          <rect x="9" y="9" width="2" height="2" fill={LEAF} />
        </g>
      )}
      {s >= 2 && (
        <g>
          <rect x="7" y="6" width="2" height="4" fill={STEM} />
          <rect x="4" y="6" width="3" height="2" fill={LEAF} />
          <rect x="9" y="5" width="3" height="2" fill={LEAF_LIGHT} />
        </g>
      )}
      {s >= 3 && (
        <g>
          <rect x="7" y="3" width="2" height="3" fill={STEM} />
          <rect x="3" y="8" width="2" height="2" fill={LEAF_LIGHT} />
          <rect x="11" y="8" width="2" height="2" fill={LEAF} />
          <rect x="5" y="3" width="2" height="2" fill={LEAF} />
          <rect x="9" y="2" width="2" height="2" fill={LEAF_LIGHT} />
        </g>
      )}
      {s >= 4 && (
        <g>
          <rect x="6" y="1" width="4" height="3" fill={BLOOM} />
          <rect x="7" y="2" width="2" height="1" fill={BLOOM_CORE} />
          <rect x="4" y="0" width="2" height="2" fill={BLOOM} />
          <rect x="10" y="0" width="2" height="2" fill={BLOOM} />
        </g>
      )}
    </svg>
  );
}

/* ---- scenery props ------------------------------------------------------ */

interface PropStyle {
  className?: string;
  style?: React.CSSProperties;
}

export function Tree({ className, style }: PropStyle) {
  return (
    <img
      src="/assets/tiles/tree.png"
      alt=""
      aria-hidden
      draggable={false}
      className={`pixelated pointer-events-none select-none ${className ?? ""}`}
      style={style}
    />
  );
}

export function Pine({ className, style }: PropStyle) {
  return (
    <img
      src="/assets/tiles/pine.png"
      alt=""
      aria-hidden
      draggable={false}
      className={`pixelated pointer-events-none select-none ${className ?? ""}`}
      style={style}
    />
  );
}

export function Rock({
  small,
  className,
  style,
}: PropStyle & { small?: boolean }) {
  return (
    <img
      src={small ? "/assets/tiles/pebbles.png" : "/assets/tiles/rock.png"}
      alt=""
      aria-hidden
      draggable={false}
      className={`pixelated pointer-events-none select-none ${className ?? ""}`}
      style={style}
    />
  );
}

/** A run of wooden fence (posts + two rails), tiled to any width. */
export function FenceRow({ className, style }: PropStyle) {
  const pid = useId();
  return (
    <svg
      className={`pointer-events-none select-none ${className ?? ""}`}
      style={style}
      height="26"
      width="100%"
      aria-hidden
      shapeRendering="crispEdges"
    >
      <defs>
        <pattern id={pid} width="34" height="26" patternUnits="userSpaceOnUse">
          <rect x="0" y="4" width="34" height="4" fill="#8a5a34" />
          <rect x="0" y="13" width="34" height="4" fill="#8a5a34" />
          <rect x="0" y="8" width="34" height="1" fill="#6d4326" />
          <rect x="0" y="17" width="34" height="1" fill="#6d4326" />
          <rect x="4" y="0" width="6" height="24" fill="#9a6a3e" />
          <rect x="4" y="0" width="6" height="2" fill="#b5834f" />
          <rect x="8" y="0" width="2" height="24" fill="#6d4326" />
        </pattern>
      </defs>
      <rect width="100%" height="26" fill={`url(#${pid})`} />
    </svg>
  );
}
