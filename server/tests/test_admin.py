"""Tests for the admin router (POST /admin/reset): the clean-slate data wipe.

Seeds one document into every collection through the repositories, then resets
over an ASGI client with ``get_repos`` overridden to the test-DB ``repos``
fixture (the same pattern as the read/ingest e2e tests), and asserts both the
reported per-collection counts and that every collection ends up empty.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.admin import get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Day, Event, EventType, Person, Recap
from savepoint_server.models.person import AvatarParams
from savepoint_server.models.recap import RecapScope

BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)


def _avatar() -> AvatarParams:
    return AvatarParams(
        skin_tone="fair", hair_color="brown", hair_style="short", shirt_color="blue"
    )


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


async def _seed(repos: Repositories) -> None:
    """One document in each of the four collections."""
    await repos.people.upsert(
        Person(local_id="alice", name="Alice", avatar_params=_avatar(), first_seen=BASE)
    )
    await repos.events.insert(
        Event(ts=BASE, person_id="alice", type=EventType.SPOKE, text="hi", day_id="2026-07-18")
    )
    await repos.days.upsert(Day(date=date(2026, 7, 18)))
    await repos.recaps.upsert(
        Recap(
            date=date(2026, 7, 18),
            scope=RecapScope.DAY,
            narrative="A good day.",
            highlights=["met Alice"],
        )
    )


async def test_reset_wipes_every_collection(repos: Repositories) -> None:
    await _seed(repos)

    async with _client(repos) as client:
        resp = await client.post("/admin/reset")

    assert resp.status_code == 200
    assert resp.json() == {"people": 1, "events": 1, "days": 1, "recaps": 1}

    # Everything is gone.
    assert await repos.people.count() == 0
    assert await repos.events.count() == 0
    assert await repos.days.count() == 0
    assert await repos.recaps.count() == 0


async def test_reset_on_empty_db_reports_zeros(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.post("/admin/reset")

    assert resp.status_code == 200
    assert resp.json() == {"people": 0, "events": 0, "days": 0, "recaps": 0}
