"""Decoupled two-stream ingest + tap-to-name (SAV-40 / SAV-39).

Exercises the JSON-only, timestamp-aligned ingest paths and the speaker-binding
mechanic end to end against the real test Mongo (the ``repos`` fixture), over an
ASGI client with every router's ``get_repos`` pointed at it — the same pattern the
combined-ingest and read-API e2e tests use.

* ``POST /ingest/video`` takes a bare ``list[EdgeEvent]`` (the Pi wire format,
  ``edge/types.py``): each upserts a Person keyed by ``local_id`` (avatar +
  512-d face embedding) and records a SEEN event at ``ts_unix_ms``.
* ``POST /ingest/audio`` takes diarized transcript segments (absolute ISO
  timestamps): each records a SPOKE event under the raw ``Speaker N`` label.
* ``POST /day/{date}/assign-speaker`` re-points a day's SPOKE events onto a real
  Person so the day-view join resolves them to the right character.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta

from httpx import ASGITransport, AsyncClient

from savepoint_server.api import binding as binding_api
from savepoint_server.api import ingest as ingest_api
from savepoint_server.api import read as read_api
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Event, EventType, Person
from savepoint_server.models.person import AvatarParams

DAY = "2026-07-18"
BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)


def _ms(dt: datetime) -> int:
    """Absolute unix epoch milliseconds for a datetime."""
    return int(dt.timestamp() * 1000)


def _avatar_dict() -> dict[str, object]:
    return {
        "skin_tone": "fair",
        "hair_color": "brown",
        "hair_style": "short",
        "glasses": False,
        "hat": None,
        "shirt_color": "blue",
    }


def _edge_event(
    local_id: str,
    seen_at: datetime,
    *,
    place: str | None = None,
    face_embedding: list[float] | None = None,
    ts_unix_ms: int | None = None,
) -> dict[str, object]:
    """Build an EdgeEvent JSON payload (edge/types.py wire shape)."""
    return {
        "ts_unix_ms": ts_unix_ms if ts_unix_ms is not None else _ms(seen_at),
        "local_id": local_id,
        "type": "seen",
        "avatar_params": _avatar_dict(),
        "face_embedding": face_embedding,
        "place": place,
        "schema_version": "savepoint.edge.v1",
    }


def _segment(speaker: str, start: datetime, end: datetime, text: str) -> dict[str, object]:
    return {
        "speaker": speaker,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "text": text,
    }


def _person(local_id: str, *, name: str | None = None) -> Person:
    return Person(
        local_id=local_id,
        name=name,
        avatar_params=AvatarParams(
            skin_tone="fair", hair_color="brown", hair_style="short", shirt_color="blue"
        ),
        first_seen=BASE,
        last_seen=BASE,
    )


def _spoke(person_id: str, day_id: str, ts: datetime, text: str) -> Event:
    """A stored SPOKE event (helper for the assign-speaker tests)."""
    return Event(ts=ts, person_id=person_id, type=EventType.SPOKE, text=text, day_id=day_id)


@asynccontextmanager
async def _client(repos: Repositories) -> AsyncIterator[AsyncClient]:
    """ASGI client with every router's ``get_repos`` pointed at the test repos."""
    for module in (ingest_api, binding_api, read_api):
        app.dependency_overrides[module.get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        for module in (ingest_api, binding_api, read_api):
            app.dependency_overrides.pop(module.get_repos, None)


# --------------------------------------------------------------------------- #
# POST /ingest/video  (list[EdgeEvent])
# --------------------------------------------------------------------------- #


async def test_ingest_video_creates_person_and_seen_event(repos: Repositories) -> None:
    """One EdgeEvent -> Person upsert (avatar + embedding) + SEEN event + Day."""
    embedding = [0.1] * 512
    payload = [_edge_event("alex", BASE, place="cafe", face_embedding=embedding)]

    async with _client(repos) as client:
        resp = await client.post("/ingest/video", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert [p["local_id"] for p in body["people"]] == ["alex"]
    assert len(body["events"]) == 1
    assert body["events"][0]["type"] == "seen"
    assert [d["_id"] for d in body["days"]] == [DAY]

    # Person landed in Mongo with the edge avatar + stored face embedding.
    person = await repos.people.get_by_local_id("alex")
    assert person is not None
    assert person.avatar_params.skin_tone == "fair"
    assert person.face_embedding == embedding
    assert person.first_seen is not None and person.last_seen is not None

    # A SEEN event tied to the person + day, carrying the place.
    events = await repos.events.list_for_day(DAY)
    assert len(events) == 1
    assert events[0].type is EventType.SEEN
    assert events[0].person_id == "alex"
    assert events[0].place == "cafe"

    # Day rolled up.
    day = await repos.days.get_by_date(date.fromisoformat(DAY))
    assert day is not None and day.summary is not None
    assert day.summary.events == 1
    assert day.summary.people == 1


async def test_ingest_video_reseen_person_is_single_doc(repos: Repositories) -> None:
    """Two EdgeEvents for one local_id -> one Person, last_seen advances, 2 events."""
    later = BASE + timedelta(hours=2)
    payload = [_edge_event("alex", BASE), _edge_event("alex", later)]

    async with _client(repos) as client:
        resp = await client.post("/ingest/video", json=payload)

    assert resp.status_code == 200
    assert await repos.people.count() == 1
    person = await repos.people.get_by_local_id("alex")
    assert person is not None
    assert person.last_seen == later  # chronological (batch processed in ts order)
    assert await repos.events.count({"day_id": DAY}) == 2


async def test_ingest_video_bad_ts_unix_ms_400(repos: Repositories) -> None:
    """A ts_unix_ms out of datetime range is a clean 400, and nothing is written."""
    payload = [_edge_event("alex", BASE, ts_unix_ms=10**30)]
    async with _client(repos) as client:
        resp = await client.post("/ingest/video", json=payload)
    assert resp.status_code == 400
    assert await repos.people.count() == 0
    assert await repos.events.count() == 0


async def test_ingest_video_embedding_not_wiped_when_absent(repos: Repositories) -> None:
    """A later EdgeEvent without an embedding must not wipe a stored one."""
    embedding = [0.5] * 512
    async with _client(repos) as client:
        await client.post(
            "/ingest/video", json=[_edge_event("alex", BASE, face_embedding=embedding)]
        )
        await client.post(
            "/ingest/video",
            json=[_edge_event("alex", BASE + timedelta(hours=1), face_embedding=None)],
        )
    person = await repos.people.get_by_local_id("alex")
    assert person is not None
    assert person.face_embedding == embedding


# --------------------------------------------------------------------------- #
# POST /ingest/audio  (diarized transcript segments)
# --------------------------------------------------------------------------- #


async def test_ingest_audio_creates_spoke_events(repos: Repositories) -> None:
    """Segments -> SPOKE events under the raw Speaker label, ts = absolute start."""
    payload = {
        "segments": [
            _segment("Speaker 1", BASE, BASE + timedelta(seconds=3), "hello"),
            _segment("Speaker 2", BASE + timedelta(seconds=4), BASE + timedelta(seconds=6), "hi"),
        ]
    }
    async with _client(repos) as client:
        resp = await client.post("/ingest/audio", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["events"]) == 2
    assert [d["_id"] for d in body["days"]] == [DAY]

    events = await repos.events.list_for_day(DAY)
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
    assert [e.text for e in events] == ["hello", "hi"]
    assert all(e.type is EventType.SPOKE for e in events)
    assert events[0].ts == BASE  # ts is the absolute start timestamp

    day = await repos.days.get_by_date(date.fromisoformat(DAY))
    assert day is not None and day.summary is not None
    assert day.summary.events == 2
    assert day.summary.people == 2  # two distinct speaker labels


async def test_ingest_audio_bad_start_400(repos: Repositories) -> None:
    """A malformed start timestamp is a clean 400; nothing is written."""
    payload = {
        "segments": [
            {
                "speaker": "Speaker 1",
                "start": "not-a-datetime",
                "end": BASE.isoformat(),
                "text": "x",
            }
        ]
    }
    async with _client(repos) as client:
        resp = await client.post("/ingest/audio", json=payload)
    assert resp.status_code == 400
    assert await repos.events.count() == 0


# --------------------------------------------------------------------------- #
# POST /day/{date}/assign-speaker  (tap-to-name)
# --------------------------------------------------------------------------- #


async def test_assign_speaker_rebinds_and_day_view_resolves(repos: Repositories) -> None:
    """Binding Speaker N -> Person rewrites events and the day view resolves them."""
    await repos.people.upsert(_person("alex", name="Alex"))
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE, "one"))
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE + timedelta(minutes=1), "two"))
    await repos.events.insert(_spoke("Speaker 2", DAY, BASE + timedelta(minutes=2), "other"))

    async with _client(repos) as client:
        resp = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "alex"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["reassigned"] == 2
    # The returned refreshed day view already resolves alex (Speaker 2 stays raw).
    assert [p["local_id"] for p in body["day"]["people"]] == ["alex"]

    # The rewrite persisted: alex now owns the two events; Speaker 1 has none.
    alex_events = await repos.events.list_for_person("alex")
    assert {e.text for e in alex_events} == {"one", "two"}
    assert await repos.events.count({"person_id": "Speaker 1"}) == 0

    # A plain GET /day/{date} reflects the same resolution.
    async with _client(repos) as client:
        view = await client.get(f"/day/{DAY}")
    assert [p["local_id"] for p in view.json()["people"]] == ["alex"]


