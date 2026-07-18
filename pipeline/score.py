#!/usr/bin/env python3
"""CI-safe speech-accuracy scorer for SavePoint.

Scores a *predicted* diarized transcript (e.g. produced by ``diarize.py`` +
``align.py``) against a ground-truth ``testcases/*.json`` fixture and reports:

  * **speaker-attribution accuracy** — predicted and truth turns are aligned by
    time overlap, predicted speaker labels are matched to truth labels under the
    best one-to-one mapping (label permutation is arbitrary), and the metric is
    the fraction of *truth speech time* whose active predicted speaker matches.
  * **WER** — word error rate over the time-ordered, concatenated transcripts,
    using a word-level Levenshtein distance implemented here (no ``jiwer``).
  * **speaker count** — predicted vs. true number of distinct speakers.

Both the predicted and truth documents use the vendored turn schema::

    {"audio": "...", "turns": [{"start", "end", "speaker", "text", "overlap?"}]}

A bare ``[...]`` list of turns is also accepted.

**Pure standard library** (``argparse``/``itertools``/``json``/``math``/``re``)
so the ephemeral ``ci-pipeline`` — which installs only ruff + pytest, with no
torch/numpy — can import and exercise it.

CLI::

    python score.py --pred pred.json --truth testcases/tc1_02min.json
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Segment loading / normalisation
# ---------------------------------------------------------------------------

Segment = dict[str, object]


def _coerce_segments(obj: object) -> list[Segment]:
    """Normalise a testcase doc (or bare turn list) into a list of turn dicts.

    Accepts a ``{"turns": [...]}`` / ``{"segments": [...]}`` document or a bare
    ``[...]`` list. Each turn is coerced to ``{start, end, speaker, text}`` with
    well-typed fields; unknown extra keys (e.g. ``overlap``) are ignored.
    """
    if isinstance(obj, dict):
        for key in ("turns", "segments"):
            value = obj.get(key)
            if isinstance(value, list):
                obj = value
                break
        else:
            raise ValueError("segment doc must contain a 'turns' or 'segments' list")
    if not isinstance(obj, list):
        raise TypeError(f"expected a list of turns, got {type(obj).__name__}")

    out: list[Segment] = []
    for i, turn in enumerate(obj):
        if not isinstance(turn, dict):
            raise TypeError(f"turn {i}: not an object")
        try:
            start = float(turn["start"])
            end = float(turn["end"])
            speaker = str(turn["speaker"])
        except KeyError as exc:
            raise ValueError(f"turn {i}: missing field {exc}") from exc
        text = str(turn.get("text", ""))
        out.append({"start": start, "end": end, "speaker": speaker, "text": text})
    return out


# ---------------------------------------------------------------------------
# Interval helpers
# ---------------------------------------------------------------------------


def _merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Merge a list of ``(start, end)`` intervals into sorted, disjoint spans."""
    spans = sorted((a, b) for a, b in intervals if b > a)
    merged: list[list[float]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def _overlap_with_merged(a: float, b: float, merged: list[tuple[float, float]]) -> float:
    """Total overlap of ``[a, b)`` with a sorted, disjoint interval list."""
    total = 0.0
    for x, y in merged:
        if x >= b:
            break
        lo, hi = max(a, x), min(b, y)
        if hi > lo:
            total += hi - lo
    return total


# ---------------------------------------------------------------------------
# Best one-to-one speaker-label assignment
# ---------------------------------------------------------------------------

_EXACT_PERM_LIMIT = 50_000


def _max_weight_assignment(
    weights: dict[tuple[str, str], float],
    row_keys: list[str],
    col_keys: list[str],
) -> tuple[float, dict[str, str]]:
    """Max-weight one-to-one matching of ``row_keys`` to ``col_keys``.

    Exact (brute-force over permutations of the larger set taken to the size of
    the smaller) when the search space is small — the real case is 2x2 — and a
    greedy fallback otherwise. Returns ``(total_weight, {row: col})``; rows/cols
    with no match are simply absent from the mapping.
    """
    if not row_keys or not col_keys:
        return 0.0, {}

    rows_are_small = len(row_keys) <= len(col_keys)
    small = row_keys if rows_are_small else col_keys
    large = col_keys if rows_are_small else row_keys

    if math.perm(len(large), len(small)) <= _EXACT_PERM_LIMIT:
        best_total = -1.0
        best_map: dict[str, str] = {}
        for combo in itertools.permutations(large, len(small)):
            total = 0.0
            mapping: dict[str, str] = {}
            for small_el, large_el in zip(small, combo, strict=True):
                row, col = (small_el, large_el) if rows_are_small else (large_el, small_el)
                total += weights.get((row, col), 0.0)
                mapping[row] = col
            if total > best_total:
                best_total, best_map = total, mapping
        return best_total, best_map

    # Greedy fallback: take the heaviest still-available pair repeatedly.
    pairs = sorted(
        ((weights.get((r, c), 0.0), r, c) for r in row_keys for c in col_keys),
        reverse=True,
    )
    used_rows: set[str] = set()
    used_cols: set[str] = set()
    mapping = {}
    total = 0.0
    for weight, row, col in pairs:
        if row in used_rows or col in used_cols:
            continue
        used_rows.add(row)
        used_cols.add(col)
        mapping[row] = col
        total += weight
    return total, mapping


def _speaker_attribution(
    pred: list[Segment], truth: list[Segment]
) -> tuple[float, dict[str, str], float, float]:
    """Speaker-attribution accuracy under the best truth->pred label mapping.

    Returns ``(accuracy, mapping, matched_sec, truth_sec)`` where ``accuracy`` is
    ``matched_sec / truth_sec``: the fraction of truth speech time whose truth
    speaker's mapped predicted speaker is actually active at that instant.
    """
    truth_speakers = sorted({str(s["speaker"]) for s in truth})
    pred_speakers = sorted({str(s["speaker"]) for s in pred})
    truth_sec = sum(max(0.0, float(s["end"]) - float(s["start"])) for s in truth)

    # Per predicted speaker, merge its turns so self-overlap is not double counted.
    pred_merged = {
        p: _merge_intervals(
            [(float(s["start"]), float(s["end"])) for s in pred if str(s["speaker"]) == p]
        )
        for p in pred_speakers
    }

    # weights[(truth_spk, pred_spk)] = truth speech time of truth_spk covered by pred_spk.
    weights: dict[tuple[str, str], float] = {}
    for t in truth_speakers:
        t_turns = [
            (float(s["start"]), float(s["end"])) for s in truth if str(s["speaker"]) == t
        ]
        for p in pred_speakers:
            merged = pred_merged[p]
            weights[(t, p)] = sum(_overlap_with_merged(a, b, merged) for a, b in t_turns)

    matched_sec, mapping = _max_weight_assignment(weights, truth_speakers, pred_speakers)
    accuracy = matched_sec / truth_sec if truth_sec > 0 else 0.0
    accuracy = max(0.0, min(1.0, accuracy))
    return accuracy, mapping, matched_sec, truth_sec


# ---------------------------------------------------------------------------
# Word error rate
# ---------------------------------------------------------------------------

_WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)*")
_FULL_MATRIX_LIMIT = 4_000_000


