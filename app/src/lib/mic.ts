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

/**
 * Pick a `MediaRecorder` mime type this browser actually supports, preferring
 * Opus-in-WebM (Chrome/Firefox/Android) and falling back to MP4/AAC — Safari
 * and iOS cannot produce WebM and record `audio/mp4` instead. Returns
 * `undefined` (let the browser choose) when nothing is reported supported or
 * `isTypeSupported` is unavailable, so callers must still read back
 * `recorder.mimeType`. Never throws in jsdom (MediaRecorder is absent there).
 */
export function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const supported = MediaRecorder.isTypeSupported;
  if (typeof supported !== "function") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((c) => supported(c));
}

/**
 * File extension matching an audio mime type. The multipart upload's filename
 * must reflect the REAL container so the server-side decoder sniffs it right:
 * Safari records mp4, not the `.webm` the filenames used to hardcode.
 */
export function audioExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  return "webm";
}
