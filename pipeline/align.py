#!/usr/bin/env python3
"""Offline diarized transcript with true overlapping-speech separation.

Pipeline (given a diarization JSON from diarize.py / Community-1):
  1. Classify the timeline into silence / single-speaker / overlap intervals.
  2. Build one clean audio track per speaker:
       - single-speaker intervals  -> copy the original audio
       - overlap intervals         -> SepFormer separates the mixture into two
         voices; each is assigned to a speaker by voiceprint similarity
  3. Transcribe each speaker's clean track with faster-whisper.
  4. Merge words by time into turns; mark turns that came from overlap.

Because overlaps are separated before transcription, both speakers' words are
recovered without the cross-talk duplication a single transcription stream has.

    HF_TOKEN=... .venv-stream/bin/python align.py clip.wav --diar clip_diar.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Overlap-separating diarized transcription.")
    p.add_argument("audio", type=str, help="audio/wav file")
    p.add_argument("--diar", type=str, required=True, help="diarization JSON (from diarize.py)")
    p.add_argument("--model", type=str, default="small.en", help="faster-whisper model (default: small.en)")
    p.add_argument("--language", type=str, default="en", help="language (default: en)")
    p.add_argument("--min-sep", type=float, default=0.6, help="min overlap length (s) to run separation (default: 0.6)")
    p.add_argument("--gap", type=float, default=1.0, help="split a speaker's words into a new turn after this gap (s)")
    p.add_argument("--no-separate", action="store_true", help="skip SepFormer; assign overlaps to the dominant speaker")
    p.add_argument("--out", type=str, default=None, help="optional path to write the transcript JSON")
    return p.parse_args()


def load_segments(path: str):
    data = json.loads(Path(path).read_text())
    return [(float(s["start"]), float(s["end"]), str(s["speaker"])) for s in data["segments"]]


def classify(segments):
    """Split the timeline into merged [t0, t1, kind, active_speakers] intervals."""
    pts = sorted({p for s0, s1, _ in segments for p in (s0, s1)})
    out = []
    for t0, t1 in zip(pts, pts[1:]):
        if t1 - t0 <= 1e-4:
            continue
        mid = 0.5 * (t0 + t1)
        active = sorted({spk for s0, s1, spk in segments if s0 <= mid <= s1})
        kind = "silence" if not active else ("single" if len(active) == 1 else "overlap")
        out.append([t0, t1, kind, active])
    merged = []
    for iv in out:
        if merged and merged[-1][2] == iv[2] and merged[-1][3] == iv[3]:
            merged[-1][1] = iv[1]
        else:
            merged.append(iv)
    return merged


def main() -> int:
    args = parse_args()
    for f in (args.audio, args.diar):
        if not Path(f).is_file():
            print(f"error: not found: {f}", file=sys.stderr)
            return 2

    import numpy as np
    import torch
    import torchaudio
    from faster_whisper import WhisperModel
    from pyannote.audio.pipelines.speaker_verification import PretrainedSpeakerEmbedding

    segments = load_segments(args.diar)
    speakers = sorted({spk for _, _, spk in segments})
    intervals = classify(segments)
    n_over = sum(1 for iv in intervals if iv[2] == "overlap")
    print(f"{len(segments)} segments, {len(speakers)} speakers, {n_over} overlap regions.", file=sys.stderr)

    print(f"Loading models ({args.model} + speaker embedding"
          f"{'' if args.no_separate else ' + SepFormer'})...", file=sys.stderr)
    asr = WhisperModel(args.model, device="cpu", compute_type="int8")
    embed_model = PretrainedSpeakerEmbedding("pyannote/wespeaker-voxceleb-resnet34-LM", device=torch.device("cpu"))

    separator = None
    if not args.no_separate and len(speakers) == 2:
        from speechbrain.inference.separation import SepformerSeparation
        separator = SepformerSeparation.from_hparams(
            source="speechbrain/sepformer-wsj02mix", savedir="_sepformer"
        )

    SR = 16000
    wav, sr = torchaudio.load(args.audio)
    mono = wav.mean(0).numpy().astype("float32")
    if sr != SR:
        mono = torchaudio.functional.resample(torch.from_numpy(mono), sr, SR).numpy()
    total = mono.shape[0]

    def embed(a):
        if a.shape[0] < int(0.4 * SR):
            return None
        t = torch.from_numpy(a).float().unsqueeze(0).unsqueeze(0)
        v = np.asarray(embed_model(t)[0], dtype=np.float64)
        n = np.linalg.norm(v)
        return v / n if n > 0 else v

    def separate(seg):
        mix8 = torchaudio.functional.resample(torch.from_numpy(seg), SR, 8000).unsqueeze(0)
        est = separator.separate_batch(mix8)  # (1, time, 2) @ 8k
        outs = []
        for i in range(est.shape[-1]):
            s = est[0, :, i].detach().cpu().numpy().astype("float32")
            s16 = torchaudio.functional.resample(torch.from_numpy(s), 8000, SR).numpy()
            outs.append(s16)
        return outs

    def fit(x, n):
        if x.shape[0] >= n:
            return x[:n]
        return np.pad(x, (0, n - x.shape[0]))

    # voiceprints from each speaker's clean (single) audio
    prints = {}
    for spk in speakers:
        chunks = [mono[int(t0 * SR):int(t1 * SR)] for t0, t1, kind, act in intervals
                  if kind == "single" and act[0] == spk]
        if chunks:
            prints[spk] = embed(fit(np.concatenate(chunks), int(12 * SR)))

    # build a clean track per speaker
    tracks = {spk: np.zeros(total, dtype="float32") for spk in speakers}
    overlap_spans = []
    for t0, t1, kind, act in intervals:
        a, b = int(t0 * SR), int(t1 * SR)
        seg = mono[a:b]
        if seg.shape[0] == 0:
            continue
        if kind == "single":
            tracks[act[0]][a:b] = seg
        elif kind == "overlap":
            overlap_spans.append((t0, t1))
            if separator is None or (t1 - t0) < args.min_sep or len(speakers) != 2:
                # too short / disabled: give the region to the more-active speaker only
                dom = max(act, key=lambda s: sum(min(s1, t1) - max(s0, t0)
                                                  for s0, s1, sp in segments if sp == s and min(s1, t1) > max(s0, t0)))
                tracks[dom][a:b] = seg
                continue
            s1, s2 = separate(seg)
            s1, s2 = fit(s1, b - a), fit(s2, b - a)
            A, B = speakers[0], speakers[1]
            e1, e2 = embed(s1), embed(s2)
            vA, vB = prints.get(A), prints.get(B)
            straight = swapped = 0.0
            if e1 is not None and e2 is not None and vA is not None and vB is not None:
                straight = float(e1 @ vA + e2 @ vB)
                swapped = float(e1 @ vB + e2 @ vA)
            if straight >= swapped:
                tracks[A][a:b], tracks[B][a:b] = s1, s2
            else:
                tracks[A][a:b], tracks[B][a:b] = s2, s1

    def in_overlap(t0, t1):
        return any(min(t1, e) - max(t0, s) > 0.05 for s, e in overlap_spans)

    # transcribe each clean track, collect timed words per speaker
    names = {}

    def friendly(label):
        if label not in names:
            names[label] = f"Speaker {len(names) + 1}"
        return names[label]

    from collections import defaultdict
    by_spk = defaultdict(list)
    for spk in speakers:
        segs, _ = asr.transcribe(tracks[spk], language=args.language, vad_filter=True, word_timestamps=True)
        for s in segs:
            for w in (s.words or []):
                by_spk[spk].append((w.start, w.end, w.word))

    # Group each speaker's own words into turns first (split only on that
    # speaker's internal pauses), THEN order turns by start time. Simultaneous
    # speech shows as two whole blocks, not word-by-word ping-pong.
    turns = []
    for spk, ws in by_spk.items():
        ws.sort()
        cur = None
        for start, end, word in ws:
            if cur and start - cur["end"] > args.gap:
                turns.append(cur)
                cur = None
            if cur is None:
                cur = {"spk": spk, "start": start, "end": end, "buf": []}
            cur["buf"].append(word)
            cur["end"] = end
        if cur:
            turns.append(cur)
    turns.sort(key=lambda t: t["start"])

    for tn in turns:  # assign friendly names in final reading order
        friendly(tn["spk"])

    out = []
    for tn in turns:
        text = "".join(tn["buf"]).strip()
        if not text:
            continue
        name = friendly(tn["spk"])
        ov = in_overlap(tn["start"], tn["end"])
        out.append({
            "start": round(tn["start"], 2), "end": round(tn["end"], 2),
            "speaker": name, "text": text, "overlap": ov,
        })
        tag = " ⚠ overlap" if ov else ""
        print(f"[{tn['start']:7.2f} - {tn['end']:7.2f}]{tag} {name}: {text}")

    if args.out:
        Path(args.out).write_text(json.dumps({"audio": args.audio, "turns": out}, ensure_ascii=False, indent=2))
        print(f"\nWrote {args.out}", file=sys.stderr)
    print(f"\nSpeakers: {', '.join(friendly(s) for s in speakers)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
