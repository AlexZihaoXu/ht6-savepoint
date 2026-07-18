"""Composite read-API response models (SAV-34).

Frontend-facing shapes assembled by the read router: a person together with their
most recent events, and a full day view (the day tile plus its events, the people
it references, and the day's recap). These are response-only models — never stored
— so ids stay plain strings and no raw Mongo document is exposed.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.models.day import Day
from savepoint_server.models.event import Event
from savepoint_server.models.person import Person
from savepoint_server.models.recap import Recap


class PersonDetail(Person):
    """A person plus their most recent events — the person-detail screen.

    Flattens the :class:`Person` fields (so the frontend gets ``name``, avatar,
    etc. at the top level) and appends the person's recent events, newest first.
    """

    events: list[Event] = Field(default_factory=list)


class DayView(BaseModel):
    """A single day composed for the day view (and ``/today``).

    Carries the day tile (a stub with just the date when nothing was logged), the
    day's events in ascending timestamp order, the distinct real people those
    events reference, and the day-scope recap when one exists. Every part is
    empty-safe so an unlogged day yields a valid, empty view rather than an error.
    """

    model_config = ConfigDict(extra="forbid")

    day: Day
    events: list[Event] = Field(default_factory=list)
    people: list[Person] = Field(default_factory=list)
    recap: Recap | None = None
