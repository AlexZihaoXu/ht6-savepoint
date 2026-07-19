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
from savepoint_server.models import Event, EventType, Person, Transcript, TranscriptSegment
from savepoint_server.models.person import AvatarParams
from savepoint_server.services.ingest import auto_match_speakers_to_seen_people
from savepoint_server.services.speech import AudioInput

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


def _vector(seed: float) -> list[float]:
    """A distinguishable-but-reproducible 512-d embedding (mirrors
    edge/tests/test_identity_gallery.py's generator) — NOT a uniform fill
    like [c]*512, which is a scalar multiple of every other uniform fill and
    so is indistinguishable from any of them under cosine similarity."""
    return [((seed + i * 0.37) % 1.0) - 0.5 for i in range(512)]


def _jittered(seed: float, amount: float) -> list[float]:
    """Same identity as _vector(seed), small per-dimension noise — models a
    second, slightly-different capture of the same real face."""
    base = _vector(seed)
    return [v + (amount if i % 2 == 0 else -amount) for i, v in enumerate(base)]


def _edge_event(
    local_id: str,
    seen_at: datetime,
    *,
    place: str | None = None,
    face_embedding: list[float] | None = None,
    ts_unix_ms: int | None = None,
    avatar: dict[str, object] | None = None,
) -> dict[str, object]:
    """Build an EdgeEvent JSON payload (edge/types.py wire shape)."""
    return {
        "ts_unix_ms": ts_unix_ms if ts_unix_ms is not None else _ms(seen_at),
        "local_id": local_id,
        "type": "seen",
        "avatar_params": avatar if avatar is not None else _avatar_dict(),
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
    assert person.face_embeddings == [embedding]
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
    assert person.face_embeddings == [embedding]


async def test_ingest_video_reseen_person_accumulates_embedding_gallery(
    repos: Repositories,
) -> None:
    """Re-seeing a known local_id APPENDS to the face-embedding gallery
    instead of overwriting it — the fix for people fragmenting into
    duplicates as their single stored sample drifted with lighting/pose."""
    first, second = _vector(0.2), _vector(0.75)
    async with _client(repos) as client:
        await client.post("/ingest/video", json=[_edge_event("alex", BASE, face_embedding=first)])
        await client.post(
            "/ingest/video",
            json=[_edge_event("alex", BASE + timedelta(hours=1), face_embedding=second)],
        )
    person = await repos.people.get_by_local_id("alex")
    assert person is not None
    assert person.face_embeddings == [first, second]


async def test_ingest_video_gallery_capped_at_max_size(repos: Repositories) -> None:
    """The gallery keeps only the most recent samples, oldest dropped first."""
    samples = [_vector(seed / 10) for seed in range(10)]
    async with _client(repos) as client:
        for i, sample in enumerate(samples):
            await client.post(
                "/ingest/video",
                json=[_edge_event("alex", BASE + timedelta(minutes=i), face_embedding=sample)],
            )
    person = await repos.people.get_by_local_id("alex")
    assert person is not None
    assert person.face_embeddings == samples[-8:]


async def test_ingest_video_matches_via_older_gallery_sample_after_drift(
    repos: Repositories,
) -> None:
    """A duplicate-local_id re-mint whose embedding only resembles an OLDER
    gallery sample (not the most recent one) must still resolve onto the
    existing Person — proves matching isn't limited to the latest sample."""
    original = _vector(0.2)
    unrelated_later_sample = _vector(0.75)  # cos(original, this) is strongly negative
    drifted_but_matches_original = _jittered(0.2, 0.02)

    async with _client(repos) as client:
        await client.post(
            "/ingest/video", json=[_edge_event("alex", BASE, face_embedding=original)]
        )
        await client.post(
            "/ingest/video",
            json=[
                _edge_event(
                    "alex", BASE + timedelta(hours=1), face_embedding=unrelated_later_sample
                )
            ],
        )
        resp = await client.post(
            "/ingest/video",
            json=[
                _edge_event(
                    "alex-session2",
                    BASE + timedelta(hours=2),
                    face_embedding=drifted_but_matches_original,
                )
            ],
        )

    assert resp.status_code == 200
    assert [p["local_id"] for p in resp.json()["people"]] == ["alex"]
    assert await repos.people.count() == 1


async def test_ingest_video_reseen_person_keeps_original_avatar(repos: Repositories) -> None:
    """A re-seen person's avatar must NOT change, even if the edge sends a
    different avatar_params payload on the later sighting — edge-side
    avatar_params are a hash of that sighting's raw (noisy) embedding, so a
    second sighting legitimately hashes to a different look; overwriting on
    every touch would make a recurring character's appearance reset/flicker
    on every re-sighting instead of staying the one fixed look they were
    first met with."""
    second_look = {
        "skin_tone": "deep",
        "hair_color": "black",
        "hair_style": "long",
        "glasses": True,
        "hat": "cap",
        "shirt_color": "red",
    }
    payload = [
        _edge_event("alex", BASE, avatar=_avatar_dict()),
        _edge_event("alex", BASE + timedelta(hours=2), avatar=second_look),
    ]

    async with _client(repos) as client:
        resp = await client.post("/ingest/video", json=payload)

    assert resp.status_code == 200
    person = await repos.people.get_by_local_id("alex")
    assert person is not None
    assert person.avatar_params.skin_tone == "fair"  # the FIRST sighting's look
    assert person.avatar_params.hair_color == "brown"
    assert person.avatar_params.shirt_color == "blue"


async def test_ingest_video_unrecognized_local_id_reuses_person_by_embedding(
    repos: Repositories,
) -> None:
    """A never-before-seen local_id whose embedding closely matches an existing
    Person (the edge's session-scoped IdentityGallery minted a fresh local_id
    after a track expired/reformed, even though the same physical person never
    left) must reuse that Person, not create a duplicate."""
    embedding = _vector(0.11)
    async with _client(repos) as client:
        await client.post(
            "/ingest/video", json=[_edge_event("edge-session1-abc", BASE, face_embedding=embedding)]
        )
        resp = await client.post(
            "/ingest/video",
            json=[
                _edge_event(
                    "edge-session2-xyz",  # brand-new local_id, same real face
                    BASE + timedelta(minutes=1),
                    face_embedding=_jittered(0.11, 0.02),
                )
            ],
        )

    assert resp.status_code == 200
    body = resp.json()
    # Resolved onto the ORIGINAL person's local_id, not the new edge-supplied one.
    assert [p["local_id"] for p in body["people"]] == ["edge-session1-abc"]
    assert await repos.people.count() == 1
    person = await repos.people.get_by_local_id("edge-session1-abc")
    assert person is not None
    assert person.last_seen == BASE + timedelta(minutes=1)
    # Both detections landed as SEEN events under the one person.
    events = await repos.events.list_for_day(DAY)
    assert len(events) == 2
    assert {e.person_id for e in events} == {"edge-session1-abc"}


async def test_ingest_video_unrecognized_local_id_with_dissimilar_embedding_creates_new_person(
    repos: Repositories,
) -> None:
    """A never-before-seen local_id whose embedding does NOT resemble anyone
    known is a genuinely new person, not a false merge."""
    async with _client(repos) as client:
        await client.post(
            "/ingest/video", json=[_edge_event("alex", BASE, face_embedding=_vector(0.11))]
        )
        resp = await client.post(
            "/ingest/video",
            json=[_edge_event("sam", BASE + timedelta(minutes=1), face_embedding=_vector(0.6))],
        )

    assert resp.status_code == 200
    assert [p["local_id"] for p in resp.json()["people"]] == ["sam"]
    assert await repos.people.count() == 2


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


async def test_assign_speaker_binds_to_you_without_a_person_doc(repos: Repositories) -> None:
    """Binding a label to "you" needs no Person doc — the wearer has none by design."""
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE, "one"))
    await repos.events.insert(_spoke("Speaker 2", DAY, BASE + timedelta(minutes=1), "other"))

    async with _client(repos) as client:
        resp = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "you"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["reassigned"] == 1
    # "you" resolves to no Person doc, so it's excluded from the day's people
    # list (same as any other unresolved label) — but the event itself is
    # rewritten and shows up in the day's events.
    assert body["day"]["people"] == []
    you_events = await repos.events.list_for_person("you")
    assert {e.text for e in you_events} == {"one"}
    assert await repos.events.count({"person_id": "Speaker 2"}) == 1


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
    """Pi video + app audio land on one day and auto-align (DESIGN §4's
    timeline alignment): alex was seen close in time to "Speaker 1"'s only
    utterance, so /ingest/audio resolves it automatically — no manual
    tap-to-name needed. A redundant manual assign-speaker call afterward is
    just idempotent (0 left to reassign), still safe to call."""
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
        # Both streams already resolve to alex — no "Speaker 1" left at all.
        aligned = (await client.get(f"/day/{DAY}")).json()
        assert [p["local_id"] for p in aligned["people"]] == ["alex"]
        spoke = [e for e in aligned["events"] if e["type"] == "spoke"]
        assert spoke and all(e["person_id"] == "alex" for e in spoke)

        # Tap-to-name still works, it just has nothing left to do here.
        assign = await client.post(
            f"/day/{DAY}/assign-speaker",
            json={"speaker_label": "Speaker 1", "person_local_id": "alex"},
        )
        assert assign.json()["reassigned"] == 0


