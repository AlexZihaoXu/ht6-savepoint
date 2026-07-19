"""Binding router: tap-to-name a diarized speaker onto a real Person (SAV-39).

``POST /day/{date}/assign-speaker`` is the *tap-to-name* mechanic: after a day the
user assigns a diarized ``Speaker N`` label to a real Person, and every SPOKE event
that day is re-pointed onto that Person. Once bound, the read API's day-view join
(``api.read._build_day_view``) resolves those events to the real character instead
of a bare ``Speaker N`` label.

The write is idempotent (re-assigning rewrites nothing the second time) and returns
both the number of events rebound and the freshly composed :class:`DayView`, so the
frontend can render the corrected day in a single round trip.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.api.read import _build_day_view, get_demo_history_enabled_dep
from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import DayView
from savepoint_server.services.ingest import assign_speaker_for_day

router = APIRouter(tags=["binding"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def _parse_iso_date(value: str) -> date:
    """Parse a ``YYYY-MM-DD`` path segment, 400ing on anything malformed."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date '{value}'; expected ISO YYYY-MM-DD."
        ) from exc


#: Special ``person_local_id`` binding a label onto the wearer rather than a
#: real Person — mirrors the frontend's own "you" convention (scene-utils.ts's
#: YOU_AVATAR/nameFor). No Person doc for "you" exists or should exist.
YOU = "you"


class SpeakerAssignment(BaseModel):
    """Body for ``POST /day/{date}/assign-speaker`` — bind a label to a Person."""

    model_config = ConfigDict(extra="forbid")

    speaker_label: str = Field(description="Raw diarization label to bind, e.g. 'Speaker 1'.")
    person_local_id: str = Field(
        description="local_id of the real Person to bind it to, or the literal 'you'."
    )


class SpeakerAssignmentResult(BaseModel):
    """Outcome of a tap-to-name: how many events rebound + the refreshed day view."""

    model_config = ConfigDict(extra="forbid")

    speaker_label: str
    person_local_id: str
    reassigned: int = Field(description="SPOKE events rewritten onto the Person this call.")
    day: DayView


@router.post("/day/{date}/assign-speaker", response_model=SpeakerAssignmentResult)
async def assign_speaker(
    date: str,
    body: SpeakerAssignment,
    repos: Annotated[Repositories, Depends(get_repos)],
    demo_enabled: Annotated[bool, Depends(get_demo_history_enabled_dep)],
) -> SpeakerAssignmentResult:
    """Bind ``speaker_label`` to a Person (or "you") for a day, re-pointing that
    day's SPOKE events.

    Validates the date (400); "you" is always a valid target (no Person doc for
    it exists), anything else must resolve to a real Person (404 otherwise).
    Rewrites the day's matching SPOKE events and returns the refreshed day view
    with the count.
    """
    day = _parse_iso_date(date)
    if (
        body.person_local_id != YOU
        and await repos.people.get_by_local_id(body.person_local_id) is None
    ):
        raise HTTPException(status_code=404, detail=f"Person '{body.person_local_id}' not found.")
    reassigned = await assign_speaker_for_day(
        day.isoformat(),
        speaker_label=body.speaker_label,
        person_local_id=body.person_local_id,
        repos=repos,
    )
    return SpeakerAssignmentResult(
        speaker_label=body.speaker_label,
        person_local_id=body.person_local_id,
        reassigned=reassigned,
        day=await _build_day_view(day, repos, demo_enabled=demo_enabled),
    )
