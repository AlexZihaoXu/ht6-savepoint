/**
 * Parametric placeholder sprite (DESIGN §7).
 *
 * Composes a cozy little character DETERMINISTICALLY from the 6 avatar axes the
 * backend derives per person (`AvatarParams`) — same person → same sprite. This
 * is a vector stand-in for the real palette-swappable pixel kit (still to build
 * with waterprism); the value it proves now is that identity → a stable, readable
 * character straight from `/people` data, no art pipeline required yet.
 */

import type { AvatarParams } from "./api";

const SKIN: Record<string, string> = {
  porcelain: "#ffe0c4",
  fair: "#f2c79a",
  tan: "#d9a066",
  brown: "#a9714b",
  deep: "#6b4423",
};

const HAIR: Record<string, string> = {
  black: "#20232a",
  "dark-brown": "#3b2417",
  brown: "#6b4423",
  auburn: "#8d4a2f",
  blonde: "#e6c86e",
  red: "#b5432f",
  gray: "#9a9a9a",
  white: "#e8e8e8",
};

const SHIRT: Record<string, string> = {
  red: "#d1495b",
  orange: "#e8853a",
  yellow: "#e8c34a",
  green: "#5fa855",
  teal: "#3aa6a0",
  blue: "#4573b8",
  indigo: "#5b5bc7",
  violet: "#9a5bc7",
};

const fallback = (map: Record<string, string>, key: string, def: string) =>
  map[key] ?? def;

/** A crisp, flat-shaded ¾-view character composed from the avatar axes. */
export function ParametricSprite({
  params,
  size = 64,
  className,
}: {
  params: AvatarParams;
  size?: number;
  className?: string;
}) {
  const skin = fallback(SKIN, params.skin_tone, "#f2c79a");
  const hair = fallback(HAIR, params.hair_color, "#3b2417");
  const shirt = fallback(SHIRT, params.shirt_color, "#4573b8");
  const skinShade = shade(skin, -0.12);
  const shirtShade = shade(shirt, -0.14);

  return (
    <svg
      viewBox="0 0 20 24"
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label="character sprite"
    >
      {/* shadow */}
      <ellipse cx="10" cy="23" rx="6" ry="1.1" fill="rgba(0,0,0,0.18)" />
      {/* legs + shoes */}
      <rect x="7" y="18" width="2.5" height="4" fill={shirtShade} />
      <rect x="10.5" y="18" width="2.5" height="4" fill={shirtShade} />
      <rect x="6.6" y="21.4" width="3.2" height="1.6" fill="#3a2b22" />
      <rect x="10.2" y="21.4" width="3.2" height="1.6" fill="#3a2b22" />
      {/* torso / shirt */}
      <rect x="5.5" y="12" width="9" height="7" rx="1.4" fill={shirt} />
      <rect x="5.5" y="12" width="9" height="1.6" fill={shade(shirt, 0.12)} />
      {/* arms */}
      <rect x="4" y="12.3" width="2" height="5" rx="1" fill={shirt} />
      <rect x="14" y="12.3" width="2" height="5" rx="1" fill={shirt} />
      <rect x="4.2" y="16.4" width="1.7" height="1.7" rx="0.8" fill={skin} />
      <rect x="14.1" y="16.4" width="1.7" height="1.7" rx="0.8" fill={skin} />
      {/* neck */}
      <rect x="9" y="10.6" width="2" height="2" fill={skinShade} />
      {/* head */}
      <rect x="5.6" y="4" width="8.8" height="7.2" rx="2.6" fill={skin} />
      {/* hair (behind/around) + face + accessories */}
      <Hair style={params.hair_style} hair={hair} />
      <Eyes skin={skin} />
      {params.glasses && <Glasses />}
      {params.hat && <Hat kind={params.hat} hair={hair} />}
    </svg>
  );
}

function Eyes({ skin }: { skin: string }) {
  return (
    <g>
      <rect x="7.6" y="7.3" width="1.5" height="1.7" rx="0.5" fill="#2a2320" />
      <rect x="10.9" y="7.3" width="1.5" height="1.7" rx="0.5" fill="#2a2320" />
      {/* cheeks */}
      <rect
        x="6.7"
        y="8.7"
        width="1.4"
        height="1"
        rx="0.5"
        fill={shade(skin, -0.08)}
        opacity="0.7"
      />
      <rect
        x="11.9"
        y="8.7"
        width="1.4"
        height="1"
        rx="0.5"
        fill={shade(skin, -0.08)}
        opacity="0.7"
      />
      {/* smile */}
      <rect x="8.8" y="9.4" width="2.4" height="0.7" rx="0.35" fill="#7a4a3a" />
    </g>
  );
}

