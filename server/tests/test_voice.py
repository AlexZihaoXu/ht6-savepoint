"""Tests for wearer voice enrollment + speaker auto-matching (SAV-?).

CI-safe: the real ``voiceprint.py``/``align.py`` subprocess is never invoked.
``cosine_similarity`` and ``match_voice_to_you`` are exercised as pure/async unit
tests (the latter with a real ``RealTranscriber`` instance constructed with
bogus paths, whose ``.transcribe()`` is never called — only ``.last_voiceprints``
is set directly, mirroring ``test_speech.py``'s ``_RealTranscriberSpy``), and
``POST /voice/enroll`` / ``GET /voice/status`` are exercised through the ASGI
app with a fake ``VoiceEnroller`` injected via ``dependency_overrides``.
"""

from __future__ import annotations

import math
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from savepoint_server.api.voice import get_enroller, get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Transcript, TranscriptSegment, WearerVoice
from savepoint_server.services.speech import RealTranscriber, StubTranscriber
from savepoint_server.services.voice import (
    VoiceEnrollmentError,
    cosine_similarity,
    match_voice_to_you,
)

BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)
CANNED_EMBEDDING = [1.0, 0.0, 0.0]
OTHER_EMBEDDING = [0.9, 0.1, 0.0]


def _same_instant(iso_a: str, iso_b: str) -> bool:
    """True if two ISO timestamps are within 1ms of each other.

    MongoDB's BSON datetime is millisecond-precision, so an ``enrolled_at``
    read back via ``GET /voice/status`` (round-tripped through Mongo) loses the
    sub-millisecond remainder of the in-process value a ``POST /voice/enroll``
    response returns straight from ``datetime.now(UTC)`` — comparing the two
    strings for exact equality is too strict.
    """
    a = datetime.fromisoformat(iso_a.replace("Z", "+00:00"))
    b = datetime.fromisoformat(iso_b.replace("Z", "+00:00"))
    return abs(a - b) < timedelta(milliseconds=1)


def _real_transcriber(*, voiceprints: dict[str, list[float]] | None = None) -> RealTranscriber:
    """A RealTranscriber with bogus paths whose .transcribe() must never run.

    Mirrors test_speech.py's ``_RealTranscriberSpy``: only used so
    ``isinstance(transcriber, RealTranscriber)`` is True and ``.last_voiceprints``
    can be set directly, without ever shelling out to the real pipeline.
    """
    t = RealTranscriber(
        pipeline_dir="/nonexistent",
        diarize_python="/nonexistent/python",
        align_python="/nonexistent/python",
        hf_token=None,
    )
    t.last_voiceprints = voiceprints or {}
    return t


def _transcript() -> Transcript:
    return Transcript(
        segments=[
            TranscriptSegment(speaker="Speaker 1", text="hi there", start=0.0, end=1.0),
            TranscriptSegment(speaker="Speaker 2", text="hey!", start=1.0, end=2.0),
            TranscriptSegment(speaker="Speaker 1", text="how's it going", start=2.0, end=3.0),
        ]
    )


class FakeEnroller:
    """A VoiceEnroller stand-in that records calls and returns a canned embedding."""

    def __init__(self, embedding: list[float] | None = None, *, error: str | None = None) -> None:
        self._embedding = embedding if embedding is not None else CANNED_EMBEDDING
        self._error = error
        self.calls: list[bytes] = []

    def enroll(self, audio: bytes) -> list[float]:
        self.calls.append(audio)
        if self._error is not None:
            raise VoiceEnrollmentError(self._error)
        return self._embedding


@asynccontextmanager
async def _client(repos: Repositories, enroller: FakeEnroller) -> AsyncIterator[AsyncClient]:
    """ASGI client with the voice router's repos + enroller overridden."""
    app.dependency_overrides[get_repos] = lambda: repos
    app.dependency_overrides[get_enroller] = lambda: enroller
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_repos, None)
        app.dependency_overrides.pop(get_enroller, None)


# --------------------------------------------------------------------------- #
# cosine_similarity
# --------------------------------------------------------------------------- #