# --------------------------------------------------------------------------- #
# POST /ingest/audio/clip  (multipart clip -> diarize -> NTP-anchored ingest)
# --------------------------------------------------------------------------- #


def _fake_transcript() -> Transcript:
    """A tiny 2-segment transcript with clip-RELATIVE second offsets."""
    return Transcript(
        segments=[
            TranscriptSegment(speaker="Speaker 1", text="hello there", start=0.0, end=1.0),
            TranscriptSegment(speaker="Speaker 2", text="general kenobi", start=1.0, end=2.0),
        ]
    )


class _FakeTranscriber:
    """Deterministic transcriber: ignores the audio bytes, returns fixed segments."""

    def __init__(self, transcript: Transcript) -> None:
        self._transcript = transcript

    def transcribe(self, audio: AudioInput) -> Transcript:
        return self._transcript.model_copy(deep=True)


@asynccontextmanager
async def _clip_client(
    repos: Repositories, transcriber: _FakeTranscriber
) -> AsyncIterator[AsyncClient]:
    """ASGI client with the ingest ``repos`` + transcriber dependencies overridden."""
    app.dependency_overrides[ingest_api.get_repos] = lambda: repos
    app.dependency_overrides[ingest_api.get_transcriber_dep] = lambda: transcriber
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(ingest_api.get_repos, None)
        app.dependency_overrides.pop(ingest_api.get_transcriber_dep, None)


