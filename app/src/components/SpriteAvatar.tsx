import { Avatar } from "@heroui/react";
import type { CSSProperties } from "react";
import type { Person } from "@/lib/seed";

/**
 * Placeholder pixel-sprite for a person. Real sprites are assembled
 * parametrically from face attributes on-device (DESIGN.md §7); until that
 * lands we show a tinted square with the person's initials. `.pixelated`
 * keeps it crisp when scaled.
 */
export function SpriteAvatar({
  person,
  size = 48,
}: {
  person: Person;
  size?: number;
}) {
  const style: CSSProperties = {
    width: size,
    height: size,
  };

  return (
    <Avatar
      aria-label={`${person.name} sprite`}
      className="pixelated shrink-0 ring-1 ring-[var(--separator)]"
      style={style}
    >
      {/* Tint + dark initials live on the Fallback itself: HeroUI's Fallback paints its
          own background, which in dark mode was covering the tinted container and leaving
          dark-on-dark initials. Tints are light pastels, so dark ink reads in both themes. */}
      <Avatar.Fallback
        className="flex h-full w-full items-center justify-center text-sm font-semibold"
        style={{ background: person.tint, color: "oklch(20% 0.03 146)" }}
      >
        {person.initials}
      </Avatar.Fallback>
    </Avatar>
  );
}
