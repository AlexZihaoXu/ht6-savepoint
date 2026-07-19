// Record-screen state machine + speaker colors (lib/record.ts) and the
// /speech/preview client (previewTranscribe) with a mocked fetch — the whole
// live-loop contract minus MediaRecorder, which jsdom doesn't have.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  API_BASE,
  previewTranscribe,
  type PreviewSegment,
} from "./api";
import {
  RECORD_INITIAL,
  recordReducer,
  SPEAKER_COLORS,
  speakerColor,
  type RecordAction,
  type RecordState,
} from "./record";

const SEGMENTS: PreviewSegment[] = [
  { speaker: "Speaker 1", start: 0.0, end: 1.8, text: "hey there" },
  { speaker: "Speaker 2", start: 2.1, end: 3.4, text: "oh hi!" },
];

/** Fold a list of actions through the reducer. */
function run(actions: RecordAction[], from: RecordState = RECORD_INITIAL) {
  return actions.reduce(recordReducer, from);
}

describe("recordReducer", () => {
  it("walks the happy path: request → started → preview → stop", () => {
    let s = run([{ type: "request" }]);
    expect(s.phase).toBe("requesting");

    s = run([{ type: "started" }, { type: "tick", elapsed: 7 }], s);
    expect(s.phase).toBe("recording");
    expect(s.elapsed).toBe(7);

    s = run(
      [{ type: "preview-start" }, { type: "preview-ok", segments: SEGMENTS }],
      s,
    );
    expect(s.segments).toEqual(SEGMENTS);
    expect(s.previewing).toBe(false);
    expect(s.previewedOnce).toBe(true);

    s = run([{ type: "stop" }], s);
    expect(s.phase).toBe("saving");
  });

  it("a preview REPLACES the transcript (full re-transcription, not a delta)", () => {
    const first = run([
      { type: "started" },
      { type: "preview-ok", segments: SEGMENTS },
    ]);
    const shorter = [SEGMENTS[0]];
    const next = recordReducer(first, {
      type: "preview-ok",
      segments: shorter,
    });
    expect(next.segments).toEqual(shorter);
  });

  it("never runs two previews at once — preview-start is a no-op while one is in flight", () => {
    const inFlight = run([{ type: "started" }, { type: "preview-start" }]);
    expect(inFlight.previewing).toBe(true);
    expect(recordReducer(inFlight, { type: "preview-start" })).toBe(inFlight);
  });

  it("preview-fail keeps the last good transcript", () => {
    const s = run([
      { type: "started" },
      { type: "preview-ok", segments: SEGMENTS },
      { type: "preview-start" },
      { type: "preview-fail" },
    ]);
    expect(s.segments).toEqual(SEGMENTS);
    expect(s.previewing).toBe(false);
  });

  it("accepts a late preview result while saving, but not after reset", () => {
    const saving = run([{ type: "started" }, { type: "stop" }]);
    const late = recordReducer(saving, {
      type: "preview-ok",
      segments: SEGMENTS,
    });
    expect(late.phase).toBe("saving");
    expect(late.segments).toEqual(SEGMENTS);

    const idle = recordReducer(late, { type: "reset" });
    expect(
      recordReducer(idle, { type: "preview-ok", segments: SEGMENTS }).segments,
    ).toEqual([]);
  });

  it("save failure → save-failed with the reason, retry → saving again", () => {
    const failed = run([
      { type: "started" },
      { type: "stop" },
      { type: "save-fail", message: "Couldn't save — backend unreachable." },
    ]);
    expect(failed.phase).toBe("save-failed");
    expect(failed.message).toMatch(/unreachable/);

    const retrying = recordReducer(failed, { type: "retry-save" });
    expect(retrying.phase).toBe("saving");
    expect(retrying.message).toBe("");
  });

  it("denied carries the friendly reason and drops any stale transcript", () => {
    const s = run([
      { type: "started" },
      { type: "preview-ok", segments: SEGMENTS },
      { type: "denied", message: "Mic permission was denied." },
    ]);
    expect(s.phase).toBe("denied");
    expect(s.segments).toEqual([]);
    expect(s.message).toMatch(/denied/);
  });

  it("ignores ticks and stops outside the recording phase", () => {
    expect(recordReducer(RECORD_INITIAL, { type: "tick", elapsed: 9 })).toBe(
      RECORD_INITIAL,
    );
    expect(recordReducer(RECORD_INITIAL, { type: "stop" })).toBe(
      RECORD_INITIAL,
    );
  });
});

describe("speakerColor", () => {
  it("is stable per label and keyed on the speaker number", () => {
    expect(speakerColor("Speaker 1")).toBe(SPEAKER_COLORS[0]);
    expect(speakerColor("Speaker 2")).toBe(SPEAKER_COLORS[1]);
    expect(speakerColor("Speaker 1")).toBe(speakerColor("Speaker 1"));
    // wraps around the palette instead of running out
    expect(speakerColor(`Speaker ${SPEAKER_COLORS.length + 1}`)).toBe(
      SPEAKER_COLORS[0],
    );
  });

  it("still colors non-numbered labels deterministically", () => {
    const c = speakerColor("waterprism");
    expect(SPEAKER_COLORS).toContain(c);
    expect(speakerColor("waterprism")).toBe(c);
  });
});

describe("previewTranscribe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the blob as multipart `audio` and returns the segments", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ segments: SEGMENTS }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewTranscribe(
      new Blob(["abc"], { type: "audio/webm" }),
    );
    expect(result.segments).toEqual(SEGMENTS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${API_BASE}/speech/preview`);
    expect(init.method).toBe("POST");
    const audio = (init.body as FormData).get("audio");
    expect(audio).toBeInstanceOf(Blob);
    expect((audio as Blob).size).toBe(3);
  });

  it("throws ApiError with the status on a non-ok response (e.g. empty upload → 400)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 400 })),
    );
    await expect(previewTranscribe(new Blob([]))).rejects.toThrowError(
      ApiError,
    );
    await expect(previewTranscribe(new Blob([]))).rejects.toMatchObject({
      status: 400,
    });
  });
});
