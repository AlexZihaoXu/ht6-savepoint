"""Unit tests for the garden-plant growth rule (SAV-54).

Pure function, no DB — the calendar-view garden derives a day's plant growth from
its activity via :func:`compute_plant_stage`.
"""

from __future__ import annotations

import pytest

from savepoint_server.models import MAX_PLANT_STAGE, compute_plant_stage


def test_empty_day_is_bare_soil() -> None:
    assert compute_plant_stage(events=0, people=0) == 0
    # People with no events (shouldn't happen, but be defensive) still bare.
    assert compute_plant_stage(events=0, people=3) == 0


def test_quiet_day_sprouts() -> None:
    # 1-2 events, a single person -> earliest growth stage.
    assert compute_plant_stage(events=1, people=1) == 1
    assert compute_plant_stage(events=2, people=1) == 1


def test_growth_increases_with_events() -> None:
    stages = [compute_plant_stage(events=e, people=1) for e in range(0, 12)]
    # Monotonic non-decreasing as the day gets busier.
    assert stages == sorted(stages)
    assert stages[0] == 0
    assert stages[-1] == MAX_PLANT_STAGE


def test_busy_day_reaches_bloom() -> None:
    assert compute_plant_stage(events=10, people=1) == MAX_PLANT_STAGE
    assert compute_plant_stage(events=20, people=5) == MAX_PLANT_STAGE


def test_people_weigh_heavier_than_events() -> None:
    # Same event count, more distinct people -> a fuller (>=) plant.
    solo = compute_plant_stage(events=3, people=1)
    social = compute_plant_stage(events=3, people=4)
    assert social >= solo
    # Meeting 4 people over 3 events (score 3 + 2*3 = 9) outgrows a 3-event monologue.
    assert social > solo


def test_never_exceeds_max() -> None:
    assert compute_plant_stage(events=10_000, people=500) == MAX_PLANT_STAGE


@pytest.mark.parametrize(
    ("events", "people", "expected"),
    [
        (0, 0, 0),
        (1, 1, 1),  # score 1
        (2, 1, 1),  # score 2
        (3, 1, 2),  # score 3
        (5, 1, 2),  # score 5
        (6, 1, 3),  # score 6
        (9, 1, 3),  # score 9
        (10, 1, 4),  # score 10
        (3, 4, 3),  # score 3 + 2*(4-1) = 9 -> stage 3 (people-weighting)
        (4, 4, 4),  # score 4 + 2*3 = 10 -> bloom
    ],
)
def test_threshold_table(events: int, people: int, expected: int) -> None:
    assert compute_plant_stage(events=events, people=people) == expected
