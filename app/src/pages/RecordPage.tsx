/**
 * /record — the recording screen. One big toggle records a conversation while
 * a live transcript panel shows the separated speech ("Speaker N: text") as
 * the backend hears it: every ~6s (and only when no request is already in
 * flight) the audio accumulated so far is POSTed to the store-free
 * `POST /speech/preview` and the returned segments REPLACE the list.
 *
 * Stopping uploads the full clip to `POST /ingest/audio/clip` (the persisted
 * path, NTP-anchored at `startedAt`) and, on success, jumps straight into
 * today's dialogue scene scrubbed to the moment just recorded. Upload failure
 * keeps the clip in memory and offers a retry.
 *
 * All browser-media access is guarded (`micSupported`) so the page renders in
 * jsdom; the state machine itself lives in `lib/record.ts` where it's tested.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  PiArrowCounterClockwise,
  PiCaretLeft,
  PiEar,
  PiMicrophone,
  PiMicrophoneSlash,
  PiStopFill,
  PiTrash,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelHeader } from "@/components/PixelChrome";
import { useToast } from "@/lib/toast";
import { ApiError, ingestAudioClip, previewTranscribe } from "@/lib/api";
import { formatElapsed, micSupported } from "@/lib/mic";
import {
  RECORD_INITIAL,
  recordReducer,
  speakerColor,
  type RecordState,
} from "@/lib/record";

/** How often the accumulated audio is re-sent for a live preview. */
const PREVIEW_INTERVAL_MS = 6000;

export function RecordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [state, dispatch] = useReducer(recordReducer, RECORD_INITIAL);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const startedAtRef = useRef(new Date());
  const clipRef = useRef<Blob | null>(null); // kept for save retries
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Touches refs only, so the identity is stable — safe as an effect dep.
  const releaseMedia = useCallback(() => {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    tickTimerRef.current = null;
    previewTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Unmount (incl. the post-save navigation): drop the mic, timers, and any
  // in-flight preview so no red recording indicator or request lingers.
  useEffect(
    () => () => {
      releaseMedia();
      abortRef.current?.abort();
    },
    [releaseMedia],
  );

  // Back = wherever the user came from; a cold-opened /record → the plaza.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/plaza", { replace: true });
  };

  /** One preview round-trip — skipped while another is still running. */
  const runPreview = async () => {
    if (inFlightRef.current || chunksRef.current.length === 0) return;
    inFlightRef.current = true;
    dispatch({ type: "preview-start" });
    try {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      const { segments } = await previewTranscribe(
        blob,
        abortRef.current?.signal,
      );
      dispatch({ type: "preview-ok", segments });
    } catch {
      // Preview is best-effort — keep the last transcript, try again next tick.
      dispatch({ type: "preview-fail" });
    } finally {
      inFlightRef.current = false;
    }
  };

  /** Upload the finished clip; on success jump straight into today's scene. */
  const saveClip = async (blob: Blob) => {
    try {
      const result = await ingestAudioClip(blob, startedAtRef.current);
      toast.show("success", "Recording analyzed — here's your day");
      const latestTs = result.events
        .map((e) => e.ts)
        .sort()
        .at(-1);
      navigate(
        latestTs
          ? `/scene/today?t=${encodeURIComponent(latestTs)}`
          : "/scene/today",
        { replace: true },
      );
    } catch (e) {
      const why =
        e instanceof ApiError
          ? `the backend said HTTP ${e.status}`
          : "the backend can't be reached";
      dispatch({ type: "save-fail", message: `Couldn't save — ${why}.` });
      toast.show("error", `Recording not saved — ${why}.`);
    }
  };

  const start = async () => {
    if (recorderRef.current) return; // already recording
    dispatch({ type: "request" });

    if (!micSupported()) {
      dispatch({
        type: "denied",
        message: "Recording needs a secure context — open the app over HTTPS.",
      });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      dispatch({
        type: "denied",
        message: "Mic permission was denied — allow the microphone and retry.",
      });
      return;
    }

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    clipRef.current = null;
    mimeRef.current = recorder.mimeType || "audio/webm";
    // Wall-clock anchor for the server's segment timestamps — capture at
    // start, not upload time.
    startedAtRef.current = new Date();
    abortRef.current = new AbortController();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const clip = new Blob(chunksRef.current, { type: mimeRef.current });
      releaseMedia();
      dispatch({ type: "stop" });
      clipRef.current = clip;
      void saveClip(clip);
    };

    // Timesliced so the accumulated-so-far audio is always available as a
    // self-contained blob (header rides in the first chunk).
    recorder.start(1000);
    recorderRef.current = recorder;
    streamRef.current = stream;
    dispatch({ type: "started" });

    const startedMs = startedAtRef.current.getTime();
    tickTimerRef.current = setInterval(() => {
      dispatch({
        type: "tick",
        elapsed: Math.floor((Date.now() - startedMs) / 1000),
      });
    }, 500);
    previewTimerRef.current = setInterval(
      () => void runPreview(),
      PREVIEW_INTERVAL_MS,
    );
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const retrySave = () => {
    const clip = clipRef.current;
    if (!clip) return;
    dispatch({ type: "retry-save" });
    void saveClip(clip);
  };

  const discard = () => {
    clipRef.current = null;
    dispatch({ type: "reset" });
    goBack();
  };

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <PixelHeader />

      {/* sub-header: back + title + recording timer */}
      <div className="flex flex-none items-center gap-2 border-b-2 border-[var(--pixel-bar-border)] bg-[var(--pixel-bar-bg)] px-3 py-2">
        <button
          type="button"
          aria-label="Back"
          className="pixel-btn touch-target flex flex-none items-center justify-center"
          onClick={goBack}
        >
          <Icon icon={PiCaretLeft} size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 id="record-heading" className="font-pixel text-[13px]">
            Record a moment
          </h1>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">
            {state.phase === "recording"
              ? "Capturing — who says what shows up below"
              : state.phase === "saving"
                ? "Saving your recording…"
                : "Tape a conversation into today's journal"}
          </p>
        </div>
        {state.phase === "recording" && (
          <span className="flex flex-none items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#a03c37]"
            />
            <span className="font-pixel text-[11px] tabular-nums">
              {formatElapsed(state.elapsed)}
            </span>
          </span>
        )}
      </div>

      {/* transcript panel */}
      <section
        aria-labelledby="record-heading"
        className="grass-bg scene-dimmable min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {state.phase === "denied" ? (
          <DeniedPanel message={state.message} onRetry={() => void start()} />
        ) : state.phase === "save-failed" ? (
          <SaveFailedPanel
            message={state.message}
            onRetry={retrySave}
            onDiscard={discard}
          />
        ) : (
          <TranscriptPanel state={state} />
        )}
      </section>

      {/* the big record toggle */}
      <div className="pixel-bar flex flex-none flex-col items-center gap-1.5 px-4 pt-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
        {state.phase === "recording" ? (
          <button
            type="button"
            aria-label="Stop and save the recording"
            className="pixel-btn pixel-btn-primary flex h-14 w-full max-w-xs items-center justify-center gap-2.5"
            onClick={stop}
          >
            <Icon icon={PiStopFill} size={22} />
            <span className="font-pixel text-[13px]">Stop &amp; save</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Start recording"
            disabled={state.phase === "saving" || state.phase === "requesting"}
            className={`pixel-btn pixel-btn-primary flex h-14 w-full max-w-xs items-center justify-center gap-2.5 ${
              state.phase === "saving" || state.phase === "requesting"
                ? "opacity-60"
                : ""
            }`}
            onClick={() => void start()}
          >
            <Icon icon={PiMicrophone} size={22} />
            <span className="font-pixel text-[13px]">
              {state.phase === "saving"
                ? "Saving…"
                : state.phase === "requesting"
                  ? "Asking for the mic…"
                  : "Record"}
            </span>
          </button>
        )}
        <p className="text-center text-[11px] text-[var(--muted)]">
          {state.phase === "recording"
            ? "Stop when the conversation wraps — it saves to today."
            : "Live transcription is delayed a few seconds."}
        </p>
      </div>
    </div>
  );
}