async def test_ingest_audio_clip_anchors_segments_on_started_at(repos: Repositories) -> None:
    """Clip + started_at -> 2 SPOKE events, each ts = started_at + its relative offset."""
    started = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)
    async with _clip_client(repos, _FakeTranscriber(_fake_transcript())) as client:
        resp = await client.post(
            "/ingest/audio/clip",
            files={"audio": ("clip.webm", b"fake clip bytes", "audio/webm")},
            data={"started_at": started.isoformat()},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["events"]) == 2
    assert [d["_id"] for d in body["days"]] == [DAY]

    events = await repos.events.list_for_day(DAY)
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
    assert [e.text for e in events] == ["hello there", "general kenobi"]
    assert all(e.type is EventType.SPOKE for e in events)
    # PROVE the NTP anchoring: relative 0s/1s offsets land at started_at + offset.
    assert events[0].ts == started + timedelta(seconds=0)
    assert events[1].ts == started + timedelta(seconds=1)

    # The day rolled up with a garden-plant stage.
    day = await repos.days.get_by_date(date.fromisoformat(DAY))
    assert day is not None and day.summary is not None
    assert day.summary.events == 2
    assert day.plant_stage is not None


async def test_ingest_audio_clip_bad_started_at_400(repos: Repositories) -> None:
    """A malformed started_at is a clean 400; nothing is written."""
    async with _clip_client(repos, _FakeTranscriber(_fake_transcript())) as client:
        resp = await client.post(
            "/ingest/audio/clip",
            files={"audio": ("clip.webm", b"fake clip bytes", "audio/webm")},
            data={"started_at": "not-a-datetime"},
        )
    assert resp.status_code == 400
    assert await repos.events.count() == 0


async def test_ingest_audio_clip_naive_started_at_400(repos: Repositories) -> None:
    """A timezone-naive started_at is rejected so SPOKE ts stay NTP/UTC-comparable."""
    async with _clip_client(repos, _FakeTranscriber(_fake_transcript())) as client:
        resp = await client.post(
            "/ingest/audio/clip",
            files={"audio": ("clip.webm", b"fake clip bytes", "audio/webm")},
            data={"started_at": "2026-07-18T09:00:00"},  # no UTC offset
        )
    assert resp.status_code == 400
    assert await repos.events.count() == 0


async def test_ingest_audio_clip_empty_upload_400(repos: Repositories) -> None:
    """An empty (zero-byte) clip is a clean 400; nothing is written."""
    started = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)
    async with _clip_client(repos, _FakeTranscriber(_fake_transcript())) as client:
        resp = await client.post(
            "/ingest/audio/clip",
            files={"audio": ("clip.webm", b"", "audio/webm")},
            data={"started_at": started.isoformat()},
        )
    assert resp.status_code == 400
    assert await repos.events.count() == 0


