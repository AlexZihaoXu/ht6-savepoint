"""Tests for the demo-history fallback (services/demo_history.py).

Default-off, matching the pixellab_enabled idiom: with the dependency
overridden to False (the real default), the read API must behave exactly as
it did before demo_history existed — no fake people/days/events leak into an
otherwise-empty response. Overridden to True, it fills genuine gaps in the
past ~week but never overrides real data for a date, and never covers today.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.read import get_demo_history_enabled_dep, get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Event, EventType

_TODAY = datetime.now(UTC).date()
_YESTERDAY = _TODAY - timedelta(days=1)
_YESTERDAY_ID = _YESTERDAY.isoformat()


@asynccontextmanager
async def _client(repos: Repositories, *, demo_enabled: bool) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_repos] = lambda: repos
    app.dependency_overrides[get_demo_history_enabled_dep] = lambda: demo_enabled
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_repos, None)
        app.dependency_overrides.pop(get_demo_history_enabled_dep, None)


# --------------------------------------------------------------------------- #
# Default-off: byte-identical to no demo_history at all
# --------------------------------------------------------------------------- #


async def test_disabled_day_view_stays_empty(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=False) as client:
        resp = await client.get(f"/day/{_YESTERDAY_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["events"] == []
    assert body["people"] == []
    assert body["recap"] is None


async def test_disabled_people_list_has_no_demo_cast(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=False) as client:
        resp = await client.get("/people")
    assert resp.json() == []


async def test_disabled_demo_person_detail_404s(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=False) as client:
        resp = await client.get("/people/demo-mia")
    assert resp.status_code == 404


async def test_disabled_days_list_has_no_demo_tiles(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=False) as client:
        resp = await client.get("/days")
    assert resp.json() == []


# --------------------------------------------------------------------------- #
# Enabled: fills genuine gaps, never overrides real data, never covers today
# --------------------------------------------------------------------------- #


async def test_enabled_fills_an_empty_past_day(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=True) as client:
        resp = await client.get(f"/day/{_YESTERDAY_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["events"]) > 0
    assert body["day"]["plant_stage"] > 0
    assert body["recap"] is not None
    assert all(p["local_id"].startswith("demo-") for p in body["people"])


async def test_enabled_real_events_win_over_demo(repos: Repositories) -> None:
    """A date with a real event of its own is untouched by demo history."""
    real_event = Event(
        ts=datetime.combine(_YESTERDAY, datetime.min.time(), tzinfo=UTC).replace(hour=12),
        person_id="edge-abc123",
        type=EventType.SEEN,
        day_id=_YESTERDAY_ID,
    )
    await repos.events.insert(real_event)

    async with _client(repos, demo_enabled=True) as client:
        resp = await client.get(f"/day/{_YESTERDAY_ID}")

    body = resp.json()
    assert len(body["events"]) == 1
    assert body["events"][0]["person_id"] == "edge-abc123"


async def test_enabled_today_is_never_demo(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=True) as client:
        resp = await client.get("/today")
    body = resp.json()
    assert body["events"] == []
    assert body["people"] == []


async def test_enabled_people_list_never_includes_demo_cast(repos: Repositories) -> None:
    """/people is the "who I know right now" roster (Plaza wandering cast,
    tap-to-name picker, People page) — not a past-time view, so the demo cast
    never appears there even with demo history on. It only surfaces inside
    actual past-time views (a day, the days calendar, a person's own page)."""
    async with _client(repos, demo_enabled=True) as client:
        resp = await client.get("/people")
    local_ids = {p["local_id"] for p in resp.json()}
    assert "demo-mia" not in local_ids


async def test_enabled_demo_person_detail_resolves(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=True) as client:
        resp = await client.get("/people/demo-mia")
    assert resp.status_code == 200
    body = resp.json()
    assert body["local_id"] == "demo-mia"
    assert body["name"] == "Mia"
    assert len(body["events"]) > 0


async def test_enabled_days_list_includes_demo_tiles(repos: Repositories) -> None:
    async with _client(repos, demo_enabled=True) as client:
        resp = await client.get("/days")
    dates = {d["date"] for d in resp.json()}
    assert _YESTERDAY_ID in dates
