#!/usr/bin/env python3
"""Minimal two-speaker diarization demo using pyannote Community-1."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


MODEL_ID = "pyannote/speaker-diarization-community-1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Label an audio recording as a two-person conversation."
    )
    parser.add_argument("audio", type=Path, help="Input audio/video file")
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("diarization.json"),
        help="JSON output path (default: diarization.json)",
    )
    parser.add_argument(
        "--device", choices=("auto", "cpu", "cuda", "mps"), default="auto",
        help="Inference device (default: auto)",
    )
    return parser.parse_args()


def choose_device(torch_module, requested: str) -> str:
    if requested != "auto":
        return requested
    if torch_module.cuda.is_available():
        return "cuda"
    if getattr(torch_module.backends, "mps", None) and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def format_segments(annotation) -> list[dict[str, object]]:
    return [
        {
            "start": round(float(turn.start), 3),
            "end": round(float(turn.end), 3),
            "speaker": str(speaker),
        }
        for turn, speaker in annotation
    ]


def main() -> int:
    args = parse_args()
    if not args.audio.is_file():
        print(f"error: input file not found: {args.audio}", file=sys.stderr)
        return 2

    token = os.environ.get("HF_TOKEN")
    if not token:
        print("error: set HF_TOKEN to a Hugging Face access token", file=sys.stderr)
        return 2

    try:
        import torch
        from pyannote.audio import Pipeline
    except ImportError:
        print("error: install dependencies with: pip install -r requirements.txt", file=sys.stderr)
        return 2

    device = choose_device(torch, args.device)
    print(f"Loading {MODEL_ID} on {device}...", file=sys.stderr)
    pipeline = Pipeline.from_pretrained(MODEL_ID, token=token)
    pipeline.to(torch.device(device))

    # The recording is known to contain exactly two conversation participants.
    result = pipeline(str(args.audio), num_speakers=2)
    segments = format_segments(result.speaker_diarization)

    payload = {
        "audio": str(args.audio),
        "model": MODEL_ID,
        "num_speakers": 2,
        "segments": segments,
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    for item in segments:
        print(
            f"[{item['start']:8.3f} - {item['end']:8.3f}] {item['speaker']}"
        )
    print(f"Saved {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
