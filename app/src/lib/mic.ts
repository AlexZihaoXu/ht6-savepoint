/**
 * Shared mic helpers (SAV-40 →). Recording itself lives in the /record
 * screen (`pages/RecordPage.tsx` + the `lib/record.ts` state machine), which
 * replaced the old inline `useMicCapture` FAB flow; what's left here are the
 * pure, environment-safe bits both the screen and tests share.
 *
 * MediaRecorder + getUserMedia are browser-only (and need a secure context),
 * so callers must gate every touch behind `micSupported()` — importing this
 * module never throws in jsdom.
 */

/** "mm:ss" for the recording timer. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** True when this browser/context can actually record (HTTPS or localhost). */
export function micSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
