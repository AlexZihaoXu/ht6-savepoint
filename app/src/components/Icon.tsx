import type { IconType } from "react-icons";

interface IconProps {
  /** react-icons glyph to render — import it specifically (e.g. PiPlant). */
  icon: IconType;
  /**
   * Accessible label for a meaningful icon. Omit for purely decorative icons;
   * those are hidden from assistive tech instead.
   */
  label?: string;
  className?: string;
  /** Optional pixel/size override. By default the glyph is 1em and follows the
   * surrounding text size, so prefer a text-* class on `className`. */
  size?: number | string;
}

/**
 * Shared icon wrapper for the whole app. react-icons glyphs inherit
 * `currentColor` and default to 1em, so colour comes from the surrounding
 * text colour (e.g. the accent var) and size from a text-* class — keeping
 * every icon on one sizing + theming convention.
 */
export function Icon({ icon: Glyph, label, className, size }: IconProps) {
  return (
    <Glyph
      className={className}
      size={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
    />
  );
}
