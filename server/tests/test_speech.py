"""Tests for the speech service and /speech/transcribe endpoint (SAV-32).

Everything here runs on the CI-safe StubTranscriber — no torch, no audio
processing, no pipeline subprocess. The stub's canned transcript is tc1-derived;
the expected reference is the identical copy under ``tests/fixtures/`` so nothing
reaches outside ``server/``. Persistence is checked against the real test Mongo.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.speech import get_repos, get_speech_transcriber
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import EventType, Transcript
from savepoint_server.services.speech import (
    AudioInput,
    StubTranscriber,
    event_from_segment,
    get_transcriber,
    transcribe_and_store,
)

FIXTURE = Path(__file__).parent / "fixtures" / "tc1_stub.json"
DAY_ID = "2026-07-18"


def _expected_transcript() -> Transcript:
    return Transcript.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_stub_transcriber_matches_fixture() -> None:
    """The default stub returns the tc1-derived fixture transcript verbatim."""
    result = StubTranscriber().transcribe(b"ignored audio bytes")
    assert result == _expected_transcript()
    assert [s.speaker for s in result.segments] == ["Speaker 1", "Speaker 2", "Speaker 2"]


def test_stub_is_the_default_transcriber() -> None:
    """CI-safe default: config selects the stub, so no torch/pipeline is touched."""
    assert isinstance(get_transcriber(), StubTranscriber)


def test_stub_output_is_independent_of_input() -> None:
    stub = StubTranscriber()
    assert stub.transcribe(b"a") == stub.transcribe(b"b")
    # A returned transcript can be mutated without corrupting later calls.
    first = stub.transcribe(b"a")
    first.segments.clear()
    assert len(stub.transcribe(b"a").segments) == 3


def test_event_mapping_keeps_speaker_label_and_timing() -> None:
    segment = _expected_transcript().segments[0]
    event = event_from_segment(segment, day_id=DAY_ID)
    assert event.type is EventType.SPOKE
    assert event.person_id == "Speaker 1"  # raw label kept for a later ticket
    assert event.text == segment.text
    assert event.start == segment.start
    assert event.end == segment.end
    assert event.overlap is True
    assert event.day_id == DAY_ID
    # ts = day midnight (UTC) + the segment's start offset.
    assert event.ts == datetime(2026, 7, 18, tzinfo=UTC) + timedelta(seconds=segment.start)


async def test_transcribe_and_store_round_trip(repos: Repositories) -> None:
    """Stub transcript -> events -> Mongo: count, order and fields all round-trip."""
    expected = _expected_transcript()

    stored = await transcribe_and_store(
        b"fake audio", day_id=DAY_ID, repos=repos, transcriber=StubTranscriber()
    )
    assert len(stored) == len(expected.segments) == 3
    assert all(e.id for e in stored)

    # Persisted in Mongo, returned newest-oldest-agnostic in ascending ts order.
    from_db = await repos.events.list_for_day(DAY_ID)
    assert len(from_db) == 3
    assert [e.ts for e in from_db] == sorted(e.ts for e in from_db)
    assert [e.person_id for e in from_db] == [s.speaker for s in expected.segments]
    assert [e.text for e in from_db] == [s.text for s in expected.segments]
    assert [e.start for e in from_db] == [s.start for s in expected.segments]
    assert all(e.type is EventType.SPOKE for e in from_db)
    assert all(e.day_id == DAY_ID for e in from_db)


async def test_transcribe_endpoint_persists_events(repos: Repositories) -> None:
    """POST /speech/transcribe returns a valid schema and persists the events."""
    app.dependency_overrides[get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/speech/transcribe",
                files={"file": ("clip.wav", b"fake audio bytes", "audio/wav")},
                data={"day_id": DAY_ID},
            )
    finally:
        app.dependency_overrides.pop(get_repos, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body["day_id"] == DAY_ID
    assert len(body["event_ids"]) == 3

    # Response payload is a valid Transcript matching the stub fixture.
    transcript = Transcript.model_validate(body["transcript"])
    assert transcript == _expected_transcript()

    # Events were actually written to Mongo under the given day.
    from_db = await repos.events.list_for_day(DAY_ID)
    assert {e.id for e in from_db} == set(body["event_ids"])
    assert [e.text for e in from_db] == [s.text for s in transcript.segments]


async def test_transcribe_endpoint_defaults_day_id_to_today(repos: Repositories) -> None:
    """Omitting day_id buckets the events under today's ISO date."""
    app.dependency_overrides[get_repos] = lambda: repos
    today = datetime.now(UTC).date().isoformat()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/speech/transcribe",
                files={"file": ("clip.wav", b"fake audio bytes", "audio/wav")},
            )
    finally:
        app.dependency_overrides.pop(get_repos, None)

    assert resp.status_code == 200
    assert resp.json()["day_id"] == today
    assert await repos.events.count({"day_id": today}) == 3


async def test_transcribe_endpoint_rejects_bad_day_id_with_400(repos: Repositories) -> None:
    """A malformed day_id is validated up front -> clean 400, not a 500."""
    app.dependency_overrides[get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            for bad in ("today", "2026-13-40", "18/07/2026"):
                resp = await client.post(
                    "/speech/transcribe",
                    files={"file": ("clip.wav", b"fake audio bytes", "audio/wav")},
                    data={"day_id": bad},
                )
                assert resp.status_code == 400, bad
    finally:
        app.dependency_overrides.pop(get_repos, None)
    # A bad day_id never wrote anything.
    assert await repos.events.count({}) == 0


class _RaisingTranscriber:
    """A transcriber that always fails — used to prove /preview never 500s."""

    def transcribe(self, audio: AudioInput) -> Transcript:
        raise RuntimeError("boom: decoding failed")


async def test_preview_happy_path_returns_segments() -> None:
    """POST /speech/preview returns the stub's diarized segments, store-free."""
    app.dependency_overrides[get_speech_transcriber] = lambda: StubTranscriber()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/speech/preview",
                files={"audio": ("clip.webm", b"fake audio bytes", "audio/webm")},
            )
    finally:
        app.dependency_overrides.pop(get_speech_transcriber, None)

    assert resp.status_code == 200
    expected = _expected_transcript()
    segments = resp.json()["segments"]
    assert [s["speaker"] for s in segments] == [seg.speaker for seg in expected.segments]
    assert [s["text"] for s in segments] == [seg.text for seg in expected.segments]
    assert [s["start"] for s in segments] == [seg.start for seg in expected.segments]
    assert [s["end"] for s in segments] == [seg.end for seg in expected.segments]
    # Every segment carries exactly the contract keys.
    assert all(set(s) == {"speaker", "start", "end", "text"} for s in segments)


async def test_preview_rejects_empty_upload_with_400() -> None:
    """An empty audio body is a clean 400, not a transcription attempt."""
    app.dependency_overrides[get_speech_transcriber] = lambda: StubTranscriber()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/speech/preview",
                files={"audio": ("clip.webm", b"", "audio/webm")},
            )
    finally:
        app.dependency_overrides.pop(get_speech_transcriber, None)

    assert resp.status_code == 400


async def test_preview_swallows_transcriber_errors_with_200_empty() -> None:
    """A failing transcriber never 500s — /preview returns 200 + empty segments."""
    app.dependency_overrides[get_speech_transcriber] = _RaisingTranscriber
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/speech/preview",
                files={"audio": ("clip.webm", b"fake audio bytes", "audio/webm")},
            )
    finally:
        app.dependency_overrides.pop(get_speech_transcriber, None)

    assert resp.status_code == 200
    assert resp.json() == {"segments": []}
