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