def _tokenize(text: str) -> list[str]:
    """Lowercase and split into word tokens (hyphens split, apostrophes kept)."""
    return _WORD_RE.findall(text.lower())


def _concat_tokens(segments: list[Segment]) -> list[str]:
    """Time-ordered concatenation of every turn's word tokens."""
    tokens: list[str] = []
    for s in sorted(segments, key=lambda x: (float(x["start"]), float(x["end"]))):
        tokens.extend(_tokenize(str(s["text"])))
    return tokens


def _word_edit(ref: list[str], hyp: list[str]) -> tuple[int, int | None, int | None, int | None]:
    """Word-level Levenshtein distance with an S/D/I breakdown.

    Returns ``(distance, substitutions, deletions, insertions)``. For very large
    inputs the memory-light two-row DP is used and the breakdown is ``None``
    (only the distance, hence the WER, is reported).
    """
    n, m = len(ref), len(hyp)
    if n == 0:
        return m, 0, 0, m
    if m == 0:
        return n, 0, n, 0

    if n * m <= _FULL_MATRIX_LIMIT:
        dp = [[0] * (m + 1) for _ in range(n + 1)]
        for i in range(n + 1):
            dp[i][0] = i
        for j in range(m + 1):
            dp[0][j] = j
        for i in range(1, n + 1):
            ri = ref[i - 1]
            row, prev = dp[i], dp[i - 1]
            for j in range(1, m + 1):
                cost = 0 if ri == hyp[j - 1] else 1
                row[j] = min(prev[j - 1] + cost, prev[j] + 1, row[j - 1] + 1)

        subs = dels = ins = 0
        i, j = n, m
        while i > 0 or j > 0:
            if (
                i > 0
                and j > 0
                and dp[i][j] == dp[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1)
            ):
                if ref[i - 1] != hyp[j - 1]:
                    subs += 1
                i, j = i - 1, j - 1
            elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
                dels += 1
                i -= 1
            else:
                ins += 1
                j -= 1
        return dp[n][m], subs, dels, ins

    prev_row = list(range(m + 1))
    for i in range(1, n + 1):
        cur_row = [i] + [0] * m
        ri = ref[i - 1]
        for j in range(1, m + 1):
            cost = 0 if ri == hyp[j - 1] else 1
            cur_row[j] = min(prev_row[j - 1] + cost, prev_row[j] + 1, cur_row[j - 1] + 1)
        prev_row = cur_row
    return prev_row[m], None, None, None