# --------------------------------------------------------------------------- #
# Timeline alignment: auto_match_speakers_to_seen_people (DESIGN §4)
# --------------------------------------------------------------------------- #


def _seen(person_id: str, day_id: str, ts: datetime) -> Event:
    """A stored SEEN event (helper for the timeline-alignment tests)."""
    return Event(ts=ts, person_id=person_id, type=EventType.SEEN, day_id=day_id)


async def test_auto_match_binds_the_only_person_seen_nearby(repos: Repositories) -> None:
    """One real person consistently seen near an unresolved label's utterances
    -> auto-bound, same as a manual tap-to-name would have done."""
    await repos.people.upsert(_person("alex"))
    await repos.events.insert(_seen("alex", DAY, BASE))
    await repos.events.insert(_seen("alex", DAY, BASE + timedelta(minutes=1)))
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE + timedelta(seconds=10), "hi"))
    await repos.events.insert(
        _spoke("Speaker 1", DAY, BASE + timedelta(minutes=1, seconds=5), "again")
    )

    matched = await auto_match_speakers_to_seen_people(DAY, repos, window_s=60.0)

    assert matched == {"Speaker 1": "alex"}
    spoke_events = [e for e in await repos.events.list_for_day(DAY) if e.type is EventType.SPOKE]
    assert {e.person_id for e in spoke_events} == {"alex"}


async def test_auto_match_skips_you_and_already_resolved_labels(repos: Repositories) -> None:
    """ "you" (voice-matched already) and a label already a real Person are
    left alone -- nothing to resolve, no accidental double-processing."""
    await repos.people.upsert(_person("alex"))
    await repos.events.insert(_seen("alex", DAY, BASE))
    await repos.events.insert(_spoke("you", DAY, BASE, "already resolved"))
    await repos.events.insert(_spoke("alex", DAY, BASE, "already a real person"))

    matched = await auto_match_speakers_to_seen_people(DAY, repos, window_s=60.0)

    assert matched == {}


async def test_auto_match_leaves_ambiguous_labels_alone(repos: Repositories) -> None:
    """Two different real people seen near the same unresolved label's
    utterances -> ambiguous, left for manual tap-to-name rather than
    guessing wrong."""
    await repos.people.upsert(_person("alex"))
    await repos.people.upsert(_person("sam"))
    await repos.events.insert(_seen("alex", DAY, BASE))
    await repos.events.insert(_seen("sam", DAY, BASE + timedelta(minutes=2)))
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE + timedelta(seconds=5), "hi"))
    await repos.events.insert(
        _spoke("Speaker 1", DAY, BASE + timedelta(minutes=2, seconds=5), "again")
    )

    matched = await auto_match_speakers_to_seen_people(DAY, repos, window_s=60.0)

    assert matched == {}
    spoke_events = [e for e in await repos.events.list_for_day(DAY) if e.type is EventType.SPOKE]
    assert {e.person_id for e in spoke_events} == {"Speaker 1"}


async def test_auto_match_ignores_sightings_outside_the_window(repos: Repositories) -> None:
    """A person seen well outside window_s of every utterance never votes,
    so a label with nobody plausibly nearby simply stays unresolved."""
    await repos.people.upsert(_person("alex"))
    await repos.events.insert(_seen("alex", DAY, BASE))
    await repos.events.insert(_spoke("Speaker 1", DAY, BASE + timedelta(minutes=10), "hi"))

    matched = await auto_match_speakers_to_seen_people(DAY, repos, window_s=60.0)

    assert matched == {}


async def test_ingest_audio_response_reflects_the_auto_match(repos: Repositories) -> None:
    """End to end over the real endpoint: seed a SEEN event first, then POST
    /ingest/audio with a nearby-in-time raw label -- the HTTP response's
    events already carry the resolved Person, not the stale raw label the
    in-memory copy was built from before matching ran."""
    await repos.people.upsert(_person("alex"))
    await repos.events.insert(_seen("alex", DAY, BASE))

    payload = {"segments": [_segment("Speaker 1", BASE, BASE + timedelta(seconds=3), "hello")]}
    async with _client(repos) as client:
        resp = await client.post("/ingest/audio", json=payload)

    assert resp.status_code == 200
    body = resp.json()
    assert [e["person_id"] for e in body["events"]] == ["alex"]

    stored = await repos.events.list_for_day(DAY)
    assert [e.person_id for e in stored if e.type is EventType.SPOKE] == ["alex"]
