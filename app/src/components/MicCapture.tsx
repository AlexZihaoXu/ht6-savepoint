/**
 * SAV-40 — floating "record a moment" mic control. One tap records, another
 * uploads the clip to `POST /ingest/audio/clip` for diarized ingest; a small
 * speech bubble reports the outcome. Designed to sit in a floating-controls
 * stack over the pixel scenes (same footprint as the whistle button).
 */

import { PiMicrophone, PiStopFill } from "react-icons/pi";
import { Icon } from "./Icon";
import { formatElapsed, micSupported, useMicCapture } from "@/lib/mic";

export function MicCapture() {
  const { state, start, stop } = useMicCapture();
  const supported = micSupported();

  const bubble =
    state.phase === "done"
      ? `Saved — ${state.moments} ${state.moments === 1 ? "moment" : "moments"} captured`
      : state.phase === "error"
        ? state.message
        : null;

  return (
    <div className="flex flex-col items-end gap-2">
      {bubble && (
        <div
          role="status"
          className="pixel-bubble relative mb-1.5 w-44 px-3 py-2 text-left"
          // Stray taps on the bubble shouldn't close plaza bubbles behind it.
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs leading-snug">{bubble}</p>
          <span className="pixel-bubble-tail left-[82%] -translate-x-1/2" />
        </div>
      )}

      {state.phase === "recording" ? (
        <button
          type="button"
          aria-label="Stop recording"
          className="pixel-btn flex h-12 items-center gap-2 px-3"
          onClick={(e) => {
            e.stopPropagation();
            stop();
          }}
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#a03c37]"
          />
          <span className="font-pixel text-[11px] tabular-nums">
            {formatElapsed(state.elapsed)}
          </span>
          <Icon icon={PiStopFill} size={18} />
        </button>
      ) : state.phase === "uploading" ? (
        <button
          type="button"
          disabled
          className="pixel-btn flex h-12 items-center px-3"
        >
          <span className="font-pixel animate-pulse text-[10px]">Saving…</span>
        </button>
      ) : (
        <button
          type="button"
          aria-label={
            supported ? "Record a moment" : "Microphone not available"
          }
          className={`pixel-btn flex h-12 w-14 items-center justify-center ${supported ? "" : "opacity-50"}`}
          onClick={(e) => {
            e.stopPropagation();
            void start();
          }}
        >
          <Icon icon={PiMicrophone} size={26} />
        </button>
      )}
    </div>
  );
}
