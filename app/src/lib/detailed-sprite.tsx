/**
 * DetailedSprite — the DIALOGUE-SCENE character portrait (head + shoulders).
 *
 * ⚠ MOCK ART / PLACEHOLDER (waterprism OK'd, 2026-07-18): "you could render
 * some mock art, but later we may have another method of getting the art
 * in." Real portrait art may replace this via that other method — keep the
 * component boundary (same props) so it can swap in cleanly.
 *
 * Until then this is the second of the two character styles: a larger,
 * higher-detail companion to the tiny plaza `ParametricSprite`, composed
 * DETERMINISTICALLY from the same 6 `avatar_params` axes — same person →
 * same character in both styles (shared palette swatches + fallbacks live
 * in portrait.ts). More detail than the plaza sprite: a readable face
 * (eyes with iris/pupil/highlight, brows, nose, gentle smile, blush),
 * fuller per-style hair with shading + highlights, and a bust framing
 * sized to stand on top of the day view's dialogue box (the bottom of the
 * torso is meant to tuck behind it). Used ONLY by the dialogue stage — the
 * plaza / People list keep the small sprite.
 */

import type { AvatarParams } from "./api";
import type { PortraitColors } from "./portrait";
import { hasBackHair, portraitColors, shade } from "./portrait";

/** Portrait grid — taller than wide, bust framing. */
const VB_W = 40;
const VB_H = 48;

/** A detailed, softly-shaded bust portrait. `size` is the pixel HEIGHT. */
export function DetailedSprite({
  params,
  size = 160,
  className,
}: {
  params: AvatarParams;
  size?: number;
  className?: string;
}) {
  const c = portraitColors(params);
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={(size * VB_W) / VB_H}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="character portrait"
    >
      {/* back hair (behind the torso) */}
      {hasBackHair(params.hair_style) && (
        <BackHair style={params.hair_style} c={c} />
      )}

      {/* neck (torso's collar paints over its base) */}
      <rect x="17.6" y="19" width="4.8" height="11.5" fill={c.skin} />
      <rect
        x="17.6"
        y="20.5"
        width="4.8"
        height="2.2"
        fill={c.skinShade}
        opacity="0.8"
      />

      {/* shoulders / torso — bottom edge is meant to clip behind the box */}
      <path
        d="M5.4 48 L5.4 37.5 Q5.4 30.5 12.5 29.4 L16.2 28.8 Q20 31.6 23.8 28.8 L27.5 29.4 Q34.6 30.5 34.6 37.5 L34.6 48 Z"
        fill={c.shirt}
      />
      <path
        d="M15.8 29 Q20 32.4 24.2 29"
        stroke={c.shirtShade}
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M7.4 34 Q9 30.8 13 30.2"
        stroke={c.shirtHi}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M32.6 34 Q31 30.8 27 30.2"
        stroke={c.shirtHi}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <rect
        x="12.4"
        y="40"
        width="1.1"
        height="6"
        rx="0.5"
        fill={c.shirtShade}
        opacity="0.5"
      />
      <rect
        x="26.5"
        y="40"
        width="1.1"
        height="6"
        rx="0.5"
        fill={c.shirtShade}
        opacity="0.5"
      />

      {/* ears */}
      <rect x="9.4" y="13.6" width="2.6" height="4.6" rx="1.3" fill={c.skin} />
      <rect x="28" y="13.6" width="2.6" height="4.6" rx="1.3" fill={c.skin} />
      <rect
        x="10.1"
        y="15"
        width="1"
        height="1.8"
        rx="0.5"
        fill={c.skinShade}
      />
      <rect
        x="28.9"
        y="15"
        width="1"
        height="1.8"
        rx="0.5"
        fill={c.skinShade}
      />

      {/* head */}
      <rect x="11" y="6" width="18" height="17.6" rx="5" fill={c.skin} />
      {/* face shading: jaw shadow, right-side shade, forehead light */}
      <rect
        x="13"
        y="21.6"
        width="14"
        height="1.6"
        rx="0.8"
        fill={c.skinShade}
        opacity="0.45"
      />
      <rect
        x="26.6"
        y="9"
        width="2.2"
        height="12"
        rx="1.1"
        fill={c.skinShade}
        opacity="0.3"
      />
      <rect
        x="13"
        y="7"
        width="6"
        height="2.4"
        rx="1.2"
        fill={c.skinHi}
        opacity="0.5"
      />

      {/* brows */}
      <rect x="13.6" y="11.6" width="4" height="1.2" rx="0.6" fill={c.brow} />
      <rect x="22.4" y="11.6" width="4" height="1.2" rx="0.6" fill={c.brow} />

      {/* eyes — sclera, iris, pupil, catchlight, lash line */}
      <Eye x={13.8} eye={c.eye} />
      <Eye x={21.8} eye={c.eye} />

      {/* nose + gentle smile + blush */}
      <rect
        x="19.4"
        y="17.4"
        width="1.2"
        height="1.6"
        rx="0.6"
        fill={c.skinShade}
        opacity="0.8"
      />
      <rect x="17.6" y="19.8" width="4.8" height="1.1" rx="0.55" fill={c.lip} />
      <rect x="16.9" y="19.3" width="1" height="1" rx="0.5" fill={c.lip} />
      <rect x="22.1" y="19.3" width="1" height="1" rx="0.5" fill={c.lip} />
      <rect
        x="12.6"
        y="17.2"
        width="3"
        height="1.6"
        rx="0.8"
        fill="#ca5f66"
        opacity="0.28"
      />
      <rect
        x="24.4"
        y="17.2"
        width="3"
        height="1.6"
        rx="0.8"
        fill="#ca5f66"
        opacity="0.28"
      />

      {/* front hair, then accessories over it */}
      <FrontHair style={params.hair_style} c={c} />
      {params.glasses && <Glasses />}
      {params.hat && <Hat kind={params.hat} />}
    </svg>
  );
}

