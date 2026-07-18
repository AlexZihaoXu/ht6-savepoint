"""CI-safe tests for the accuracy scorer (``score.py``).

Pure standard library + pytest — imports NO heavy ML deps (no torch / numpy /
pyannote / whisper), so it runs in the ephemeral ci-pipeline env in milliseconds.
Builds small canned predicted/truth transcripts in-code and also self-scores a
real vendored ``testcases/*.json`` fixture.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import score  # noqa: E402

TESTCASES_DIR = Path(__file__).resolve().parent.parent / "testcases"


def seg(start: float, end: float, speaker: str, text: str) -> dict[str, object]:
    """Build a turn dict in the vendored schema (overlap defaults False)."""
    return {"start": start, "end": end, "speaker": speaker, "text": text, "overlap": False}


# A tiny two-speaker ground-truth transcript (A speaks, then B, then A).
TRUTH = [
    seg(0.0, 2.0, "A", "hello world how are you"),
    seg(2.0, 4.0, "B", "i am doing just fine"),
    seg(4.0, 6.0, "A", "good to hear that friend"),
]


def test_perfect_prediction_identical_labels() -> None:
    """pred == truth -> 100% speaker accuracy, 0 WER, correct counts."""
    metrics = score.score(TRUTH, TRUTH)
    assert metrics["speaker_attribution_accuracy"] == pytest.approx(1.0)
    assert metrics["wer"] == pytest.approx(0.0)
    assert metrics["word_distance"] == 0
    assert metrics["pred_speaker_count"] == 2
    assert metrics["true_speaker_count"] == 2
    assert metrics["speaker_count_correct"] is True
    assert metrics["speaker_count_diff"] == 0


def test_perfect_prediction_relabeled_speakers() -> None:
    """Speaker labels are arbitrary: relabeled but otherwise perfect pred is still 100%."""
    relabel = {"A": "Speaker 1", "B": "Speaker 2"}
    pred = [{**t, "speaker": relabel[str(t["speaker"])]} for t in TRUTH]
    metrics = score.score(pred, TRUTH)
    assert metrics["speaker_attribution_accuracy"] == pytest.approx(1.0)
    assert metrics["wer"] == pytest.approx(0.0)
    # The best mapping should recover the true correspondence.
    assert metrics["speaker_mapping"] == {"A": "Speaker 1", "B": "Speaker 2"}
    assert metrics["pred_speaker_count"] == 2
    assert metrics["true_speaker_count"] == 2


def test_document_form_accepted() -> None:
    """The full ``{"turns": [...]}`` document form scores the same as a bare list."""
    doc = {"audio": "x.wav", "turns": TRUTH}
    metrics = score.score(doc, doc)
    assert metrics["speaker_attribution_accuracy"] == pytest.approx(1.0)
    assert metrics["wer"] == pytest.approx(0.0)


def test_wrong_prediction_is_worse() -> None:
    """A prediction with collapsed speakers and garbled text scores strictly worse."""
    # All speech attributed to one speaker, and every word wrong.
    pred = [seg(0.0, 6.0, "X", "totally different incorrect words here now")]
    perfect = score.score(TRUTH, TRUTH)
    bad = score.score(pred, TRUTH)

    assert bad["speaker_attribution_accuracy"] < perfect["speaker_attribution_accuracy"]
    assert bad["wer"] > perfect["wer"]
    assert bad["wer"] > 0.0
    # Only one predicted speaker but two true speakers.
    assert bad["pred_speaker_count"] == 1
    assert bad["true_speaker_count"] == 2
    assert bad["speaker_count_correct"] is False
    assert bad["speaker_count_diff"] == -1


def test_partial_speaker_accuracy() -> None:
    """Collapsing both speakers into one label -> only the dominant speaker's time matches.

    Truth: A=[0,2]+[4,6] (4s), B=[2,4] (2s); total 6s. Pred labels everything "P1",
    so the best mapping covers only A's 4s -> 4/6 accuracy. Text is unchanged, so WER 0.
    """
    pred = [
        seg(0.0, 2.0, "P1", "hello world how are you"),
        seg(2.0, 4.0, "P1", "i am doing just fine"),
        seg(4.0, 6.0, "P1", "good to hear that friend"),
    ]
    metrics = score.score(pred, TRUTH)
    assert metrics["speaker_attribution_accuracy"] == pytest.approx(4.0 / 6.0)
    assert metrics["truth_speech_sec"] == pytest.approx(6.0)
    assert metrics["matched_speech_sec"] == pytest.approx(4.0)
    assert metrics["wer"] == pytest.approx(0.0)


def test_wer_counts_edits() -> None:
    """WER numerator is a real word-level edit distance over concatenated text."""
    truth = [seg(0.0, 1.0, "A", "the quick brown fox")]
    # one substitution (quick->slow), one deletion (brown gone) -> distance 2 / 4 ref words.
    pred = [seg(0.0, 1.0, "A", "the slow fox")]
    metrics = score.score(pred, truth)
    assert metrics["ref_words"] == 4
    assert metrics["hyp_words"] == 3
    assert metrics["word_distance"] == 2
    assert metrics["substitutions"] == 1
    assert metrics["deletions"] == 1
    assert metrics["insertions"] == 0
    assert metrics["wer"] == pytest.approx(2.0 / 4.0)


def test_speaker_count_metric() -> None:
    """Predicted vs. true speaker COUNT is reported and its correctness flagged."""
    pred_three = [
        seg(0.0, 2.0, "S1", "hello world how are you"),
        seg(2.0, 4.0, "S2", "i am doing just fine"),
        seg(4.0, 6.0, "S3", "good to hear that friend"),
    ]
    metrics = score.score(pred_three, TRUTH)
    assert metrics["pred_speaker_count"] == 3
    assert metrics["true_speaker_count"] == 2
    assert metrics["speaker_count_correct"] is False
    assert metrics["speaker_count_diff"] == 1


def test_self_score_real_testcase() -> None:
    """Self-scoring a real vendored fixture is a perfect score."""
    fixture = TESTCASES_DIR / "tc1_02min.json"
    doc = json.loads(fixture.read_text(encoding="utf-8"))
    metrics = score.score(doc, doc)
    assert metrics["speaker_attribution_accuracy"] == pytest.approx(1.0)
    assert metrics["wer"] == pytest.approx(0.0)
    assert metrics["true_speaker_count"] == metrics["pred_speaker_count"]
    assert metrics["true_speaker_count"] >= 1


def test_metrics_are_json_serializable() -> None:
    """The returned metrics dict round-trips through JSON (clean, CLI-printable)."""
    metrics = score.score(TRUTH, TRUTH)
    assert json.loads(json.dumps(metrics)) == metrics
