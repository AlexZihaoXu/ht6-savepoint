// Only the pure WAV framing is unit-tested — decode/resample need
// (Offline)AudioContext, which jsdom lacks, so blobToWav is verified by hand /
// e2e in a real browser. We read encodeWavBuffer directly because jsdom's Blob
// has no arrayBuffer().
import { describe, expect, it } from "vitest";
import { canTranscodeAudio, encodeWav, encodeWavBuffer } from "./wav";

function header(buf: ArrayBuffer) {
  const view = new DataView(buf);
  const str = (off: number, len: number) =>
    String.fromCharCode(
      ...Array.from({ length: len }, (_, i) => view.getUint8(off + i)),
    );
  return {
    view,
    riff: str(0, 4),
    wave: str(8, 4),
    fmt: str(12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: str(36, 4),
    dataLen: view.getUint32(40, true),
  };
}

describe("encodeWavBuffer", () => {
  it("writes a valid 16 kHz mono 16-bit PCM header", () => {
    const buf = encodeWavBuffer(new Float32Array([0, 1, -1, 0.5]), 16000);
    expect(buf.byteLength).toBe(44 + 4 * 2); // header + 4 samples × 2 bytes

    const h = header(buf);
    expect([h.riff, h.wave, h.fmt, h.data]).toEqual([
      "RIFF",
      "WAVE",
      "fmt ",
      "data",
    ]);
    expect(h.audioFormat).toBe(1); // PCM
    expect(h.channels).toBe(1); // mono
    expect(h.sampleRate).toBe(16000);
    expect(h.bitsPerSample).toBe(16);
    expect(h.blockAlign).toBe(2);
    expect(h.byteRate).toBe(16000 * 2);
    expect(h.dataLen).toBe(8);
  });

  it("clamps and scales samples to full-range int16", () => {
    const h = header(
      encodeWavBuffer(new Float32Array([0, 1, -1, 2, -2]), 8000),
    );
    expect(h.view.getInt16(44 + 0, true)).toBe(0);
    expect(h.view.getInt16(44 + 2, true)).toBe(0x7fff); // +1 → max
    expect(h.view.getInt16(44 + 4, true)).toBe(-0x8000); // -1 → min
    expect(h.view.getInt16(44 + 6, true)).toBe(0x7fff); // +2 clamps to max
    expect(h.view.getInt16(44 + 8, true)).toBe(-0x8000); // -2 clamps to min
  });
});

describe("encodeWav", () => {
  it("wraps the buffer in an audio/wav Blob", () => {
    const blob = encodeWav(new Float32Array([0, 0.25, -0.25]), 16000);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 3 * 2);
  });
});

describe("canTranscodeAudio", () => {
  it("is false in jsdom (no AudioContext) without throwing", () => {
    expect(canTranscodeAudio()).toBe(false);
  });
});