def test_cosine_similarity_identical_vectors_is_one() -> None:
    assert cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors_is_zero() -> None:
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_similarity_opposite_vectors_is_negative_one() -> None:
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_cosine_similarity_scale_invariant() -> None:
    assert cosine_similarity([1.0, 2.0], [2.0, 4.0]) == pytest.approx(1.0)


def test_cosine_similarity_zero_vector_is_zero_not_nan() -> None:
    assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0
    assert cosine_similarity([1.0, 2.0], [0.0, 0.0]) == 0.0
    assert cosine_similarity([0.0, 0.0], [0.0, 0.0]) == 0.0


def test_cosine_similarity_matches_manual_computation() -> None:
    a, b = [1.0, 2.0, 3.0], [4.0, 5.0, 6.0]
    expected = sum(x * y for x, y in zip(a, b, strict=True)) / (
        math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    )
    assert cosine_similarity(a, b) == pytest.approx(expected)


# --------------------------------------------------------------------------- #
# match_voice_to_you
# --------------------------------------------------------------------------- #


async def test_match_voice_to_you_relabels_best_match_above_threshold(
    repos: Repositories,
) -> None:
    await repos.wearer_voice.upsert(WearerVoice(embedding=CANNED_EMBEDDING, enrolled_at=BASE))
    transcriber = _real_transcriber(
        voiceprints={"Speaker 1": CANNED_EMBEDDING, "Speaker 2": [0.0, 1.0, 0.0]}
    )
    transcript = _transcript()

    result = await match_voice_to_you(transcript, transcriber, repos, 0.45)

    labels = [s.speaker for s in result.segments]
    assert labels == ["you", "Speaker 2", "you"]
    # Untouched segments keep their text/timing.
    assert result.segments[0].text == "hi there"
    assert result.segments[1].speaker == "Speaker 2"


async def test_match_voice_to_you_no_op_below_threshold(repos: Repositories) -> None:
    await repos.wearer_voice.upsert(WearerVoice(embedding=CANNED_EMBEDDING, enrolled_at=BASE))
    # Orthogonal voiceprint -> similarity ~0.0, well under any sane threshold.
    transcriber = _real_transcriber(
        voiceprints={"Speaker 1": [0.0, 1.0, 0.0], "Speaker 2": [0.0, 0.0, 1.0]}
    )
    transcript = _transcript()

    result = await match_voice_to_you(transcript, transcriber, repos, 0.45)

    assert result is transcript
    assert [s.speaker for s in result.segments] == ["Speaker 1", "Speaker 2", "Speaker 1"]


async def test_match_voice_to_you_no_op_when_nothing_enrolled(repos: Repositories) -> None:
    transcriber = _real_transcriber(voiceprints={"Speaker 1": CANNED_EMBEDDING})
    transcript = _transcript()

    result = await match_voice_to_you(transcript, transcriber, repos, 0.45)

    assert result is transcript


async def test_match_voice_to_you_no_op_for_plain_stub_transcriber(repos: Repositories) -> None:
    await repos.wearer_voice.upsert(WearerVoice(embedding=CANNED_EMBEDDING, enrolled_at=BASE))
    transcript = _transcript()

    result = await match_voice_to_you(transcript, StubTranscriber(), repos, 0.45)

    assert result is transcript


async def test_match_voice_to_you_no_op_when_no_voiceprints_captured(repos: Repositories) -> None:
    """A RealTranscriber with no captured voiceprints (e.g. an older align.py) is a no-op."""
    await repos.wearer_voice.upsert(WearerVoice(embedding=CANNED_EMBEDDING, enrolled_at=BASE))
    transcriber = _real_transcriber(voiceprints={})
    transcript = _transcript()

    result = await match_voice_to_you(transcript, transcriber, repos, 0.45)

    assert result is transcript


async def test_match_voice_to_you_never_relabels_more_than_one_speaker(
    repos: Repositories,
) -> None:
    """Even with two close-scoring speakers, only the single best-matching RAW
    LABEL is ever relabeled (it may cover more than one segment, since "Speaker 1"
    appears twice in ``_transcript()`` — but "Speaker 2" must stay untouched)."""
    await repos.wearer_voice.upsert(WearerVoice(embedding=CANNED_EMBEDDING, enrolled_at=BASE))
    transcriber = _real_transcriber(
        voiceprints={"Speaker 1": CANNED_EMBEDDING, "Speaker 2": OTHER_EMBEDDING}
    )
    transcript = _transcript()

    result = await match_voice_to_you(transcript, transcriber, repos, 0.45)

    labels = [s.speaker for s in result.segments]
    # "Speaker 1" (the exact embedding match) is the one relabeled raw label —
    # both of its segments become "you" — while "Speaker 2" (a merely close
    # score) is left completely alone.
    assert labels == ["you", "Speaker 2", "you"]
    assert "Speaker 2" in labels