def _wer(pred: list[Segment], truth: list[Segment]) -> dict[str, object]:
    """Word error rate of the predicted transcript against the truth transcript."""
    ref = _concat_tokens(truth)
    hyp = _concat_tokens(pred)
    distance, subs, dels, ins = _word_edit(ref, hyp)
    n = len(ref)
    if n > 0:
        wer = distance / n
    else:
        wer = 0.0 if distance == 0 else 1.0
    return {
        "wer": wer,
        "distance": distance,
        "substitutions": subs,
        "deletions": dels,
        "insertions": ins,
        "ref_words": n,
        "hyp_words": len(hyp),
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def score(pred_segments: object, truth_segments: object) -> dict[str, object]:
    """Score a predicted diarized transcript against ground truth.

    ``pred_segments`` / ``truth_segments`` may each be a testcase document
    (``{"turns": [...]}``) or a bare list of turn dicts. Returns a JSON-friendly
    metrics dict.
    """
    pred = _coerce_segments(pred_segments)
    truth = _coerce_segments(truth_segments)

    accuracy, mapping, matched_sec, truth_sec = _speaker_attribution(pred, truth)
    wer_info = _wer(pred, truth)

    pred_count = len({str(s["speaker"]) for s in pred})
    true_count = len({str(s["speaker"]) for s in truth})

    return {
        "speaker_attribution_accuracy": round(accuracy, 6),
        "speaker_mapping": mapping,
        "matched_speech_sec": round(matched_sec, 3),
        "truth_speech_sec": round(truth_sec, 3),
        "wer": round(float(wer_info["wer"]), 6),
        "word_distance": wer_info["distance"],
        "substitutions": wer_info["substitutions"],
        "deletions": wer_info["deletions"],
        "insertions": wer_info["insertions"],
        "ref_words": wer_info["ref_words"],
        "hyp_words": wer_info["hyp_words"],
        "pred_speaker_count": pred_count,
        "true_speaker_count": true_count,
        "speaker_count_correct": pred_count == true_count,
        "speaker_count_diff": pred_count - true_count,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Score a predicted diarized transcript against a ground-truth testcase.",
    )
    parser.add_argument("--pred", required=True, help="predicted transcript JSON (align.py output)")
    parser.add_argument("--truth", required=True, help="ground-truth testcases/tc*.json")
    parser.add_argument("--indent", type=int, default=2, help="JSON indent for output (default: 2)")
    args = parser.parse_args(argv)

    pred_doc = json.loads(Path(args.pred).read_text(encoding="utf-8"))
    truth_doc = json.loads(Path(args.truth).read_text(encoding="utf-8"))
    metrics = score(pred_doc, truth_doc)
    print(json.dumps(metrics, indent=args.indent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
