"""Read API router: GET endpoints the app reads to render its screens (SAV-34).

Feeds the frontend's People (town), Person detail, Garden (days calendar), Day
view, and Today screens. Everything here is read-only and assembled from the
repositories; response models keep ids as the plain ``_id`` string already used
elsewhere and never expose a raw Mongo document.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Day, DayView, Person, PersonDetail
from savepoint_server.models.recap import RecapScope

router = APIRouter(tags=["read"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def _parse_iso_date(value: str) -> date:
    """Parse an ``YYYY-MM-DD`` path segment, 400ing on anything malformed."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date '{value}'; expected ISO YYYY-MM-DD."
        ) from exc


async def _build_day_view(day_date: date, repos: Repositories) -> DayView:
    """Assemble the :class:`DayView` for a calendar date (empty-safe).

    Composes the day tile (a stub carrying just the date when none is logged), the
    day's events in ascending timestamp order, the distinct real people those
    events reference (speaker labels that don't resolve to a Person are skipped,
    never fatal), and the day-scope recap when present.
    """
    day_id = day_date.isoformat()
    day = await repos.days.get_by_date(day_date) or Day(date=day_date)
    events = await repos.events.list_for_day(day_id)

    people: list[Person] = []
    resolved: set[str] = set()
    for event in events:
        person_id = event.person_id
        if person_id in resolved:
            continue
        resolved.add(person_id)
        # person_id is still a raw "Speaker N" label until the mapping ticket lands;
        # include only the ones that resolve to a real Person, ignore the rest.
        person = await repos.people.get_by_local_id(person_id)
        if person is not None:
            people.append(person)

    recap = await repos.recaps.get_by_date_scope(day_date, RecapScope.DAY)
    return DayView(day=day, events=events, people=people, recap=recap)


@router.get("/people", response_model=list[Person], tags=["read"])
async def list_people(
    repos: Annotated[Repositories, Depends(get_repos)],
    favorite: Annotated[
        bool | None, Query(description="Filter by the favourite flag when set.")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=500, description="Max people to return.")] = 100,
) -> list[Person]:
    """List people (the town), most-recently-seen first."""
    filters: dict[str, Any] = {}
    if favorite is not None:
        filters["favorite"] = favorite
    return await repos.people.list(filters, sort=[("last_seen", DESCENDING)], limit=limit)


@router.get("/people/{local_id}", response_model=PersonDetail, tags=["read"])
async def get_person(
    local_id: str,
    repos: Annotated[Repositories, Depends(get_repos)],
    events_limit: Annotated[
        int, Query(ge=1, le=500, description="Max recent events to include.")
    ] = 100,
) -> PersonDetail:
    """Fetch one person plus their recent events (newest first); 404 if unknown."""
    person = await repos.people.get_by_local_id(local_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Person '{local_id}' not found.")
    events = await repos.events.list_for_person(local_id, limit=events_limit)
    return PersonDetail(**person.model_dump(), events=events)


@router.get("/days", response_model=list[Day], tags=["read"])
async def list_days(
    repos: Annotated[Repositories, Depends(get_repos)],
    month: Annotated[
        str | None, Query(description="Filter to an ISO month prefix, e.g. 2026-07.")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=500, description="Max days to return.")] = 100,
) -> list[Day]:
    """List day tiles for the garden calendar, most recent first (optionally by month)."""
    filters: dict[str, Any] = {}
    if month is not None:
        # Dates are stored as ISO strings, so a month is a simple anchored prefix.
        filters["date"] = {"$regex": f"^{re.escape(month)}"}
    return await repos.days.list(filters, sort=[("date", DESCENDING)], limit=limit)


@router.get("/day/{date}", response_model=DayView, tags=["read"])
async def get_day(
    date: str,
    repos: Annotated[Repositories, Depends(get_repos)],
) -> DayView:
    """The day view for an ISO ``YYYY-MM-DD`` date: day + events + people + recap."""
    return await _build_day_view(_parse_iso_date(date), repos)


@router.get("/today", response_model=DayView, tags=["read"])
async def get_today(
    repos: Annotated[Repositories, Depends(get_repos)],
) -> DayView:
    """Convenience alias for the current UTC date's day view."""
    return await _build_day_view(datetime.now(UTC).date(), repos)
