"""Round-trip tests for the MongoDB repositories (against a real database)."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime

from pymongo import MongoClient

from savepoint_server.db import Repositories
from savepoint_server.models import (
    AvatarParams,
    Day,
    Event,
    EventType,
    Person,
    Recap,
    RecapScope,
)

TEST_URI = os.environ.get("SAVEPOINT_MONGO_URI", "mongodb://127.0.0.1:27017")
TEST_DB = os.environ.get("SAVEPOINT_TEST_MONGO_DB", "savepoint_test")

AVATAR = AvatarParams(
    skin_tone="tan",
    hair_color="brown",
    hair_style="short",
    glasses=True,
    shirt_color="green",
)


def _person(local_id: str = "spk_001", **overrides: object) -> Person:
    base = {
        "local_id": local_id,
        "name": "Alex",
        "avatar_params": AVATAR,
        "tags": ["teammate"],
        "first_seen": datetime(2026, 7, 18, 9, 0, tzinfo=UTC),
    }
    base.update(overrides)
    return Person(**base)


async def test_person_round_trip(repos: Repositories) -> None:
    stored = await repos.people.insert(_person())
    # People are keyed by their stable local_id.
    assert stored.id == "spk_001"

    fetched = await repos.people.get_by_local_id("spk_001")
    assert fetched is not None
    assert fetched.id == "spk_001"
    assert fetched.name == "Alex"
    assert fetched.avatar_params == AVATAR
    assert fetched.tags == ["teammate"]
    # Datetime survives the trip (tz-aware UTC).
    assert fetched.first_seen == datetime(2026, 7, 18, 9, 0, tzinfo=UTC)

    listed = await repos.people.list()
    assert [p.id for p in listed] == ["spk_001"]


async def test_person_upsert_is_idempotent(repos: Repositories) -> None:
    await repos.people.upsert(_person(name="Alex"))
    await repos.people.upsert(_person(name="Alexandra", favorite=True))

    # Same local_id → still exactly one document, latest write wins.
    assert await repos.people.count() == 1
    fetched = await repos.people.get_by_local_id("spk_001")
    assert fetched is not None
    assert fetched.name == "Alexandra"
    assert fetched.favorite is True

    # A different person yields a distinct document.
    await repos.people.upsert(_person(local_id="spk_002", favorite=True))
    assert await repos.people.count() == 2
    favorites = await repos.people.list_favorites()
    assert {p.id for p in favorites} == {"spk_001", "spk_002"}


async def test_event_round_trip_and_filters(repos: Repositories) -> None:
    day_id = "2026-07-18"
    e1 = Event(
        ts=datetime(2026, 7, 18, 9, 0, tzinfo=UTC),
        person_id="spk_001",
        type=EventType.SEEN,
        day_id=day_id,
    )
    e2 = Event(
        ts=datetime(2026, 7, 18, 9, 5, tzinfo=UTC),
        person_id="spk_001",
        type=EventType.SPOKE,
        text="hey!",
        day_id=day_id,
    )
    e3 = Event(
        ts=datetime(2026, 7, 18, 10, 0, tzinfo=UTC),
        person_id="spk_002",
        type=EventType.SEEN,
        day_id=day_id,
    )
    for e in (e2, e3, e1):  # insert out of order
        await repos.events.insert(e)

    # Append-only events get unique generated ids.
    for_day = await repos.events.list_for_day(day_id)
    assert len(for_day) == 3
    ids = [e.id for e in for_day]
    assert all(ids) and len(set(ids)) == 3
    # Sorted ascending by timestamp.
    assert [e.ts for e in for_day] == sorted(e.ts for e in for_day)

    for_person = await repos.events.list_for_person("spk_001")
    assert len(for_person) == 2
    spoke = next(e for e in for_person if e.type is EventType.SPOKE)
    assert spoke.text == "hey!"


async def test_day_upsert_by_date(repos: Repositories) -> None:
    d = date(2026, 7, 18)
    await repos.days.upsert(Day(date=d, plant_stage=1))
    stored = await repos.days.upsert(Day(date=d, plant_stage=3, mood_color="amber"))

    assert stored.id == "2026-07-18"
    assert await repos.days.count() == 1  # keyed by ISO date

    fetched = await repos.days.get_by_date(d)
    assert fetched is not None
    assert fetched.date == d
    assert fetched.plant_stage == 3
    assert fetched.mood_color == "amber"


async def test_recap_upsert_by_date_and_scope(repos: Repositories) -> None:
    d = date(2026, 7, 18)
    await repos.recaps.upsert(Recap(date=d, scope=RecapScope.DAY, narrative="v1"))
    stored = await repos.recaps.upsert(
        Recap(date=d, scope=RecapScope.DAY, narrative="v2", highlights=["met Alex"])
    )
    assert stored.id == "2026-07-18:day"

    day_recap = await repos.recaps.get_by_date_scope(d, RecapScope.DAY)
    assert day_recap is not None
    assert day_recap.narrative == "v2"
    assert day_recap.highlights == ["met Alex"]

    # Different scope, same date → a separate document.
    await repos.recaps.upsert(Recap(date=d, scope=RecapScope.MONTH, narrative="month"))
    assert await repos.recaps.count() == 2


async def test_delete_and_cleanup(repos: Repositories) -> None:
    await repos.people.insert(_person())
    assert await repos.people.count() == 1

    assert await repos.people.delete("spk_001") is True
    assert await repos.people.get_by_local_id("spk_001") is None
    assert await repos.people.delete("spk_001") is False
    assert await repos.people.count() == 0


def test_lifespan_creates_indexes() -> None:
    """The FastAPI lifespan connects to Mongo and builds indexes on startup."""
    from fastapi.testclient import TestClient

    from savepoint_server.core.config import get_settings
    from savepoint_server.db import mongo as mongo_mod
    from savepoint_server.main import create_app

    os.environ["SAVEPOINT_MONGO_URI"] = TEST_URI
    os.environ["SAVEPOINT_MONGO_DB"] = TEST_DB
    get_settings.cache_clear()
    mongo_mod.close_client()
    try:
        with TestClient(create_app()) as client:
            assert client.get("/health").status_code == 200
        # Startup ran ensure_indexes: verify the unique people index exists.
        sync = MongoClient(TEST_URI)
        try:
            info = sync[TEST_DB]["people"].index_information()
            assert any(v.get("unique") for v in info.values())
        finally:
            sync.drop_database(TEST_DB)
            sync.close()
    finally:
        mongo_mod.close_client()
        os.environ.pop("SAVEPOINT_MONGO_DB", None)
        os.environ.pop("SAVEPOINT_MONGO_URI", None)
        get_settings.cache_clear()