/* ---- face parts ---------------------------------------------------------- */

function Eye({ x, eye }: { x: number; eye: string }) {
  return (
    <g>
      <rect x={x} y="13.2" width="4.4" height="3.6" rx="1.1" fill="#fdfdf8" />
      <rect x={x + 1} y="13.8" width="2.4" height="3" rx="0.9" fill={eye} />
      <rect x={x + 1.65} y="14.6" width="1.1" height="1.5" fill="#16141f" />
      <rect
        x={x + 1.2}
        y="14"
        width="0.9"
        height="0.9"
        fill="#ffffff"
        opacity="0.9"
      />
      <rect x={x} y="13" width="4.4" height="0.9" rx="0.45" fill="#2a2634" />
    </g>
  );
}

/* ---- hair ---------------------------------------------------------------- */

/** Layers painted BEHIND the torso (long curtains, the ponytail's tail). */
function BackHair({ style, c }: { style: string; c: PortraitColors }) {
  if (style === "ponytail") {
    return (
      <g>
        <path
          d="M28.5 8 Q34.5 10 34 20 Q33.6 27 30.5 31 Q28.8 31.8 28.2 30.4 Q30.8 26 30.6 20 Q30.4 12.8 26.8 10.2 Z"
          fill={c.hair}
          stroke={c.hairShade}
          strokeWidth="0.5"
        />
        <path
          d="M32.6 14 Q33 20 31.6 25"
          stroke={c.hairHi}
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity="0.7"
        />
        <rect
          x="29.6"
          y="11.6"
          width="3.4"
          height="1.8"
          rx="0.9"
          fill={c.shirt}
        />
      </g>
    );
  }
  // long — a soft sheet of hair falling to the shoulders
  return (
    <path
      d="M9 34 Q7.6 20 9.6 10 Q12 3.4 20 3.4 Q28 3.4 30.4 10 Q32.4 20 31 34 Q25 36.4 20 36.4 Q15 36.4 9 34 Z"
      fill={c.hairShade}
    />
  );
}

