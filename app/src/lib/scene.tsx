/**
 * Scene COMPONENTS for the pixel screens: the growth-stage plant sprite and
 * scenery props (trees, rocks, fences, lamp, cabin), all cut from
 * waterprism's spritesheet into `public/assets/sheet/`. Pure helpers live in
 * scene-utils.ts.
 */

/* ---- growth-stage plant sprite ----------------------------------------- */

/** The sheet's flower columns — four palettes, each drawn in 4 growth rows. */
const FLOWER_COLORS = ["pink", "gold", "blue", "green"] as const;

/** Deterministic flower colour per seed (e.g. the day's ISO date). */
function flowerColor(seed: string): (typeof FLOWER_COLORS)[number] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return FLOWER_COLORS[h % FLOWER_COLORS.length];
}

/**
 * A day's plant: stage 0 (bare soil) .. 4 (full bloom), straight from the
 * sheet's flower growth rows. Same seed → same flower colour, so a day keeps
 * its plant across renders. Bigger stage = bigger, fuller flower — the
 * garden reads at a glance.
 */
export function PlantSprite({
  stage,
  size = 22,
  seed = "",
  className,
}: {
  stage: number;
  size?: number;
  seed?: string;
  className?: string;
}) {
  const s = Math.max(0, Math.min(4, stage));
  if (s === 0) {
    return (
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className={className}
        aria-hidden
      >
        <rect x="6" y="12" width="4" height="2" fill="#875940" opacity="0.55" />
      </svg>
    );
  }
  return (
    <img
      src={`/assets/sheet/flower-${flowerColor(seed)}-${s}.png`}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      className={`pixelated pointer-events-none select-none ${className ?? ""}`}
    />
  );
}

/* ---- scenery props ------------------------------------------------------ */

interface PropStyle {
  className?: string;
  style?: React.CSSProperties;
}

function propImg(src: string) {
  return function Prop({ className, style }: PropStyle) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        className={`pixelated pointer-events-none select-none ${className ?? ""}`}
        style={style}
      />
    );
  };
}

/** The sheet's leafy oak (33x41). */
export const Tree = propImg("/assets/sheet/tree-oak.png");
/** The sheet's rounder second tree (31x41) — keeps the old `Pine` name so
    call sites stay untouched. */
export const Pine = propImg("/assets/sheet/tree-round.png");
/** Street lamp (10x40). */
export const Lamp = propImg("/assets/sheet/lamp.png");
/** Fallen log (25x11). */
export const Log = propImg("/assets/sheet/log.png");
/** The red-roof cabin (72x95) — day-scene backdrop. */
export const Cabin = propImg("/assets/sheet/cabin.png");

const ROCK_BIG = propImg("/assets/sheet/rock.png");
const ROCK_SMALL = propImg("/assets/sheet/pebbles.png");

export function Rock({
  small,
  className,
  style,
}: PropStyle & { small?: boolean }) {
  const Img = small ? ROCK_SMALL : ROCK_BIG;
  return <Img className={className} style={style} />;
}

/** Tiny ground accents scattered on the grass. */
export function GroundFlower({
  kind,
  className,
  style,
}: PropStyle & { kind: "mushroom" | "daisies" | "buttercups" }) {
  const Img = DECO[kind];
  return <Img className={className} style={style} />;
}
const DECO = {
  mushroom: propImg("/assets/sheet/deco-mushroom.png"),
  daisies: propImg("/assets/sheet/deco-daisies.png"),
  buttercups: propImg("/assets/sheet/deco-buttercups.png"),
};

/** A run of wooden fence — the sheet's post+rails piece on a 16px period,
    tiled to any width at 1.5x. */
export function FenceRow({ className, style }: PropStyle) {
  return (
    <div
      aria-hidden
      className={`pixelated pointer-events-none select-none ${className ?? ""}`}
      style={{
        height: 36,
        backgroundImage: 'url("/assets/sheet/fence.png")',
        backgroundSize: "24px 36px",
        backgroundRepeat: "repeat-x",
        ...style,
      }}
    />
  );
}
