"""Read API router: GET endpoints the app reads to render its screens (SAV-34).

Feeds the frontend's People (town), Person detail, Garden (days calendar), Day
view, and Today screens. Everything here is read-only and assembled from the
repositories; response models keep ids as the plain ``_id`` string already used
elsewhere and never expose a raw Mongo document.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING

from savepoint_server.core.config import get_settings
from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Day, DayView, MonthSummary, Person, PersonDetail
from savepoint_server.models.month import BusiestDay, TopPerson
from savepoint_server.models.recap import RecapScope
from savepoint_server.services import demo_history

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

router = APIRouter(tags=["read"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def get_demo_history_enabled_dep() -> bool:
    """Whether to fall back to services/demo_history.py's hardcoded past week
    (default off — overridable in tests via dependency_overrides)."""
    return get_settings().demo_history_enabled


def _parse_iso_date(value: str) -> date:
    """Parse an ``YYYY-MM-DD`` path segment, 400ing on anything malformed."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date '{value}'; expected ISO YYYY-MM-DD."
        ) from exc


def _parse_month(value: str) -> str:
    """Validate a ``YYYY-MM`` path segment, 400ing on anything malformed.

    Requires a zero-padded 4-digit year and 2-digit month (so ``"2026-7"`` is
    rejected) and a real calendar month 01-12 (so ``"2026-13"`` is rejected).
    """
    if not _MONTH_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid month '{value}'; expected YYYY-MM.")
    try:
        # Reuse ISO parsing to reject an out-of-range month (e.g. 2026-13).
        date.fromisoformat(f"{value}-01")
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid month '{value}'; expected YYYY-MM."
        ) from exc
    return value


async def _build_month_summary(
    month: str, repos: Repositories, *, demo_enabled: bool
) -> MonthSummary:
    """Aggregate a calendar month's events into a :class:`MonthSummary` (empty-safe).

    One events query for the month, then rolled up in Python (fine at demo scale):
    distinct days journaled, total events, and per-person / per-day tallies. Only
    ``person_id``s that resolve to a real :class:`Person` count toward
    ``people_count`` and ``top_people`` — unbound ``"Speaker N"`` diarization
    labels are skipped there (but still counted in ``total_events``).
    """
    events = await repos.events.list_for_month(month)
    if demo_enabled:
        # Demo history (services/demo_history.py) only fills days with NO real
        # event of their own — never touches Mongo, never overrides a real day.
        real_day_ids = {event.day_id for event in events}
        events = events + [
            event
            for event in demo_history.events_in_month(month)
            if event.day_id not in real_day_ids
        ]
    if not events:
        return MonthSummary(month=month)

    day_counts: Counter[str] = Counter(event.day_id for event in events)
    person_counts: Counter[str] = Counter(event.person_id for event in events)

    # Resolve each distinct person_id once; keep only the real (or demo) People.
    resolved: dict[str, Person] = {}
    for person_id in person_counts:
        found = await repos.people.get_by_local_id(person_id)
        if found is None and demo_enabled:
            found = demo_history.person(person_id)
        if found is not None:
            resolved[person_id] = found

    # top_people: real people by event count desc, stable tie-break on name then id.
    ranked = sorted(
        resolved.items(),
        key=lambda item: (-person_counts[item[0]], (item[1].name or item[1].local_id), item[0]),
    )
    top_people = [
        TopPerson(person=person, interactions=person_counts[person_id])
        for person_id, person in ranked[:5]
    ]

    # busiest_day: most events, earliest date breaking ties.
    busiest_id, busiest_events = min(day_counts.items(), key=lambda item: (-item[1], item[0]))

    return MonthSummary(
        month=month,
        days_journaled=len(day_counts),
        total_events=len(events),
        people_count=len(resolved),
        top_people=top_people,
        busiest_day=BusiestDay(date=busiest_id, events=busiest_events),
    )


async def _build_day_view(day_date: date, repos: Repositories, *, demo_enabled: bool) -> DayView:
    """Assemble the :class:`DayView` for a calendar date (empty-safe).

    Composes the day tile (a stub carrying just the date when none is logged), the
    day's events in ascending timestamp order, the distinct real people those
    events reference (speaker labels that don't resolve to a Person are skipped,
    never fatal), and the day-scope recap when present.

    When ``demo_enabled``, a date with NO real event of its own falls back to
    demo_history.py's hardcoded, never-written-to-Mongo past week (see that
    module) — real data for a date always wins outright; demo history only fills
    a genuine gap.
    """
    day_id = day_date.isoformat()
    day = await repos.days.get_by_date(day_date)
    events = await repos.events.list_for_day(day_id)
    recap = await repos.recaps.get_by_date_scope(day_date, RecapScope.DAY)

    if not events and demo_enabled:
        demo_events = demo_history.events_for_day(day_date)
        if demo_events:
            events = demo_events
            day = day or demo_history.day_tile(day_date)
            recap = recap or demo_history.recap_for_day(day_date)

    people: list[Person] = []
    resolved: set[str] = set()
    for event in events:
        person_id = event.person_id
        if person_id in resolved:
            continue
        resolved.add(person_id)
        # person_id is still a raw "Speaker N" label until the mapping ticket lands;
        # include only the ones that resolve to a real (or demo) Person, ignore the rest.
        person = await repos.people.get_by_local_id(person_id)
        if person is None and demo_enabled:
            person = demo_history.person(person_id)
        if person is not None:
            people.append(person)

    return DayView(day=day or Day(date=day_date), events=events, people=people, recap=recap)


