"""``events`` collection models (DESIGN §9)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from savepoint_server.models.base import MongoModel


class EventType(str, Enum):
    """What happened in an interaction moment."""

    SEEN = "seen"
    SPOKE = "spoke"


class Event(MongoModel):
    """A single interaction event: a person was seen, or spoke a line."""

    ts: datetime
    person_id: str
    type: EventType
    text: str | None = None
    emotion: str | None = None
    place: str | None = None
    # Owning day bucket, e.g. "2026-07-18".
    day_id: str