async def test_assign_speaker_unknown_person_404(repos: Repositories) -> None:
    """Binding to a Person that doesn't exist is a 404; events are untouched."""
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE, "one"))
    async with _client(repos) as client:
        resp = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "ghost"},
        )
    assert resp.status_code == 404
    assert await repos.events.count({"person_id": "Speaker 1"}) == 1


async def test_assign_speaker_is_idempotent(repos: Repositories) -> None:
    """Re-assigning rewrites nothing the second time (reassigned == 0)."""
    await repos.people.upsert(_person("alex"))
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE, "one"))
    async with _client(repos) as client:
        first = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "alex"},
        )
        second = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "alex"},
        )
    assert first.json()["reassigned"] == 1
    assert second.json()["reassigned"] == 0


async def test_assign_speaker_bad_date_400(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex"))
    async with _client(repos) as client:
        resp = await client.post(
            "/day/not-a-date/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "alex"},
        )
    assert resp.status_code == 400


# --------------------------------------------------------------------------- #
# End-to-end: the two streams align on one shared day + tap-to-name binds them
# --------------------------------------------------------------------------- #


async def test_decoupled_streams_align_on_shared_day(repos: Repositories) -> None:
    """Pi video + app audio land on one day; tap-to-name unifies who-said-what."""
    async with _client(repos) as client:
        await client.post("/ingest/video", json=[_edge_event("alex", BASE, place="cafe")])
        await client.post(
            "/ingest/audio",
            json={
                "segments": [
                    _segment(
                        "Speaker 1", BASE + timedelta(seconds=5), BASE + timedelta(seconds=8), "hey"
                    )
                ]
            },
        )
        # Before binding: the day view shows only the SEEN person (alex), the SPOKE
        # line is still an unresolved "Speaker 1".
        pre = (await client.get(f"/day/{DAY}")).json()
        assert [p["local_id"] for p in pre["people"]] == ["alex"]
        assert {e["type"] for e in pre["events"]} == {"seen", "spoke"}

        assign = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "alex"},
        )
        assert assign.json()["reassigned"] == 1

        post = (await client.get(f"/day/{DAY}")).json()

    # After binding: both the seen and the spoke events resolve to alex.
    assert [p["local_id"] for p in post["people"]] == ["alex"]
    spoke = [e for e in post["events"] if e["type"] == "spoke"]
    assert spoke and all(e["person_id"] == "alex" for e in spoke)
