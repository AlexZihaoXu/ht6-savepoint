"""Tests for GET /month/{month}/summary (SAV-60): the Past-view month rollup.

Seeds people + events across a month through the repositories, then reads back
over an ASGI client with ``get_repos`` overridden to the test-DB ``repos``
fixture — the same pattern the read-API tests use. Covers the aggregate counts
and ordering, the top-5 cap, unbound-speaker exclusion, the empty-month zeroed
response, and malformed-month 400s.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.read import get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Event, EventType, Person
from savepoint_server.models.person import AvatarParams

BASE = datetime(2026, 7, 1, 9, 0, tzinfo=UTC)


def _avatar() -> AvatarParams:
    return AvatarParams(
        skin_tone="fair", hair_color="brown", hair_style="short", shirt_color="blue"
    )


def _person(local_id: str, *, name: str | None = None) -> Person:
    return Person(local_id=local_id, name=name, avatar_params=_avatar(), first_seen=BASE)


def _event(person_id: str, day_id: str, ts: datetime) -> Event:
    return Event(ts=ts, person_id=person_id, type=EventType.SPOKE, text="hi", day_id=day_id)


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


async def test_month_summary_aggregates_counts_ordering_and_busiest(repos: Repositories) -> None:
    await repos.people.upsert(_person("alice", name="Alice"))
    await repos.people.upsert(_person("bob", name="Bob"))
    await repos.people.upsert(_person("carol", name="Carol"))

    # 2026-07-01: alice x2, bob x1, unbound Speaker 1 x1 -> 4 events (busiest).
    await repos.events.insert(_event("alice", "2026-07-01", BASE))
    await repos.events.insert(_event("alice", "2026-07-01", BASE))
    await repos.events.insert(_event("bob", "2026-07-01", BASE))
    await repos.events.insert(_event("Speaker 1", "2026-07-01", BASE))
    # 2026-07-02: alice x1, carol x2 -> 3 events.
    await repos.events.insert(_event("alice", "2026-07-02", BASE))
    await repos.events.insert(_event("carol", "2026-07-02", BASE))
    await repos.events.insert(_event("carol", "2026-07-02", BASE))
    # 2026-07-05: bob x1, unbound Speaker 1 x1 -> 2 events.
    await repos.events.insert(_event("bob", "2026-07-05", BASE))
    await repos.events.insert(_event("Speaker 1", "2026-07-05", BASE))
    # Adjacent-month events must not bleed in.
    await repos.events.insert(_event("alice", "2026-06-30", BASE))
    await repos.events.insert(_event("alice", "2026-08-01", BASE))

    async with _client(repos) as client:
        resp = await client.get("/month/2026-07/summary")

    assert resp.status_code == 200
    body = resp.json()
    assert body["month"] == "2026-07"
    assert body["days_journaled"] == 3  # 07-01, 07-02, 07-05
    assert body["total_events"] == 9  # 4 + 3 + 2; unbound Speaker events counted here
    assert body["people_count"] == 3  # alice, bob, carol; Speaker 1 excluded

    # top_people: alice(3) first; bob(2) and carol(2) tie -> "Bob" < "Carol".
    assert [tp["person"]["local_id"] for tp in body["top_people"]] == ["alice", "bob", "carol"]
    assert [tp["interactions"] for tp in body["top_people"]] == [3, 2, 2]
    # Person surfaces with its plain _id, no unbound "Speaker N" among them.
    assert body["top_people"][0]["person"]["_id"] == "alice"
    assert all(tp["person"]["local_id"] != "Speaker 1" for tp in body["top_people"])

    # busiest_day: 07-01 with 4 events.
    assert body["busiest_day"] == {"date": "2026-07-01", "events": 4}


async def test_month_summary_top_people_capped_at_five(repos: Repositories) -> None:
    # Six real people with distinct, descending event counts (6..1).
    for i in range(6):
        local_id = f"p{i}"
        await repos.people.upsert(_person(local_id, name=f"Name{i}"))
        for _ in range(6 - i):
            await repos.events.insert(_event(local_id, "2026-07-10", BASE))

    async with _client(repos) as client:
        resp = await client.get("/month/2026-07/summary")

    body = resp.json()
    assert body["people_count"] == 6
    # Only the top five by count, p0(6)..p4(2); p5(1) dropped.
    assert [tp["person"]["local_id"] for tp in body["top_people"]] == ["p0", "p1", "p2", "p3", "p4"]
    assert [tp["interactions"] for tp in body["top_people"]] == [6, 5, 4, 3, 2]


async def test_month_summary_empty_month_is_zeroed_200(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.get("/month/2026-03/summary")

    assert resp.status_code == 200
    assert resp.json() == {
        "month": "2026-03",
        "days_journaled": 0,
        "total_events": 0,
        "people_count": 0,
        "top_people": [],
        "busiest_day": None,
    }


async def test_month_summary_all_unbound_speakers_have_no_real_people(repos: Repositories) -> None:
    # Events exist, but none resolve to a real Person -> counted in totals only.
    await repos.events.insert(_event("Speaker 1", "2026-07-01", BASE))
    await repos.events.insert(_event("Speaker 2", "2026-07-01", BASE))

    async with _client(repos) as client:
        resp = await client.get("/month/2026-07/summary")

    body = resp.json()
    assert body["total_events"] == 2
    assert body["days_journaled"] == 1
    assert body["people_count"] == 0
    assert body["top_people"] == []
    assert body["busiest_day"] == {"date": "2026-07-01", "events": 2}


async def test_month_summary_bad_month_400(repos: Repositories) -> None:
    async with _client(repos) as client:
        for bad in ("2026-13", "julyy", "2026-7", "2026-07-01", "2026", "2026-00"):
            resp = await client.get(f"/month/{bad}/summary")
            assert resp.status_code == 400, f"expected 400 for {bad!r}, got {resp.status_code}"
