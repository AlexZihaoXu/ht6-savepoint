/**
 * Primary-nav active-state logic for the pixel bottom bar (PixelBottomNav).
 *
 * Pure so it's unit-testable without a router: given the current pathname,
 * return which of the three nav destinations should read as active — or
 * `null` when the route (e.g. /voice-setup) belongs to none of them.
 */

export type NavDest = "home" | "people" | "record";

/**
 * Which primary destination owns the current route.
 *   Home    → "/", "/plaza…", "/scene…" (the plaza world + the day scenes)
 *   People  → "/people…"
 *   Record  → "/record…"
 */
export function activeNav(pathname: string): NavDest | null {
  if (
    pathname === "/" ||
    pathname === "/plaza" ||
    pathname.startsWith("/plaza/") ||
    pathname === "/scene" ||
    pathname.startsWith("/scene/")
  ) {
    return "home";
  }
  if (pathname === "/people" || pathname.startsWith("/people/"))
    return "people";
  if (pathname === "/record" || pathname.startsWith("/record/"))
    return "record";
  return null;
}
