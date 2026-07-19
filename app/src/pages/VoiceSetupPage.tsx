/**
 * /voice-setup — enroll this listener's own voice so the backend can
 * recognize them by voiceprint during diarization instead of leaving them as
 * an anonymous "Speaker N". Much simpler than /record: no live preview
 * polling, no reducer — just idle → recording → saving → done/error, plain
 * useState (`RecordPage.tsx` is the template for the mic-permission +
 * MediaRecorder plumbing below).
 *
 * All browser-media access is guarded (`micSupported`) so the page renders in
 * jsdom; the actual record/stop/upload flow is real-browser/manual territory
 * exactly like RecordPage's own docstring says — this page's test only
 * covers the GET /voice/status render states.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PiArrowCounterClockwise,
  PiCaretLeft,
  PiCheckCircle,
  PiMicrophone,
  PiMicrophoneSlash,
  PiStopFill,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelHeader } from "@/components/PixelChrome";
import { useToast } from "@/lib/toast";
import { api, ApiError, enrollVoice, type VoiceStatus } from "@/lib/api";
import { formatElapsed, micSupported, pickAudioMime } from "@/lib/mic";
import { toUploadWav } from "@/lib/wav";

type Phase =
  /** Landing state — status card + big record button, nothing running. */
  | "idle"
  /** Waiting on the mic-permission prompt. */
  | "requesting"
  /** Mic unavailable or permission denied. */
  | "denied"
  /** Recorder running. */
  | "recording"
  /** Stopped; uploading the sample to /voice/enroll. */
  | "saving"
  /** Upload failed — clip retained, offer retry. */
  | "save-failed"
  /** Enrollment just succeeded. */
  | "done";

function fmtEnrolledAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function VoiceSetupPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const clipRef = useRef<Blob | null>(null); // kept for save retries
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Touches refs only, so the identity is stable — safe as an effect dep.
  const releaseMedia = () => {
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    tickTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  // Load current enrollment state on mount.
  useEffect(() => {
    const ac = new AbortController();
    setStatusLoading(true);
    api
      .voiceStatus(ac.signal)
      .then((s) => {
        setStatus(s);
        setStatusLoading(false);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setStatusLoading(false);
      });
    return () => ac.abort();
  }, []);

  // Unmount: drop the mic, timers, and any in-flight upload.
  useEffect(
    () => () => {
      releaseMedia();
      abortRef.current?.abort();
    },
    [],
  );

  // Back = wherever the user came from; a cold-opened /voice-setup → the plaza.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/plaza", { replace: true });
  };

  /** Upload the finished sample; on success reflect the new enrollment. */
  const saveClip = async (blob: Blob) => {
    setPhase("saving");
    try {
      // The real voiceprint pipeline reads the upload as WAV verbatim —
      // transcode the browser's webm/mp4 recording first (same as RecordPage).
      const upload = await toUploadWav(blob);
      const result = await enrollVoice(upload, abortRef.current?.signal);
      setStatus({ enrolled: result.enrolled, enrolled_at: result.enrolled_at });
      setPhase("done");
      toast.show("success", "Your voice is set up");
    } catch (e) {
      const why =
        e instanceof ApiError
          ? `the backend said HTTP ${e.status}`
          : "the backend can't be reached";
      setMessage(`Couldn't save your voice sample — ${why}.`);
      setPhase("save-failed");
      toast.show("error", `Voice not saved — ${why}.`);
    }
  };

  const start = async () => {
    if (recorderRef.current) return; // already recording
    setPhase("requesting");

    if (!micSupported()) {
      setMessage("Recording needs a secure context — open the app over HTTPS.");
      setPhase("denied");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMessage("Mic permission was denied — allow the microphone and retry.");
      setPhase("denied");
      return;
    }

    // Pick a codec the browser can actually produce — Safari/iOS records mp4,
    // not webm — so the clip's type (and thus the upload filename) is honest.
    const mime = pickAudioMime();
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    clipRef.current = null;
    mimeRef.current = recorder.mimeType || mime || "audio/webm";
    abortRef.current = new AbortController();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const clip = new Blob(chunksRef.current, { type: mimeRef.current });
      releaseMedia();
      clipRef.current = clip;
      void saveClip(clip);
    };

    recorder.start(1000);
    recorderRef.current = recorder;
    streamRef.current = stream;
    setElapsed(0);
    setPhase("recording");

    const startedMs = Date.now();
    tickTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedMs) / 1000));
    }, 500);
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const retrySave = () => {
    const clip = clipRef.current;
    if (!clip) return;
    void saveClip(clip);
  };

  const discard = () => {
    clipRef.current = null;
    setPhase("idle");
  };

  const subtitle =
    phase === "recording"
      ? "Capturing — speak naturally, about 10 seconds is plenty"
      : phase === "saving"
        ? "Saving your voice sample…"
        : "Record about 10 seconds of yourself talking so SavePoint can recognize your voice in conversations";

  return (
    <div className="app-h flex flex-col overflow-hidden">
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
          <h1 id="voice-setup-heading" className="font-pixel text-[13px]">
            Set up your voice
          </h1>
          <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>
        </div>
        {phase === "recording" && (
          <span className="flex flex-none items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#a03c37]"
            />
            <span className="font-pixel text-[11px] tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          </span>
        )}
      </div>

      <section
        aria-labelledby="voice-setup-heading"
        className="grass-bg scene-dimmable flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-3 py-3"
      >
        {phase === "denied" ? (
          <DeniedPanel message={message} onRetry={() => void start()} />
        ) : phase === "save-failed" ? (
          <SaveFailedPanel
            message={message}
            onRetry={retrySave}
            onDiscard={discard}
          />
        ) : phase === "done" ? (
          <DonePanel enrolledAt={status?.enrolled_at ?? null} />
        ) : phase === "recording" ? (
          <RecordingPanel elapsed={elapsed} />
        ) : (
          <StatusPanel loading={statusLoading} status={status} />
        )}
      </section>

      {/* the big record toggle */}
      <div className="pixel-bar flex flex-none flex-col items-center gap-1.5 px-4 pt-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
        {phase === "recording" ? (
          <button
            type="button"
            aria-label="Stop and save your voice sample"
            className="pixel-btn pixel-btn-primary flex h-14 w-full max-w-xs items-center justify-center gap-2.5"
            onClick={stop}
          >
            <Icon icon={PiStopFill} size={22} />
            <span className="font-pixel text-[13px]">Stop &amp; save</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={
              status?.enrolled ? "Re-record your voice" : "Record your voice"
            }
            disabled={phase === "saving" || phase === "requesting"}
            className={`pixel-btn pixel-btn-primary flex h-14 w-full max-w-xs items-center justify-center gap-2.5 ${
              phase === "saving" || phase === "requesting" ? "opacity-60" : ""
            }`}
            onClick={() => void start()}
          >
            <Icon icon={PiMicrophone} size={22} />
            <span className="font-pixel text-[13px]">
              {phase === "saving"
                ? "Saving…"
                : phase === "requesting"
                  ? "Asking for the mic…"
                  : status?.enrolled
                    ? "Re-record"
                    : "Record"}
            </span>
          </button>
        )}
        <p className="text-center text-[11px] text-[var(--muted)]">
          {phase === "recording"
            ? "Stop whenever you've said enough — a few sentences is plenty."
            : "Your voice never leaves this recording as raw audio to anyone but the enrollment step."}
        </p>
      </div>
    </div>
  );
}

