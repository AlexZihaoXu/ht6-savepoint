"""``days`` collection models (DESIGN §9, §10.1 garden)."""

from __future__ import annotations

from datetime import date

from pydantic import Field

from savepoint_server.models.base import MongoModel


class Day(MongoModel):
    """A single day, rendered as a plant tile in the garden calendar."""

    date: date
    # Optional mood tint chosen in the journal; recolors today's plant (DESIGN §10.1).
    mood_color: str | None = None
    journal_notes: str | None = None
    # Growth stage of the day's garden plant (0 = seed .. higher = fuller).
    plant_stage: int = Field(default=0, ge=0)