@router.get("/people", response_model=list[Person], tags=["read"])
async def list_people(
    repos: Annotated[Repositories, Depends(get_repos)],
    favorite: Annotated[
        bool | None, Query(description="Filter by the favourite flag when set.")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=500, description="Max people to return.")] = 100,
) -> list[Person]:
    """List people (the town), most-recently-seen first.

    Never includes demo_history's cast, even with demo history enabled — this
    is the "who I know right now" roster (the Plaza's wandering characters,
    the tap-to-name picker, the People page), not a past-time view. The demo
    cast only ever shows up inside actual past-time views: a specific past
    day (``/day/{date}``), the days calendar (``/days``), the month summary,
    and a demo person's own detail page (``/people/{id}``) reached from one
    of those.
    """
    filters: dict[str, Any] = {}
    if favorite is not None:
        filters["favorite"] = favorite
    return await repos.people.list(filters, sort=[("last_seen", DESCENDING)], limit=limit)


@router.get("/people/{local_id}", response_model=PersonDetail, tags=["read"])
async def get_person(
    local_id: str,
    repos: Annotated[Repositories, Depends(get_repos)],
    demo_enabled: Annotated[bool, Depends(get_demo_history_enabled_dep)],
    events_limit: Annotated[
        int, Query(ge=1, le=500, description="Max recent events to include.")
    ] = 100,
) -> PersonDetail:
    """Fetch one person plus their recent events (newest first); 404 if unknown."""
    person = await repos.people.get_by_local_id(local_id)
    if person is not None:
        events = await repos.events.list_for_person(local_id, limit=events_limit)
        return PersonDetail(**person.model_dump(), events=events)

    demo_person = demo_history.person(local_id) if demo_enabled else None
    if demo_person is None:
        raise HTTPException(status_code=404, detail=f"Person '{local_id}' not found.")
    return PersonDetail(
        **demo_person.model_dump(), events=demo_history.events_for_person(local_id)[:events_limit]
    )


@router.get("/days", response_model=list[Day], tags=["read"])
async def list_days(
    repos: Annotated[Repositories, Depends(get_repos)],
    demo_enabled: Annotated[bool, Depends(get_demo_history_enabled_dep)],
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
    real = await repos.days.list(filters, sort=[("date", DESCENDING)], limit=limit)
    if not demo_enabled:
        return real
    real_dates = {d.date.isoformat() for d in real}
    # Demo history only fills dates Mongo has nothing for; a real Day (even an
    # empty one) always wins. Scoped to `month` the same way the real query is.
    demo = [
        tile
        for tile in demo_history.day_tiles()
        if tile.date.isoformat() not in real_dates
        and (month is None or tile.date.isoformat().startswith(month))
    ]
    combined = sorted(real + demo, key=lambda d: d.date, reverse=True)
    return combined[:limit]


@router.get("/day/{date}", response_model=DayView, tags=["read"])
async def get_day(
    date: str,
    repos: Annotated[Repositories, Depends(get_repos)],
    demo_enabled: Annotated[bool, Depends(get_demo_history_enabled_dep)],
) -> DayView:
    """The day view for an ISO ``YYYY-MM-DD`` date: day + events + people + recap."""
    return await _build_day_view(_parse_iso_date(date), repos, demo_enabled=demo_enabled)


@router.get("/today", response_model=DayView, tags=["read"])
async def get_today(
    repos: Annotated[Repositories, Depends(get_repos)],
    demo_enabled: Annotated[bool, Depends(get_demo_history_enabled_dep)],
) -> DayView:
    """Convenience alias for the current UTC date's day view."""
    return await _build_day_view(datetime.now(UTC).date(), repos, demo_enabled=demo_enabled)


@router.get("/month/{month}/summary", response_model=MonthSummary, tags=["read"])
async def get_month_summary(
    month: str,
    repos: Annotated[Repositories, Depends(get_repos)],
    demo_enabled: Annotated[bool, Depends(get_demo_history_enabled_dep)],
) -> MonthSummary:
    """Roll a calendar month (``YYYY-MM``) up for the Past view (SAV-60).

    Aggregates every event that month into counts of days journaled, total
    events, distinct real people, the top few people by interaction, and the
    busiest day. Empty months return a valid zeroed summary; a malformed
    ``month`` 400s.
    """
    return await _build_month_summary(_parse_month(month), repos, demo_enabled=demo_enabled)
