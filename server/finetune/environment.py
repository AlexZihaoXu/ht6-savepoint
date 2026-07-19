"""SavePoint recap environment.

Turns a day's `events` (DESIGN §9: person seen / person spoke) into the
`Recap` shape `services/recap.py` expects: {"narrative": str, "highlights":
list[str]}. See dataset/train.jsonl for the SFT prompt/answer pairs and
TRAINING.md for how Flash uses this file.
"""

from __future__ import annotations

import json
from pathlib import Path

from freesolo.datasets.types import TaskExample
from freesolo.environments import EnvironmentSingleTurn, RewardResult, RewardMetric


DEFAULT_DATASET_PATH = Path(__file__).parent / "dataset" / "train.jsonl"

SYSTEM_PROMPT = """You are the narrator for SavePoint, a cozy Stardew-Valley-style \
memory game. You are given one day's interaction events as JSON: each event is a \
person who was seen or something they said, with an optional emotion and place.

Write a short, warm, second-person narrative recap of the day (2-4 sentences) plus \
2-4 short highlight bullets. If the event list is empty, write a gentle one-line \
narrative noting today was quiet with no logged moments, and use an empty \
highlights list.

Respond with ONLY a JSON object, no other text, matching exactly:
{"narrative": "<string>", "highlights": ["<string>", ...]}"""


def load_jsonl(path: str | Path):
    rows = []
    with Path(path).open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def score_recap_response(example: TaskExample, response_text: str) -> RewardResult:
    text = str(response_text).strip()
    # Strip markdown code fences a model might add despite instructions.
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[len("json") :]
        text = text.strip()

    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return RewardResult(
            score=0.0,
            error="response is not valid JSON",
            metrics=(RewardMetric(name="valid_json", score=0.0),),
        )

    if not isinstance(parsed, dict):
        return RewardResult(score=0.0, error="response JSON is not an object")

    narrative = parsed.get("narrative")
    highlights = parsed.get("highlights")

    has_narrative = isinstance(narrative, str) and len(narrative.strip()) > 0
    has_highlights = isinstance(highlights, list) and all(
        isinstance(h, str) for h in highlights
    )

    if has_narrative and has_highlights:
        return RewardResult(
            score=1.0,
            metrics=(
                RewardMetric(name="valid_json", score=1.0),
                RewardMetric(name="correct_shape", score=1.0),
            ),
        )

    # Partial credit: parseable JSON but wrong shape (still better than garbage).
    return RewardResult(
        score=0.3,
        error="missing/invalid 'narrative' (str) or 'highlights' (list[str])",
        metrics=(RewardMetric(name="valid_json", score=1.0),),
    )


class RecapEnv(EnvironmentSingleTurn):
    dataset = load_jsonl(DEFAULT_DATASET_PATH)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": example.input},
        ]

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        return score_recap_response(example, response_text)


def load_environment(dataset_path: str | None = None, **kwargs) -> RecapEnv:
    env = RecapEnv()
    if dataset_path:
        env.dataset = load_jsonl(dataset_path)
    return env
