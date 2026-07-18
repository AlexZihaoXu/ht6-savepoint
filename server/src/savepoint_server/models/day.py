"""``days`` collection models (DESIGN §9, §10.1 garden)."""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from savepoint_server.models.base import MongoModel


class DaySummary(BaseModel):
    """A small tally of what a day holds (people met, events logged).

    Written by the ingest flow (SAV-30) so a day tile can show its activity at a
    glance without re-aggregating the ``events`` collection.
    """

    model_config = ConfigDict(extra="forbid")

    people: int = Field(default=0, ge=0, description="Distinct people referenced this day.")
    events: int = Field(default=0, ge=0, description="Events logged this day.")


#: Highest garden-plant growth stage (0 = bare soil .. MAX = full bloom). Five stages
#: give the calendar-view garden a legible "seed -> sprout -> growing -> budding -> bloom"
#: progression while staying a small, art-friendly set.
MAX_PLANT_STAGE = 4


def compute_plant_stage(events: int, people: int) -> int:
    """Map a day's activity to a garden-plant growth stage (``0..MAX_PLANT_STAGE``).

    A busier day grows a fuller plant. Distinct people are weighted a little heavier
    than raw event count, since meeting several people makes a "fuller" day than one
    long monologue. A day with nothing logged stays bare soil (stage 0).

    The thresholds are intentionally simple and tunable — once the design settles on
    concrete growth frames (waterprism's calendar garden), only the buckets here move.
    """
    if events <= 0:
        return 0
    # Meeting N people counts each extra person as ~2 events of "fullness".
    score = events + 2 * max(people - 1, 0)
    for stage, threshold in ((4, 10), (3, 6), (2, 3), (1, 1)):
        if score >= threshold:
            return stage
    return 0


class Day(MongoModel):
    """A single day, rendered as a plant tile in the garden calendar."""

    date: dt.date
    # Optional mood tint chosen in the journal; recolors today's plant (DESIGN §10.1).
    mood_color: str | None = None
    journal_notes: str | None = None
    # Growth stage of the day's garden plant (0 = seed .. higher = fuller).
    plant_stage: int = Field(default=0, ge=0)
    # Rolling tally maintained by the ingest flow (people/events counts).
    summary: DaySummary | None = None

    @field_serializer("date")
    def _serialize_date(self, value: dt.date) -> str:
        """Store the calendar date as an ISO string (BSON has no bare-date type)."""
        return value.isoformat()
