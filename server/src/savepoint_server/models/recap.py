"""``recaps`` collection models (DESIGN §9, §11)."""

from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import Field

from savepoint_server.models.base import MongoModel


class RecapScope(str, Enum):
    """Time span a recap summarizes."""

    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class Recap(MongoModel):
    """An LLM-written narrative summary over a day/month/year of events."""

    date: date
    scope: RecapScope
    narrative: str
    highlights: list[str] = Field(default_factory=list)
