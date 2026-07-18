import { PiPlant } from "react-icons/pi";
import { Icon } from "./Icon";

/**
 * Suspense fallback shown while a lazy-loaded route chunk downloads.
 * Kept quiet and cozy — a gently pulsing sprout — so a fast load barely
 * registers and a slow one still feels on-theme. role="status" lets screen
 * readers announce the wait politely; the pulse is disabled for
 * prefers-reduced-motion by the global media query in globals.css.
 */
export function PageFallback() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-[40svh] flex-col items-center justify-center gap-2 text-center"
    >
      <span aria-hidden className="animate-pulse text-3xl text-[var(--accent)]">
        <Icon icon={PiPlant} />
      </span>
      <p className="text-sm text-[var(--muted)]">Loading your save…</p>
    </div>
  );
}
