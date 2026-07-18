# SavePoint — Speech Pipeline

Offline **"who said what"** for two-person conversations. Given a recording, it produces
a merged transcript of `Speaker N: text` turns, correctly recovering **overlapping
speech** (both people talking at once) instead of dropping or duplicating it.

This is jiucheng's validated pipeline, vendored from `two-speaker-demo/`. It is the
speech workstream for SavePoint (epic **SAV-7**) and runs **server-side, not on the QNX
device**.

## How it works

```
audio ──▶ [1] pyannote Community-1 diarization   (who speaks when — the accurate split)
          [2] SepFormer overlap-split            (separate the mixture in overlap regions)
          [3] faster-whisper transcription       (one clean track per speaker)
          [4] time-merge                     ──▶ merged "Speaker N: text" turns
```

1. **Diarize** (`diarize.py`) — `pyannote/speaker-diarization-community-1`, forced to
   `num_speakers=2`, emits `{start, end, speaker}` segments. This is the most accurate
   speaker split we have (~95% on our test clips, below).
2. **Overlap-split + transcribe** (`align.py`) — classifies the timeline into
   silence / single-speaker / overlap intervals; builds one clean audio track per
   speaker (copying single-speaker audio, and using **SepFormer**
   `speechbrain/sepformer-wsj02mix` to separate the two voices in overlap regions,
   assigning each separated voice to a speaker by voiceprint similarity); then
   transcribes each clean track with **faster-whisper** (`small.en`, int8, CPU) and
   merges words into time-ordered turns. Turns that came from an overlap region are
   flagged `"overlap": true`.

Output turn schema (see `testcases/*.json`):

```json
{ "start": 0.0, "end": 15.84, "speaker": "Speaker 1", "text": "...", "overlap": true }
```

## Gated models & `HF_TOKEN`

Two of the models are **gated on Hugging Face** — you must accept their terms once and
export a token:

- https://huggingface.co/pyannote/speaker-diarization-community-1
- https://huggingface.co/pyannote/segmentation-3.0

```bash
export HF_TOKEN=hf_xxx     # required by diarize.py
```

`pyannote/wespeaker-voxceleb-resnet34-LM` (voiceprint) and
`speechbrain/sepformer-wsj02mix` (separation) are **not** gated and download
automatically on first run.

## Setup

Python **3.12**, managed with **uv**. Runtime + dev deps are pinned in `pyproject.toml`
(CPU-only torch via the PyTorch CPU index):

```bash
uv sync           # installs the environment (runtime + dev)
```

> **Two-venv note (upstream):** Community-1 needs `pyannote.audio` 4.x, while the
> original `align.py` step was validated against `pyannote.audio==3.4.0` +
> `huggingface_hub==0.25.2` — so the upstream demo used **two isolated venvs**
> (`.venv` for `diarize.py`, `.venv-stream` for `align.py`; see
> `README-upstream.md`). This `pyproject.toml` targets the single 4.x line since
> Community-1 is the locked headline decision. If a single-env resolve conflicts,
> fall back to the two-venv split the upstream README documents.

## Running

`transcribe.sh` chains both steps but **hardcodes `--device mps`** (Apple Silicon). On
**Linux/CI, do not use `transcribe.sh`** — call the two scripts directly (both already
run on CPU):

```bash
# 1) diarize  ->  diar.json
HF_TOKEN=$HF_TOKEN python diarize.py clip.wav -o diar.json          # add --device cpu on Linux

# 2) overlap-split + transcribe  ->  out.json ("Speaker N: text" turns)
HF_TOKEN=$HF_TOKEN python align.py clip.wav --diar diar.json --out out.json
```

Useful flags: `align.py --no-separate` skips SepFormer (faster; overlaps go to the
dominant speaker), `--model base.en` is faster/rougher, `--min-sep` / `--gap` tune
overlap and turn-splitting. Each script takes `-h`.

> `_sepformer/` caches SepFormer weights on first run. If it contains broken symlinks
> (copied from another machine), delete it so the model re-downloads.

## Test cases & accuracy

`testcases/` holds five ground-truth clips cut from real two-speaker audio
(`tc1_02min` … `tc5_80min`), each with:

- `*.wav` — the ~1 min 16 kHz mono clip (small, committed)
- `*.json` — the pipeline transcript (`{audio, turns:[...]}`)
- `*.txt` — a human-readable dump

The Community-1 diarization scores **~95% speaker-attribution accuracy** across these
clips. Regenerate them with `make_testcases.sh` (needs the 127 MB `test.mp3`, which is
**not** committed — ask jiucheng).

## CI

`tests/test_testcases.py` is a **cheap, ML-free** check: it loads every
`testcases/*.json` fixture and asserts the turn schema (`start` / `end` / `speaker` /
`text`). It imports no torch/pyannote/whisper and needs no `HF_TOKEN` or model
downloads, so it runs in milliseconds.

```bash
uv run pytest        # or: pytest
uv run ruff check .
```

## Files

| File | Role |
|------|------|
| `diarize.py` | Community-1 diarization → `{start,end,speaker}` segments JSON |
| `align.py` | overlap-split (SepFormer) + per-speaker faster-whisper → merged turns |
| `transcribe.sh` | Mac convenience wrapper (`--device mps`) — **not for Linux/CI** |
| `make_testcases.sh` | regenerate `testcases/` from `test.mp3` |
| `requirements.txt` | upstream `.venv` (Community-1) requirement, for reference |
| `README-upstream.md` | jiucheng's original notes (bilingual) |
| `testcases/` | ground-truth clips + transcripts + text dumps |
| `tests/` | cheap CI schema check |