# --------------------------------------------------------------------------- #
# POST /voice/enroll
# --------------------------------------------------------------------------- #


async def test_post_voice_enroll_happy_path_persists(repos: Repositories) -> None:
    fake = FakeEnroller(CANNED_EMBEDDING)

    async with _client(repos, fake) as client:
        resp = await client.post(
            "/voice/enroll", files={"audio": ("sample.wav", b"fake wav bytes", "audio/wav")}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["enrolled"] is True
        assert "enrolled_at" in body

        status_resp = await client.get("/voice/status")

    assert status_resp.status_code == 200
    status_body = status_resp.json()
    assert status_body["enrolled"] is True
    assert _same_instant(status_body["enrolled_at"], body["enrolled_at"])

    stored = await repos.wearer_voice.get("you")
    assert stored is not None
    assert stored.embedding == CANNED_EMBEDDING
    assert fake.calls == [b"fake wav bytes"]


async def test_post_voice_enroll_empty_upload_400(repos: Repositories) -> None:
    fake = FakeEnroller(CANNED_EMBEDDING)

    async with _client(repos, fake) as client:
        resp = await client.post("/voice/enroll", files={"audio": ("sample.wav", b"", "audio/wav")})

    assert resp.status_code == 400
    assert fake.calls == []  # never even tried to enroll an empty sample


async def test_post_voice_enroll_enroller_error_returns_400_not_500(repos: Repositories) -> None:
    fake = FakeEnroller(error="sample too short (0.2s < 0.4s minimum)")

    async with _client(repos, fake) as client:
        resp = await client.post(
            "/voice/enroll", files={"audio": ("sample.wav", b"too short", "audio/wav")}
        )

    assert resp.status_code == 400
    assert "sample too short" in resp.json()["detail"]
    # Nothing was persisted on failure.
    assert await repos.wearer_voice.get("you") is None


async def test_post_voice_enroll_reenrolling_overwrites_single_doc(repos: Repositories) -> None:
    async with _client(repos, FakeEnroller(CANNED_EMBEDDING)) as client:
        first = await client.post(
            "/voice/enroll", files={"audio": ("a.wav", b"first sample", "audio/wav")}
        )
    assert first.status_code == 200

    second_embedding = [0.0, 1.0, 0.0]
    async with _client(repos, FakeEnroller(second_embedding)) as client:
        second = await client.post(
            "/voice/enroll", files={"audio": ("b.wav", b"second sample", "audio/wav")}
        )
        status_resp = await client.get("/voice/status")

    assert second.status_code == 200
    assert not _same_instant(second.json()["enrolled_at"], first.json()["enrolled_at"])
    assert _same_instant(status_resp.json()["enrolled_at"], second.json()["enrolled_at"])

    # Exactly one document — upsert, not a duplicate.
    assert await repos.wearer_voice.count() == 1
    stored = await repos.wearer_voice.get("you")
    assert stored is not None
    assert stored.embedding == second_embedding


# --------------------------------------------------------------------------- #
# GET /voice/status
# --------------------------------------------------------------------------- #


async def test_get_voice_status_not_enrolled(repos: Repositories) -> None:
    async with _client(repos, FakeEnroller(CANNED_EMBEDDING)) as client:
        resp = await client.get("/voice/status")

    assert resp.status_code == 200
    assert resp.json() == {"enrolled": False, "enrolled_at": None}


async def test_get_voice_status_enrolled(repos: Repositories) -> None:
    await repos.wearer_voice.upsert(WearerVoice(embedding=CANNED_EMBEDDING, enrolled_at=BASE))

    async with _client(repos, FakeEnroller(CANNED_EMBEDDING)) as client:
        resp = await client.get("/voice/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["enrolled"] is True
    assert body["enrolled_at"] is not None
