/**
 * Browser-side transcode of a recorded clip (webm/opus on Chrome/Android,
 * mp4/aac on Safari/iOS) into 16 kHz mono 16-bit PCM WAV.
 *
 * The backend's real speech pipeline (SAV-63) reads the uploaded bytes as a
 * WAV file verbatim — it does NOT decode compressed containers, so a raw
 * browser recording comes back with zero segments. We decode + resample here,
 * where the browser already ships the codecs. 16 kHz mono is what the
 * diarizer/whisper want and keeps the upload ~6× smaller than 48 kHz stereo.
 *
 * Browser-only: `blobToWav` uses (Offline)AudioContext, absent in jsdom.
 * `encodeWav` is split out pure so the WAV framing stays unit-testable.
 */

/** Whisper/pyannote's native rate; also shrinks the upload vs 48 kHz. */
const TARGET_RATE = 16000;

type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** True when this browser can transcode audio (Web Audio + offline render). */
export function canTranscodeAudio(): boolean {
  return (
    audioContextCtor() !== null && typeof OfflineAudioContext !== "undefined"
  );
}

/** Decode any browser-recorded blob and re-encode it as 16 kHz mono WAV. */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error("Web Audio API unavailable");
  const bytes = await blob.arrayBuffer();
  const ctx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } finally {
    void ctx.close();
  }
  const mono = await resampleMono(decoded, TARGET_RATE);
  return encodeWav(mono, TARGET_RATE);
}

/**
 * The upload form the backend can actually diarize: transcode compressed
 * recordings to WAV, but pass through anything already WAV and fall back to
 * the raw blob if decoding fails (best-effort — lets the server try the bytes
 * rather than dropping the recording entirely).
 */
export async function toUploadWav(blob: Blob): Promise<Blob> {
  if (blob.type.includes("wav") || !canTranscodeAudio()) return blob;
  try {
    return await blobToWav(blob);
  } catch {
    return blob;
  }
}

/** Downmix to mono and resample to `rate` via an offline render. */
async function resampleMono(
  buf: AudioBuffer,
  rate: number,
): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil(buf.duration * rate));
  const offline = new OfflineAudioContext(1, frames, rate);
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Frame mono Float32 PCM (−1..1) as a 16-bit little-endian WAV ArrayBuffer.
 * Pure and Blob-free so it's unit-testable in jsdom (whose Blob has no
 * `arrayBuffer()`).
 */
export function encodeWavBuffer(
  samples: Float32Array,
  rate: number,
): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLen = samples.length * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataLen));
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  view.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return view.buffer;
}

/** Mono Float32 PCM (−1..1) → a 16-bit little-endian WAV Blob. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  return new Blob([encodeWavBuffer(samples, rate)], { type: "audio/wav" });
}
