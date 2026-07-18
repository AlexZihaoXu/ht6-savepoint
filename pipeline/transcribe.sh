#!/usr/bin/env bash
# Accurate OFFLINE two-speaker transcript of a recording.
# Pipeline: Community-1 diarization (most accurate) + whisper word-level
# transcription, aligned into "Speaker N: text" turns.
#
# Usage:
#   HF_TOKEN=hf_xxx ./transcribe.sh input.mp3 [out.json]
#   START=600 DUR=120 HF_TOKEN=hf_xxx ./transcribe.sh test.mp3 out.json   # clip a portion
#   MODEL=base.en  ... (faster, less accurate)   MODEL=small.en (default)
set -euo pipefail
cd "$(dirname "$0")"

IN="${1:?usage: ./transcribe.sh input.(mp3|wav|m4a|...) [out.json]}"
OUT="${2:-transcript.json}"
MODEL="${MODEL:-small.en}"
START="${START:-}"
DUR="${DUR:-}"

if [ -z "${HF_TOKEN:-}" ]; then
  echo "error: set HF_TOKEN first (export HF_TOKEN=hf_xxx)" >&2
  exit 2
fi
if [ ! -f "$IN" ]; then
  echo "error: input not found: $IN" >&2
  exit 2
fi

WAV="_transcribe_input.16k.wav"
CLIP=()
[ -n "$START" ] && CLIP+=(-ss "$START")
[ -n "$DUR" ] && CLIP+=(-t "$DUR")
echo "Preparing audio (16 kHz mono${START:+, from ${START}s}${DUR:+ for ${DUR}s})..." >&2
ffmpeg -y "${CLIP[@]}" -i "$IN" -ac 1 -ar 16000 "$WAV" >/dev/null 2>&1

DIAR="_transcribe_diar.json"
echo "[1/2] Diarizing with Community-1 (this is the accurate speaker split)..." >&2
HF_TOKEN="$HF_TOKEN" .venv/bin/python diarize.py "$WAV" --device mps -o "$DIAR" >/dev/null

echo "[2/2] Transcribing + aligning (whisper $MODEL)..." >&2
HF_TOKEN="$HF_TOKEN" .venv-stream/bin/python align.py "$WAV" --diar "$DIAR" --model "$MODEL" --out "$OUT"

rm -f "$WAV" "$DIAR"
echo "Saved transcript -> $OUT" >&2