/** The style-specific FRONT hair (fringe, sides), over the face. */
function FrontHair({ style, c }: { style: string; c: PortraitColors }) {
  const hi = (
    <path
      d="M14 5.8 Q17 4.4 21 4.8"
      stroke={c.hairHi}
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
      opacity="0.85"
    />
  );
  switch (style) {
    case "buzz":
      return (
        <path
          d="M10.8 10.5 Q11 4.6 20 4.4 Q29 4.6 29.2 10.5 L28.4 10.5 Q28 7 25.6 6.6 Q20 8.2 14.4 6.6 Q12 7 11.6 10.5 Z"
          fill={c.hair}
          stroke={c.hairShade}
          strokeWidth="0.6"
          opacity="0.92"
        />
      );
    case "long":
      return (
        <g>
          <path
            d="M10 24 L10 10.5 Q10 3.6 20 3.6 Q30 3.6 30 10.5 L30 24 Q28.6 24.8 27.4 24 L27.4 12.5 Q26.6 9.8 24.2 9.8 Q21 8.2 17.8 9.4 Q13.6 9 13 12.5 L12.6 24 Q11.4 24.8 10 24 Z"
            fill={c.hair}
            stroke={c.hairShade}
            strokeWidth="0.6"
          />
          {hi}
        </g>
      );
    case "curly":
      return (
        <g>
          <g fill={c.hair} stroke={c.hairShade} strokeWidth="0.5">
            <circle cx="13" cy="8" r="3.4" />
            <circle cx="17.4" cy="5.8" r="3.6" />
            <circle cx="22.6" cy="5.8" r="3.6" />
            <circle cx="27" cy="8" r="3.4" />
            <circle cx="10.8" cy="12" r="2.6" />
            <circle cx="29.2" cy="12" r="2.6" />
            <path d="M10.4 13 Q10.4 5 20 5 Q29.6 5 29.6 13 L27.6 12 Q24 9.4 20 9.4 Q16 9.4 12.4 12 Z" />
          </g>
          <circle cx="15.5" cy="5.6" r="1" fill={c.hairHi} opacity="0.8" />
          <circle cx="21" cy="4.8" r="1" fill={c.hairHi} opacity="0.8" />
        </g>
      );
    case "ponytail":
      return (
        <g>
          <path
            d="M10.6 12.5 Q10.2 3.4 20 3.4 Q29.8 3.4 29.4 12.5 L27.4 12.5 Q28 8.6 24.8 8.2 Q19 9.8 14.2 8.6 Q12.6 9.2 12.6 12.5 Z"
            fill={c.hair}
            stroke={c.hairShade}
            strokeWidth="0.6"
          />
          {hi}
        </g>
      );
    case "medium":
      return (
        <g>
          <path
            d="M9.8 19 L9.8 10.5 Q9.8 3.2 20 3.2 Q30.2 3.2 30.2 10.5 L30.2 19 Q29 19.7 28 19 L28 12 Q27 9.6 25 9.6 Q22.8 8 20.4 9 Q17 7.8 14.6 9.4 Q12 9.6 12 12.5 L12 19 Q11 19.7 9.8 19 Z"
            fill={c.hair}
            stroke={c.hairShade}
            strokeWidth="0.6"
          />
          {hi}
        </g>
      );
    case "short":
    default:
      return (
        <g>
          <path
            d="M10.4 13 L10.4 10.5 Q10.4 3.6 20 3.6 Q29.6 3.6 29.6 10.5 L29.6 13 L27.2 13 L27.2 9.8 Q26 8.6 24.4 9.2 Q23.4 7.8 21.2 8.8 Q19.8 7.6 17.6 8.8 Q15.4 8 14.6 9.4 Q12.8 9 12.8 11 L12.8 13 Z"
            fill={c.hair}
            stroke={c.hairShade}
            strokeWidth="0.6"
          />
          {hi}
        </g>
      );
  }
}

/* ---- accessories ---------------------------------------------------------- */

function Glasses() {
  return (
    <g>
      <rect
        x="13"
        y="12.8"
        width="6"
        height="4.6"
        rx="1.4"
        fill="rgba(255,255,255,0.25)"
        stroke="#222033"
        strokeWidth="0.9"
      />
      <rect
        x="21"
        y="12.8"
        width="6"
        height="4.6"
        rx="1.4"
        fill="rgba(255,255,255,0.25)"
        stroke="#222033"
        strokeWidth="0.9"
      />
      <rect x="19" y="14.2" width="2" height="1" fill="#222033" />
      <rect x="10.6" y="14" width="2.4" height="0.9" fill="#222033" />
      <rect x="27" y="14" width="2.4" height="0.9" fill="#222033" />
    </g>
  );
}

/** Same fixed hat palette as the plaza sprite (beanie red / cap blue). */
function Hat({ kind }: { kind: string }) {
  if (kind === "beanie") {
    return (
      <g>
        <path
          d="M10 10.8 Q10 2.6 20 2.6 Q30 2.6 30 10.8 L30 12 L10 12 Z"
          fill="#a03c37"
        />
        <rect
          x="9.6"
          y="10.6"
          width="20.8"
          height="3"
          rx="1.5"
          fill={shade("#a03c37", -0.15)}
        />
        <rect
          x="13"
          y="4.6"
          width="5"
          height="1.4"
          rx="0.7"
          fill={shade("#a03c37", 0.18)}
        />
        <circle cx="20" cy="2" r="1.6" fill={shade("#a03c37", 0.35)} />
      </g>
    );
  }
  // cap
  return (
    <g>
      <path
        d="M10.2 11 Q10.2 3.2 20 3.2 Q29.8 3.2 29.8 11 L29.8 12.2 L10.2 12.2 Z"
        fill="#3c5e7f"
      />
      <rect
        x="10.2"
        y="10.9"
        width="19.6"
        height="1.4"
        fill="#2f4a66"
        opacity="0.85"
      />
      <path
        d="M27 10.8 Q35.6 10.8 35.8 13.6 Q30 13.2 26.8 12.8 Z"
        fill="#2f4a66"
      />
      <rect x="19.2" y="2.2" width="1.6" height="1.4" rx="0.7" fill="#7099f9" />
    </g>
  );
}
