/**
 * SAV-40 — app-side mic capture. `useMicCapture` drives one record → upload
 * cycle against `POST /ingest/audio/clip`: idle → recording (elapsed ticking)
 * → uploading → done/error, then back to idle after a beat.
 *
 * MediaRecorder + getUserMedia are browser-only (and need a secure context),
 * so every touch is guarded behind `micSupported()` — importing this module,
 * or rendering the hook, never throws in jsdom. Only the pure helpers here
 * are unit-tested; real recording is verified by hand in the browser.
 */

import { useEffect, useRef, useState } from "react";
import { ingestAudioClip } from "./api";

export type MicPhase = "idle" | "recording" | "uploading" | "done" | "error";

export interface MicState {
  phase: MicPhase;
  /** Whole seconds since recording began (recording phase only). */
  elapsed: number;
  /** How many moments (events) the backend heard in the clip (done phase). */
  moments: number;
  /** Friendly copy for the error phase. */
  message: string;
}

const IDLE: MicState = { phase: "idle", elapsed: 0, moments: 0, message: "" };

/** How long the done/error bubble lingers before returning to idle. */
const SETTLE_MS = 5000;

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

export function useMicCapture(): {
  state: MicState;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [state, setState] = useState<MicState>(IDLE);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseMedia = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  // Unmount: drop the mic + timers so no red "recording" indicator lingers.
  useEffect(
    () => () => {
      releaseMedia();
      if (settleRef.current) clearTimeout(settleRef.current);
    },
    [],
  );

  /** Show a terminal state, then drift back to idle. */
  const settle = (next: MicState) => {
    setState(next);
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => setState(IDLE), SETTLE_MS);
  };

  const start = async () => {
    if (recorderRef.current) return; // already recording
    if (settleRef.current) clearTimeout(settleRef.current);

    if (!micSupported()) {
      settle({
        ...IDLE,
        phase: "error",
        message: "Mic not available here — open the app over HTTPS.",
      });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      settle({
        ...IDLE,
        phase: "error",
        message: "Mic permission needed — allow the microphone and retry.",
      });
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    // The wall-clock moment recording begins — the server anchors diarized
    // segment offsets to it, so capture it at start(), not at upload time.
    const startedAt = new Date();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const type = recorder.mimeType || "audio/webm";
      releaseMedia();
      setState({ ...IDLE, phase: "uploading" });
      try {
        const result = await ingestAudioClip(
          new Blob(chunks, { type }),
          startedAt,
        );
        settle({ ...IDLE, phase: "done", moments: result.events.length });
      } catch {
        settle({
          ...IDLE,
          phase: "error",
          message: "Couldn't save that clip — is the backend awake?",
        });
      }
    };

    recorder.start();
    recorderRef.current = recorder;
    streamRef.current = stream;
    setState({ ...IDLE, phase: "recording" });
    tickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      setState((s) => (s.phase === "recording" ? { ...s, elapsed } : s));
    }, 500);
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  return { state, start, stop };
}