/** Hair shape varies by style; colour is a palette swap. */
function Hair({ style, hair }: { style: string; hair: string }) {
  const top = shade(hair, 0.1);
  switch (style) {
    case "buzz":
      return (
        <path d="M5.6 6.3 Q10 3.2 14.4 6.3 L14.4 5 Q10 3 5.6 5 Z" fill={hair} />
      );
    case "long":
      return (
        <g fill={hair}>
          <path d="M4.8 5.6 Q10 1.6 15.2 5.6 L15.2 12.5 L13.6 12.5 L13.6 6.4 Q10 4 6.4 6.4 L6.4 12.5 L4.8 12.5 Z" />
          <rect x="6" y="3.6" width="8" height="2.4" rx="1.6" fill={top} />
        </g>
      );
    case "curly":
      return (
        <g fill={hair}>
          <circle cx="6.4" cy="4.8" r="1.7" />
          <circle cx="8.8" cy="3.7" r="1.9" />
          <circle cx="11.4" cy="3.7" r="1.9" />
          <circle cx="13.6" cy="4.8" r="1.7" />
          <rect x="5.6" y="4.4" width="8.8" height="2.2" rx="1" />
        </g>
      );
    case "ponytail":
      return (
        <g fill={hair}>
          <path d="M5.6 5.8 Q10 2.6 14.4 5.8 L14.4 4.6 Q10 2.4 5.6 4.6 Z" />
          <rect x="5.5" y="4.2" width="9" height="2.2" rx="1.4" fill={top} />
          <path d="M14 5 q3.4 0.4 2.6 4 q-0.4 1.8 -2.2 2 l0 -2 q1 -0.4 0.8 -1.8 q-0.2 -1.4 -1.6 -1.4 Z" />
        </g>
      );
    case "medium":
      return (
        <g fill={hair}>
          <path d="M5.2 6.4 Q10 2.2 14.8 6.4 L14.8 9 L13.4 9 L13.4 6 Q10 3.6 6.6 6 L6.6 9 L5.2 9 Z" />
          <rect x="5.6" y="4" width="8.8" height="2.4" rx="1.6" fill={top} />
        </g>
      );
    case "short":
    default:
      return (
        <g fill={hair}>
          <path d="M5.4 6 Q10 2.4 14.6 6 L14.6 7 Q10 4.2 5.4 7 Z" />
          <rect x="5.6" y="3.9" width="8.8" height="2.6" rx="1.7" fill={top} />
        </g>
      );
  }
}

function Glasses() {
  return (
    <g fill="none" stroke="#2a2320" strokeWidth="0.5">
      <rect
        x="7.1"
        y="6.9"
        width="2.5"
        height="2.4"
        rx="0.6"
        fill="rgba(255,255,255,0.28)"
      />
      <rect
        x="10.4"
        y="6.9"
        width="2.5"
        height="2.4"
        rx="0.6"
        fill="rgba(255,255,255,0.28)"
      />
      <line x1="9.6" y1="7.9" x2="10.4" y2="7.9" />
    </g>
  );
}

function Hat({ kind, hair }: { kind: string; hair: string }) {
  if (kind === "beanie") {
    const c = shade(hair, 0.35);
    return (
      <g>
        <path
          d="M5.2 5.4 Q10 1.2 14.8 5.4 L14.8 6.2 L5.2 6.2 Z"
          fill="#c0553f"
        />
        <rect
          x="5.1"
          y="5.9"
          width="9.8"
          height="1.4"
          rx="0.7"
          fill={shade("#c0553f", -0.15)}
        />
        <rect x="9.4" y="1.9" width="1.2" height="1.2" rx="0.6" fill={c} />
      </g>
    );
  }
  // cap
  return (
    <g>
      <path d="M5.4 5.8 Q10 1.8 14.6 5.8 L14.6 6.4 L5.4 6.4 Z" fill="#3f6fb0" />
      <path d="M13.8 6 Q18 6 18 7.4 L13.8 7.2 Z" fill="#345d95" />
      <rect x="9.4" y="2.2" width="1.2" height="1" rx="0.5" fill="#5a8ad0" />
    </g>
  );
}

/** Lighten (t>0) / darken (t<0) a hex colour by a fraction. */
function shade(hex: string, t: number): string {
  const m = hex.replace("#", "");
  const n =
    m.length === 3
      ? m.split("").map((c) => parseInt(c + c, 16))
      : [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  const adj = n.map((v) =>
    Math.max(
      0,
      Math.min(255, Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t))),
    ),
  );
  return `#${adj.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
