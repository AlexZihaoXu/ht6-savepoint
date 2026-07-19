// SAV-40 — only the PURE capture logic is unit-tested (form assembly + timer
// formatting). MediaRecorder/getUserMedia don't exist in jsdom; recording is
// guarded behind micSupported() and verified by hand in a real browser.
import { describe, expect, it } from "vitest";
import { buildAudioClipForm } from "./api";
import { audioExt, formatElapsed, micSupported, pickAudioMime } from "./mic";

describe("buildAudioClipForm", () => {
  it("carries the clip and the ISO started_at the contract expects", () => {
    const blob = new Blob(["abc"], { type: "audio/webm" });
    const startedAt = new Date("2026-07-18T14:03:07.250Z");
    const form = buildAudioClipForm(blob, startedAt);

    const audio = form.get("audio");
    expect(audio).toBeInstanceOf(Blob);
    expect((audio as Blob).size).toBe(3);
    expect(form.get("started_at")).toBe("2026-07-18T14:03:07.250Z");
  });

  it("names the upload after the clip's real container (Safari records mp4)", () => {
    const webm = buildAudioClipForm(
      new Blob([], { type: "audio/webm" }),
      new Date(0),
    );
    const mp4 = buildAudioClipForm(
      new Blob([], { type: "audio/mp4;codecs=mp4a.40.2" }),
      new Date(0),
    );
    expect((webm.get("audio") as File).name).toBe("clip.webm");
    expect((mp4.get("audio") as File).name).toBe("clip.mp4");
  });
});

describe("audioExt", () => {
  it("maps mime types to the right extension, defaulting to webm", () => {
    expect(audioExt("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExt("audio/mp4;codecs=mp4a.40.2")).toBe("mp4");
    expect(audioExt("audio/x-m4a")).toBe("mp4");
    expect(audioExt("audio/aac")).toBe("mp4");
    expect(audioExt("audio/mpeg")).toBe("mp3");
    expect(audioExt("audio/ogg;codecs=opus")).toBe("ogg");
    expect(audioExt("audio/wav")).toBe("wav");
    expect(audioExt("")).toBe("webm");
    expect(audioExt("application/octet-stream")).toBe("webm");
  });
});

describe("pickAudioMime", () => {
  it("returns undefined in jsdom without throwing (no MediaRecorder here)", () => {
    expect(pickAudioMime()).toBeUndefined();
  });
});

describe("formatElapsed", () => {
  it("renders mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(7)).toBe("00:07");
    expect(formatElapsed(61)).toBe("01:01");
    expect(formatElapsed(600)).toBe("10:00");
  });

  it("never goes negative or fractional", () => {
    expect(formatElapsed(-3)).toBe("00:00");
    expect(formatElapsed(9.9)).toBe("00:09");
  });
});

describe("micSupported", () => {
  it("reports false in jsdom without throwing (no MediaRecorder here)", () => {
    expect(micSupported()).toBe(false);
  });
});
