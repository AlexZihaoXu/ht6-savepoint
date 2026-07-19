/**
 * Record screen state — a pure reducer driving the /record flow so the whole
 * lifecycle (permission → recording → live preview polling → save) is unit
 * testable without MediaRecorder or a network. The page owns the impure bits
 * (getUserMedia, timers, fetch) and reports back through actions.
 *
 * Live-preview invariant the reducer enforces: only ONE preview request is in
 * flight at a time (`previewing`), and a preview result REPLACES the whole
 * transcript (the backend re-transcribes the audio accumulated so far — it is
 * not a delta).
 */

import type { PreviewSegment } from "./api";

export type RecordPhase =
  /** Landing state — big record button, nothing running. */
  | "idle"
  /** Waiting on the mic-permission prompt. */
  | "requesting"
  /** Mic unavailable or permission denied — show the fallback panel. */
  | "denied"
  /** Recorder running; preview loop live. */
  | "recording"
  /** Stopped; uploading the full clip to /ingest/audio/clip. */
  | "saving"
  /** Upload failed — clip retained, offer retry. */
  | "save-failed";

export interface RecordState {
  phase: RecordPhase;
  /** Whole seconds since recording began. */
  elapsed: number;
  /** Latest full separated-speech transcript (replaced, never appended). */
  segments: PreviewSegment[];
  /** A /speech/preview request is in flight right now. */
  previewing: boolean;
  /** At least one preview round-trip finished (drives the empty-state copy). */
  previewedOnce: boolean;
  /** Friendly reason for denied / save-failed phases. */
  message: string;
}

export type RecordAction =
  | { type: "request" }
  | { type: "denied"; message: string }
  | { type: "started" }
  | { type: "tick"; elapsed: number }
  | { type: "preview-start" }
  | { type: "preview-ok"; segments: PreviewSegment[] }
  | { type: "preview-fail" }
  | { type: "stop" }
  | { type: "save-fail"; message: string }
  | { type: "retry-save" }
  | { type: "reset" };

export const RECORD_INITIAL: RecordState = {
  phase: "idle",
  elapsed: 0,
  segments: [],
  previewing: false,
  previewedOnce: false,
  message: "",
};

export function recordReducer(
  state: RecordState,
  action: RecordAction,
): RecordState {
  switch (action.type) {
    case "request":
      return { ...RECORD_INITIAL, phase: "requesting" };
    case "denied":
      return { ...RECORD_INITIAL, phase: "denied", message: action.message };
    case "started":
      return { ...RECORD_INITIAL, phase: "recording" };
    case "tick":
      return state.phase === "recording"
        ? { ...state, elapsed: action.elapsed }
        : state;
    case "preview-start":
      // Guard: the page's timer must not fire two overlapping requests.
      return state.phase === "recording" && !state.previewing
        ? { ...state, previewing: true }
        : state;
    case "preview-ok":
      // A late result may land just after stop — the fresher transcript is
      // still worth showing while the clip uploads.
      return state.phase === "recording" || state.phase === "saving"
        ? {
            ...state,
            segments: action.segments,
            previewing: false,
            previewedOnce: true,
          }
        : state;
    case "preview-fail":
      // Keep whatever transcript we already had; just free the slot.
      return { ...state, previewing: false, previewedOnce: true };
    case "stop":
      return state.phase === "recording"
        ? { ...state, phase: "saving", previewing: false }
        : state;
    case "save-fail":
      return state.phase === "saving"
        ? { ...state, phase: "save-failed", message: action.message }
        : state;
    case "retry-save":
      return state.phase === "save-failed"
        ? { ...state, phase: "saving", message: "" }
        : state;
    case "reset":
      return RECORD_INITIAL;
  }
}

/* ---- stable speaker colors ------------------------------------------------ */

/**
 * Cozy-palette speaker swatches (readable on the tan `.pixel-panel` in both
 * themes). Order matters: Speaker 1 is always the first color, etc., so a
 * speaker's color never shifts between preview refreshes.
 */
export const SPEAKER_COLORS = [
  "#3e7a45", // garden green
  "#8a4f9e", // plum
  "#2f6f8f", // lake blue
  "#a03c37", // brick red
  "#b07d2b", // harvest gold
  "#5b5f97", // dusk indigo
] as const;

/**
 * Stable color for a diarization label. "Speaker N" keys on N so the mapping
 * survives re-transcription reordering; any other label hashes its characters.
 */
export function speakerColor(label: string): string {
  const m = /(\d+)\s*$/.exec(label);
  const idx = m
    ? Math.max(0, parseInt(m[1], 10) - 1)
    : [...label].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}
