"""``recaps`` collection models (DESIGN §9, §11)."""

from __future__ import annotations

import datetime as dt
from enum import Enum

from pydantic import Field, field_serializer

from savepoint_server.models.base import MongoModel


class RecapScope(str, Enum):
    """Time span a recap summarizes."""

    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class Recap(MongoModel):
    """An LLM-written narrative summary over a day/month/year of events."""

    date: dt.date
    scope: RecapScope
    narrative: str
    highlights: list[str] = Field(default_factory=list)

    @field_serializer("date")
    def _serialize_date(self, value: dt.date) -> str:
        """Store the recap date as an ISO string (BSON has no bare-date type)."""
        return value.isoformat()
