/**
 * Scene COMPONENTS for the pixel screens: the growth-stage plant sprite and
 * scenery props (trees, rocks, fences, lamp, cabin), all cut from
 * waterprism's spritesheet into `public/assets/sheet/`. Pure helpers live in
 * scene-utils.ts.
 */

/* ---- day flower sprite --------------------------------------------------- */

/** The sheet's four flower palettes. */
const FLOWER_COLORS = ["pink", "gold", "blue", "green"] as const;
/** Each palette has 4 distinct flowers (NOT growth stages) — same size. */
const FLOWER_SPECIES = [1, 2, 3, 4] as const;

/** FNV-ish hash so a seed maps deterministically to a palette + species. */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic flower colour per seed (e.g. the day's ISO date). */
function flowerColor(seed: string): (typeof FLOWER_COLORS)[number] {
  return FLOWER_COLORS[hashSeed(seed) % FLOWER_COLORS.length];
}

/** Deterministic flower species per seed — a different salt from the colour. */
function flowerSpecies(seed: string): (typeof FLOWER_SPECIES)[number] {
  return FLOWER_SPECIES[hashSeed(`${seed}#species`) % FLOWER_SPECIES.length];
}

/**
 * A day's flower. The four artwork variants per palette are DIFFERENT FLOWERS,
 * not growth frames — every flower renders at the SAME size (waterprism). Which
 * flower a day shows is deterministic from its seed for now; it becomes
 * user-pickable once the day model carries a chosen flower. `stage` only gates
 * whether a day has bloomed yet (0 = bare soil).
 */
export function PlantSprite({
  stage,
  size = 24,
  seed = "",
  className,
}: {
  stage: number;
  size?: number;
  seed?: string;
  className?: string;
}) {
  if (Math.max(0, stage) === 0) {
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
      src={`/assets/sheet/flower-${flowerColor(seed)}-${flowerSpecies(seed)}.png`}
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
