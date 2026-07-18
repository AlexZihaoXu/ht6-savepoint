"""Month-summary read-API response models (SAV-60).

Rolls a calendar month of events up for the app's "Past" view: how many days
were journaled, total events, the distinct real people met, the most-interacted
people, and the busiest day. Response-only models — never stored — so ids stay
plain strings and no raw Mongo document is exposed.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.models.person import Person


class TopPerson(BaseModel):
    """A real person and how many events referenced them in the month."""

    model_config = ConfigDict(extra="forbid")

    person: Person
    interactions: int = Field(ge=0, description="Events referencing this person this month.")


class BusiestDay(BaseModel):
    """The single day in the month with the most events."""

    model_config = ConfigDict(extra="forbid")

    date: str
    events: int = Field(ge=0, description="Event count on the busiest day.")


class MonthSummary(BaseModel):
    """A calendar month rolled up for the Past view (SAV-60).

    Every field is empty-safe so a month with nothing logged yields a valid,
    zeroed summary rather than an error. ``people_count``/``top_people`` count
    only real people — unbound ``"Speaker N"`` diarization labels are excluded
    (they still contribute to ``total_events``).
    """

    model_config = ConfigDict(extra="forbid")

    month: str
    days_journaled: int = Field(default=0, ge=0, description="Distinct days with >=1 event.")
    total_events: int = Field(default=0, ge=0, description="Total events this month.")
    people_count: int = Field(default=0, ge=0, description="Distinct real people this month.")
    top_people: list[TopPerson] = Field(default_factory=list)
    busiest_day: BusiestDay | None = None
