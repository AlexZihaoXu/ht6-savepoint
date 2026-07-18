"""Tests for the read API (SAV-34): GET endpoints the frontend renders from.

Covers ``/people`` (list + favourite filter + limit + sort), ``/people/{id}``
(detail + events + 404), ``/days`` (list + month filter), ``/day/{date}`` (the
composed day view, empty-day stub, unresolved-speaker robustness, bad-date 400)
and ``/today``. Everything seeds through the repositories, then reads back over an
ASGI client with ``get_repos`` overridden to the test-DB ``repos`` fixture — the
same pattern the ingest/speech e2e tests use, against the real test Mongo.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.read import get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Day, DaySummary, Event, EventType, Person, Recap
from savepoint_server.models.person import AvatarParams
from savepoint_server.models.recap import RecapScope

BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)


def _avatar() -> AvatarParams:
    return AvatarParams(
        skin_tone="fair", hair_color="brown", hair_style="short", shirt_color="blue"
    )


def _person(
    local_id: str,
    *,
    name: str | None = None,
    favorite: bool = False,
    last_seen: datetime | None = None,
) -> Person:
    return Person(
        local_id=local_id,
        name=name,
        avatar_params=_avatar(),
        favorite=favorite,
        first_seen=BASE,
        last_seen=last_seen,
    )


def _event(person_id: str, day_id: str, ts: datetime, text: str = "hi") -> Event:
    return Event(ts=ts, person_id=person_id, type=EventType.SPOKE, text=text, day_id=day_id)


@asynccontextmanager
async def _client(repos: Repositories) -> AsyncIterator[AsyncClient]:
    """ASGI client with ``get_repos`` pointed at the test-DB repositories."""
    app.dependency_overrides[get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_repos, None)


# --------------------------------------------------------------------------- #
# GET /people
# --------------------------------------------------------------------------- #


async def test_list_people_sorted_by_last_seen_desc(repos: Repositories) -> None:
    await repos.people.upsert(_person("alice", last_seen=BASE))
    await repos.people.upsert(_person("bob", last_seen=BASE + timedelta(hours=1)))
    await repos.people.upsert(_person("carol", favorite=True, last_seen=BASE + timedelta(hours=2)))

    async with _client(repos) as client:
        resp = await client.get("/people")

    assert resp.status_code == 200
    body = resp.json()
    assert [p["local_id"] for p in body] == ["carol", "bob", "alice"]
    # ids surface as the plain _id string (== local_id), no raw ObjectId.
    assert body[0]["_id"] == "carol"


async def test_list_people_favorite_filter_and_limit(repos: Repositories) -> None:
    await repos.people.upsert(_person("alice", last_seen=BASE))
    await repos.people.upsert(_person("bob", last_seen=BASE + timedelta(hours=1)))
    await repos.people.upsert(_person("carol", favorite=True, last_seen=BASE + timedelta(hours=2)))

    async with _client(repos) as client:
        favs = await client.get("/people", params={"favorite": "true"})
        non_favs = await client.get("/people", params={"favorite": "false"})
        limited = await client.get("/people", params={"limit": 1})

    assert [p["local_id"] for p in favs.json()] == ["carol"]
    assert {p["local_id"] for p in non_favs.json()} == {"alice", "bob"}
    assert [p["local_id"] for p in limited.json()] == ["carol"]  # most recent wins


async def test_list_people_empty(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.get("/people")
    assert resp.status_code == 200
    assert resp.json() == []


# --------------------------------------------------------------------------- #
# GET /people/{local_id}
# --------------------------------------------------------------------------- #


async def test_get_person_detail_with_events_newest_first(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex", last_seen=BASE))
    await repos.events.insert(_event("alex", "2026-07-18", BASE, text="first"))
    await repos.events.insert(_event("alex", "2026-07-19", BASE + timedelta(days=1), text="second"))
    # An event for someone else must not leak into Alex's detail.
    await repos.events.insert(_event("someone-else", "2026-07-18", BASE, text="nope"))

    async with _client(repos) as client:
        resp = await client.get("/people/alex")

    assert resp.status_code == 200
    body = resp.json()
    assert body["_id"] == "alex"
    assert body["local_id"] == "alex"
    assert body["name"] == "Alex"
    texts = [e["text"] for e in body["events"]]
    assert texts == ["second", "first"]  # list_for_person is ts-descending
    assert all(e["person_id"] == "alex" for e in body["events"])


async def test_get_person_detail_no_events(repos: Repositories) -> None:
    await repos.people.upsert(_person("lonely", last_seen=BASE))
    async with _client(repos) as client:
        resp = await client.get("/people/lonely")
    assert resp.status_code == 200
    assert resp.json()["events"] == []


async def test_get_person_404(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.get("/people/ghost")
    assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# GET /days
# --------------------------------------------------------------------------- #


async def test_list_days_desc_with_summary(repos: Repositories) -> None:
    for iso in ("2026-06-30", "2026-07-01", "2026-07-15", "2026-08-01"):
        await repos.days.upsert(
            Day(date=date.fromisoformat(iso), summary=DaySummary(people=2, events=5))
        )

    async with _client(repos) as client:
        resp = await client.get("/days")

    assert resp.status_code == 200
    body = resp.json()
    assert [d["date"] for d in body] == [
        "2026-08-01",
        "2026-07-15",
        "2026-07-01",
        "2026-06-30",
    ]
    assert body[0]["summary"] == {"people": 2, "events": 5}


async def test_list_days_month_filter_and_limit(repos: Repositories) -> None:
    for iso in ("2026-06-30", "2026-07-01", "2026-07-15", "2026-08-01"):
        await repos.days.upsert(Day(date=date.fromisoformat(iso)))

    async with _client(repos) as client:
        july = await client.get("/days", params={"month": "2026-07"})
        limited = await client.get("/days", params={"limit": 1})

    assert [d["date"] for d in july.json()] == ["2026-07-15", "2026-07-01"]
    assert [d["date"] for d in limited.json()] == ["2026-08-01"]


async def test_list_days_empty(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.get("/days")
    assert resp.status_code == 200
    assert resp.json() == []


# --------------------------------------------------------------------------- #
# GET /day/{date}
# --------------------------------------------------------------------------- #


async def test_day_view_composes_day_events_people_recap(repos: Repositories) -> None:
    iso = "2026-07-18"
    await repos.days.upsert(
        Day(
            date=date.fromisoformat(iso),
            mood_color="#88cc88",
            summary=DaySummary(people=1, events=3),
        )
    )
    await repos.people.upsert(_person("alex", name="Alex", last_seen=BASE))
    # Two events for a real person (must dedupe to one) + one unresolved speaker label.
    await repos.events.insert(_event("alex", iso, BASE + timedelta(minutes=10), text="b"))
    await repos.events.insert(_event("Speaker 1", iso, BASE + timedelta(minutes=20), text="c"))
    await repos.events.insert(_event("alex", iso, BASE, text="a"))
    # An event on another day must not bleed in.
    await repos.events.insert(_event("alex", "2026-07-19", BASE + timedelta(days=1), text="other"))
    await repos.recaps.upsert(
        Recap(date=date.fromisoformat(iso), scope=RecapScope.DAY, narrative="A good day.")
    )

    async with _client(repos) as client:
        resp = await client.get(f"/day/{iso}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["day"]["_id"] == iso
    assert body["day"]["mood_color"] == "#88cc88"

    # Events: this day only, ascending ts.
    texts = [e["text"] for e in body["events"]]
    assert texts == ["a", "b", "c"]
    ts = [e["ts"] for e in body["events"]]
    assert ts == sorted(ts)

    # People: only the resolvable real person, deduped; "Speaker 1" is skipped.
    assert [p["local_id"] for p in body["people"]] == ["alex"]

    assert body["recap"]["narrative"] == "A good day."


async def test_day_view_empty_is_stub_not_error(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.get("/day/2026-01-01")
    assert resp.status_code == 200
    body = resp.json()
    assert body["day"]["date"] == "2026-01-01"
    assert body["events"] == []
    assert body["people"] == []
    assert body["recap"] is None


async def test_day_view_bad_date_400(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.get("/day/not-a-date")
    assert resp.status_code == 400


# --------------------------------------------------------------------------- #
# GET /today
# --------------------------------------------------------------------------- #


async def test_today_returns_current_day_view(repos: Repositories) -> None:
    today = datetime.now(UTC).date()
    iso = today.isoformat()
    now = datetime.now(UTC)
    await repos.days.upsert(Day(date=today, summary=DaySummary(people=1, events=1)))
    await repos.people.upsert(_person("alex", name="Alex", last_seen=now))
    await repos.events.insert(_event("alex", iso, now, text="today-line"))

    async with _client(repos) as client:
        resp = await client.get("/today")

    assert resp.status_code == 200
    body = resp.json()
    assert body["day"]["date"] == iso
    assert [e["text"] for e in body["events"]] == ["today-line"]
    assert [p["local_id"] for p in body["people"]] == ["alex"]
