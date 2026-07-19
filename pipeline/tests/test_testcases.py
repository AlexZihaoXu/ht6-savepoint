"""Cheap CI check for the vendored ground-truth testcases.

Loads every ``testcases/*.json`` fixture and asserts the transcript-turn schema
(``start`` / ``end`` / ``speaker`` / ``text`` present and well-typed). Deliberately
imports NO heavy ML deps (no torch / pyannote / whisper) so it runs in ~ms in CI
without model downloads or an HF token.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

TESTCASES_DIR = Path(__file__).resolve().parent.parent / "testcases"
JSON_FILES = sorted(TESTCASES_DIR.glob("*.json"))
REQUIRED_TURN_FIELDS = ("start", "end", "speaker", "text")


def test_testcases_dir_present() -> None:
    """The vendored ground-truth fixtures must exist (guards an empty glob)."""
    assert TESTCASES_DIR.is_dir(), f"missing testcases dir: {TESTCASES_DIR}"
    assert JSON_FILES, f"no testcase JSON fixtures under {TESTCASES_DIR}"


@pytest.mark.parametrize("json_path", JSON_FILES, ids=lambda p: p.name)
def test_testcase_schema(json_path: Path) -> None:
    """Each fixture is a {'turns': [...]} doc with well-formed transcript turns."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert isinstance(data, dict), f"{json_path.name}: top-level is not an object"

    turns = data.get("turns")
    assert isinstance(turns, list), f"{json_path.name}: 'turns' missing or not a list"
    assert turns, f"{json_path.name}: 'turns' is empty"

    for i, turn in enumerate(turns):
        assert isinstance(turn, dict), f"{json_path.name} turn {i}: not an object"
        for field in REQUIRED_TURN_FIELDS:
            assert field in turn, f"{json_path.name} turn {i}: missing '{field}'"

        start, end = turn["start"], turn["end"]
        assert isinstance(start, int | float), f"{json_path.name} turn {i}: 'start' not numeric"
        assert isinstance(end, int | float), f"{json_path.name} turn {i}: 'end' not numeric"
        assert end >= start, f"{json_path.name} turn {i}: end {end} < start {start}"

        speaker = turn["speaker"]
        assert isinstance(speaker, str) and speaker, f"{json_path.name} turn {i}: bad 'speaker'"
        assert isinstance(turn["text"], str), f"{json_path.name} turn {i}: 'text' not a string"
