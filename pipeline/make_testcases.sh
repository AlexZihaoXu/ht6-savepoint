#!/usr/bin/env bash
# Generate two-speaker transcript test cases from portions of a recording.
# For each case: keeps the audio clip (.wav), the transcript (.json) and a
# human-readable dump (.txt) under testcases/.
#
# Usage: HF_TOKEN=hf_xxx ./make_testcases.sh [source.mp3]
set -euo pipefail
cd "$(dirname "$0")"

SRC="${1:-test.mp3}"
MODEL="${MODEL:-small.en}"
if [ -z "${HF_TOKEN:-}" ]; then echo "error: set HF_TOKEN" >&2; exit 2; fi
if [ ! -f "$SRC" ]; then echo "error: not found: $SRC" >&2; exit 2; fi
mkdir -p testcases

# name       start(s)  dur(s)
CASES=(
  "tc1_02min   120  60"
  "tc2_10min   600  60"
  "tc3_30min  1800  60"
  "tc4_50min  3000  60"
  "tc5_80min  4800  60"
)

for c in "${CASES[@]}"; do
  read -r name start dur <<< "$c"
  wav="testcases/$name.wav"
  diar="testcases/$name.diar.json"
  echo "=== $name : ${start}s .. $((start + dur))s ===" >&2
  ffmpeg -y -ss "$start" -t "$dur" -i "$SRC" -ac 1 -ar 16000 "$wav" >/dev/null 2>&1
  HF_TOKEN="$HF_TOKEN" .venv/bin/python diarize.py "$wav" --device mps -o "$diar" >/dev/null 2>&1
  HF_TOKEN="$HF_TOKEN" .venv-stream/bin/python align.py "$wav" --diar "$diar" \
    --model "$MODEL" --out "testcases/$name.json" > "testcases/$name.txt" 2>/dev/null
  rm -f "$diar"
  echo "  -> testcases/$name.{wav,json,txt}" >&2
done
echo "Done. Test cases in testcases/" >&2
