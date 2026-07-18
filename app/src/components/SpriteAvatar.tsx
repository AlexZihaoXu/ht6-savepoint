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
    background: person.tint,
  };

  return (
    <Avatar
      aria-label={`${person.name} sprite`}
      className="pixelated shrink-0 ring-1 ring-[var(--separator)]"
      style={style}
    >
      <Avatar.Fallback className="text-sm font-semibold text-[oklch(20%_0.03_146)]">
        {person.initials}
      </Avatar.Fallback>
    </Avatar>
  );
}