/** Current enrollment state — the idle/landing view. */
function StatusPanel({
  loading,
  status,
}: {
  loading: boolean;
  status: VoiceStatus | null;
}) {
  if (loading) {
    return (
      <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="animate-pulse text-sm text-[var(--muted)]">
          Checking your voice setup…
        </p>
      </div>
    );
  }

  if (status?.enrolled) {
    return (
      <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-8 text-center">
        <Icon icon={PiCheckCircle} size={32} className="text-[#4f8a5b]" />
        <p className="text-sm font-medium">Your voice is set up</p>
        {status.enrolled_at && (
          <p className="text-xs text-[var(--muted)]">
            Last recorded {fmtEnrolledAt(status.enrolled_at)}
          </p>
        )}
        <p className="mt-1 text-xs text-[var(--muted)]">
          Re-record any time — the newest sample replaces the old one.
        </p>
      </div>
    );
  }

  return (
    <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-8 text-center">
      <Icon icon={PiMicrophone} size={32} className="opacity-60" />
      <p className="text-sm font-medium">Not set up yet</p>
      <p className="text-xs text-[var(--muted)]">
        Hit Record below and talk for about 10 seconds.
      </p>
    </div>
  );
}

/** Live recording readout — just the elapsed time, no visualizer. */
function RecordingPanel({ elapsed }: { elapsed: number }) {
  return (
    <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-8 text-center">
      <Icon
        icon={PiMicrophone}
        size={32}
        className="animate-pulse text-[#a03c37]"
      />
      <p className="font-pixel text-[15px] tabular-nums">
        {formatElapsed(elapsed)}
      </p>
      <p className="text-sm text-[var(--muted)]">Listening…</p>
    </div>
  );
}

/** Enrollment just succeeded. */
function DonePanel({ enrolledAt }: { enrolledAt: string | null }) {
  return (
    <div className="pixel-panel mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-8 text-center">
      <Icon icon={PiCheckCircle} size={32} className="text-[#4f8a5b]" />
      <p className="text-sm font-medium">Nice — your voice is set up</p>
      {enrolledAt && (
        <p className="text-xs text-[var(--muted)]">
          Saved {fmtEnrolledAt(enrolledAt)}
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
        Your sample is still here — retry once the backend is reachable.
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
          <span className="font-pixel text-[11px]">Discard</span>
        </button>
      </div>
    </div>
  );
}