/** The separated-speech list + listening/transcribing status line. */
function TranscriptPanel({ state }: { state: RecordState }) {
  const live = state.phase === "recording" || state.phase === "saving";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-2">
      {state.segments.length === 0 && (
        <div className="pixel-panel flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Icon
            icon={live ? PiEar : PiMicrophone}
            size={30}
            className="text-[var(--muted)]"
          />
          <p className="text-sm text-[var(--muted)]">
            {state.phase === "idle"
              ? "Hit Record and chat away — each voice gets its own line here."
              : state.previewedOnce
                ? "No words caught yet — keep talking, the next pass may hear you."
                : "Listening… the first lines take a few seconds to appear."}
          </p>
        </div>
      )}

      {state.segments.length > 0 && (
        <ol className="pixel-panel flex flex-col gap-2.5 px-3 py-3">
          {state.segments.map((seg, i) => (
            <li
              key={`${seg.speaker}-${seg.start}-${i}`}
              className="flex items-start gap-2"
            >
              <span
                className="font-pixel mt-0.5 flex-none border-b-2 px-1 pb-0.5 text-[9px] whitespace-nowrap"
                style={{
                  color: speakerColor(seg.speaker),
                  borderColor: speakerColor(seg.speaker),
                }}
              >
                {seg.speaker}
              </span>
              <span className="min-w-0 text-sm leading-snug">{seg.text}</span>
            </li>
          ))}
        </ol>
      )}

      {live && (
        <p
          role="status"
          className="animate-pulse px-1 text-center text-xs text-[var(--muted)]"
        >
          {state.previewing ? "transcribing…" : "listening…"}
        </p>
      )}
    </div>
  );
}

/** Mic unavailable / permission denied. */
function DeniedPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-8 text-center">
      <Icon icon={PiMicrophoneSlash} size={32} className="text-[#a03c37]" />
      <p className="text-sm">{message}</p>
      <button
        type="button"
        className="pixel-btn touch-target px-4 py-2"
        onClick={onRetry}
      >
        <span className="font-pixel text-[11px]">Try again</span>
      </button>
    </div>
  );
}

/** Upload failed — the clip is still in memory, so offer retry/discard. */
function SaveFailedPanel({
  message,
  onRetry,
  onDiscard,
}: {
  message: string;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-sm">{message}</p>
      <p className="text-xs text-[var(--muted)]">
        Your clip is still here — retry once the backend is reachable.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="pixel-btn pixel-btn-primary touch-target flex items-center gap-1.5 px-4 py-2"
          onClick={onRetry}
        >
          <Icon icon={PiArrowCounterClockwise} size={16} />
          <span className="font-pixel text-[11px]">Retry save</span>
        </button>
        <button
          type="button"
          className="pixel-btn touch-target flex items-center gap-1.5 px-4 py-2"
          onClick={onDiscard}
        >
          <Icon icon={PiTrash} size={16} />
          <span className="font-pixel text-[11px]">Discard</span>
        </button>
      </div>
    </div>
  );
}
