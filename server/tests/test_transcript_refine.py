"""Tests for the optional, non-blocking Gemini transcript refinement (SAV-56).

Absolutely CI-safe: no real network / Gemini call ever happens. Every test injects
a fake :class:`TranscriptRefineClient` (or asserts the real one is never built), so
we exercise the whole flow — factory dispatch, the ``refine_segments`` guard rails,
the Gemini REST client's request/parse shape (via ``httpx.MockTransport``), and the
audio-ingest path with refinement OFF, ON, raising, and returning malformed output.

The overriding property under test is jiucheng's #1 requirement: refinement can
**never block or 500 ingest** — any failure falls back to the RAW transcript and the
request still returns 200.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from httpx import ASGITransport, AsyncClient

from savepoint_server.api import ingest as ingest_api
from savepoint_server.core.config import Settings
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.services.ingest import (
    AudioIngestRequest,
    AudioSegment,
    ingest_audio_segments,
)
from savepoint_server.services.transcript_refine import (
    GeminiRefiner,
    get_transcript_refiner,
    refine_segments,
)

DAY = "2026-07-18"
BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)


# --------------------------------------------------------------------------- #
# Fakes: a refine client that returns canned text / raises / records its calls
# --------------------------------------------------------------------------- #


class _CannedRefiner:
    """A :class:`TranscriptRefineClient` returning a fixed raw string; records calls."""

    def __init__(self, response: str) -> None:
        self._response = response
        self.prompts: list[str] = []

    async def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self._response

    @property
    def called(self) -> bool:
        return bool(self.prompts)


class _RaisingRefiner:
    """Models an unreachable / timing-out / 429ing Gemini by raising from generate()."""

    def __init__(self, exc: Exception | None = None) -> None:
        self._exc = exc or httpx.ConnectError("connection refused")
        self.prompts: list[str] = []

    async def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        raise self._exc

    @property
    def called(self) -> bool:
        return bool(self.prompts)


def _segments() -> list[AudioSegment]:
    """Two raw diarized turns with ascending start times (request == store order)."""
    return [
        AudioSegment(
            speaker="Speaker 1",
            start=BASE.isoformat(),
            end=(BASE + timedelta(seconds=3)).isoformat(),
            text="helo wrld",
        ),
        AudioSegment(
            speaker="Speaker 2",
            start=(BASE + timedelta(seconds=4)).isoformat(),
            end=(BASE + timedelta(seconds=6)).isoformat(),
            text="hows it going",
        ),
    ]


def _cleaned_reply(texts: list[str], *, speakers: list[str] | None = None) -> str:
    """A well-formed Gemini reply: a JSON array of cleaned turns."""
    labels = speakers or ["Speaker 1", "Speaker 2"]
    return json.dumps([{"index": i, "speaker": labels[i], "text": t} for i, t in enumerate(texts)])


# --------------------------------------------------------------------------- #
# get_transcript_refiner factory dispatch
# --------------------------------------------------------------------------- #


def test_factory_off_by_default_returns_none() -> None:
    """Default settings (transcript_refine='none') build NO refiner — ingest stays raw."""
    assert get_transcript_refiner(Settings()) is None


def test_factory_gemini_without_key_returns_none() -> None:
    """Selecting gemini but leaving the key unset still disables refinement (safe default)."""
    assert get_transcript_refiner(Settings(transcript_refine="gemini")) is None


def test_factory_gemini_with_key_builds_gemini_refiner() -> None:
    settings = Settings(
        transcript_refine="gemini", gemini_api_key="k", gemini_model="gemini-2.0-flash"
    )
    refiner = get_transcript_refiner(settings)
    assert isinstance(refiner, GeminiRefiner)
    assert refiner._api_key == "k"
    assert refiner._model == "gemini-2.0-flash"


# --------------------------------------------------------------------------- #
# refine_segments: happy path + every guard rail (pure, no Mongo)
# --------------------------------------------------------------------------- #


async def test_refine_cleans_text_and_preserves_structure() -> None:
    segs = _segments()
    reply = _cleaned_reply(["Hello, world.", "How's it going?"])
    out = await refine_segments(segs, client=_CannedRefiner(reply))

    assert [s.text for s in out] == ["Hello, world.", "How's it going?"]
    # Speaker labels, count, and timing are untouched — TEXT ONLY.
    assert [s.speaker for s in out] == [s.speaker for s in segs]
    assert [s.start for s in out] == [s.start for s in segs]
    assert [s.end for s in out] == [s.end for s in segs]


async def test_refine_empty_input_skips_client() -> None:
    spy = _CannedRefiner(_cleaned_reply([]))
    out = await refine_segments([], client=spy)
    assert out == []
    assert spy.called is False  # no point calling Gemini on an empty batch


async def test_refine_client_raises_returns_input() -> None:
    segs = _segments()
    out = await refine_segments(segs, client=_RaisingRefiner())
    assert out is segs  # unchanged, no exception


async def test_refine_wrong_turn_count_returns_input() -> None:
    segs = _segments()
    reply = _cleaned_reply(["only one turn"])  # 1 != 2
    out = await refine_segments(segs, client=_CannedRefiner(reply))
    assert out is segs


async def test_refine_changed_speaker_returns_input() -> None:
    segs = _segments()
    reply = _cleaned_reply(["Hi.", "Yo."], speakers=["Speaker 9", "Speaker 2"])
    out = await refine_segments(segs, client=_CannedRefiner(reply))
    assert out is segs


async def test_refine_empty_cleaned_text_returns_input() -> None:
    segs = _segments()
    reply = _cleaned_reply(["Hello, world.", "   "])  # blank cleaned turn -> distrust reply
    out = await refine_segments(segs, client=_CannedRefiner(reply))
    assert out is segs


async def test_refine_unparseable_reply_returns_input() -> None:
    segs = _segments()
    out = await refine_segments(segs, client=_CannedRefiner("not json at all"))
    assert out is segs


async def test_refine_tolerates_fenced_json() -> None:
    segs = _segments()
    reply = "```json\n" + _cleaned_reply(["Hello.", "Hi."]) + "\n```"
    out = await refine_segments(segs, client=_CannedRefiner(reply))
    assert [s.text for s in out] == ["Hello.", "Hi."]


# --------------------------------------------------------------------------- #
# GeminiRefiner REST shape: request + parse, via httpx.MockTransport (no network)
# --------------------------------------------------------------------------- #


async def test_gemini_refiner_posts_generatecontent_and_parses(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["api_key"] = request.headers.get("x-goog-api-key")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": "cleaned!"}]}}]}
        )

    transport = httpx.MockTransport(handler)

    class _PatchedClient(httpx.AsyncClient):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            kwargs.pop("timeout", None)
            super().__init__(transport=transport)

    monkeypatch.setattr(httpx, "AsyncClient", _PatchedClient)

    out = await GeminiRefiner(api_key="secret-key", model="gemini-2.0-flash").generate("clean this")

    assert out == "cleaned!"
    assert captured["url"].endswith("/models/gemini-2.0-flash:generateContent")
    assert captured["api_key"] == "secret-key"
    assert captured["body"]["contents"][0]["parts"][0]["text"] == "clean this"


# --------------------------------------------------------------------------- #
# ingest_audio_segments: refinement OFF / ON / raising / malformed (real Mongo)
# --------------------------------------------------------------------------- #


async def test_ingest_refine_off_stores_raw(repos: Repositories) -> None:
    """No refiner (the default) -> RAW text stored, byte-identical to plain ingest."""
    await ingest_audio_segments(AudioIngestRequest(segments=_segments()), repos=repos)

    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["helo wrld", "hows it going"]
    # And the default factory builds no client, so no Gemini call is even possible.
    assert get_transcript_refiner(Settings()) is None


async def test_ingest_refine_on_stores_cleaned_text(repos: Repositories) -> None:
    spy = _CannedRefiner(_cleaned_reply(["Hello, world.", "How's it going?"]))
    await ingest_audio_segments(AudioIngestRequest(segments=_segments()), repos=repos, refiner=spy)

    events = await repos.events.list_for_day(DAY)
    assert spy.called is True
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]
    # Speaker labels, count, and timestamps are unchanged.
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
    assert [e.ts for e in events] == [BASE, BASE + timedelta(seconds=4)]


async def test_ingest_refine_client_raises_stores_raw(repos: Repositories) -> None:
    """A raising refiner (httpx error / 429 / timeout) never breaks ingest — raw stored."""
    refiner = _RaisingRefiner()
    result = await ingest_audio_segments(
        AudioIngestRequest(segments=_segments()), repos=repos, refiner=refiner
    )

    assert refiner.called is True
    assert len(result.events) == 2
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["helo wrld", "hows it going"]


async def test_ingest_refine_malformed_stores_raw(repos: Repositories) -> None:
    """A structurally mismatched reply (wrong turn count) falls back to the raw text."""
    spy = _CannedRefiner(_cleaned_reply(["only one turn"]))  # 1 != 2 turns
    await ingest_audio_segments(AudioIngestRequest(segments=_segments()), repos=repos, refiner=spy)

    events = await repos.events.list_for_day(DAY)
    assert spy.called is True
    assert [e.text for e in events] == ["helo wrld", "hows it going"]


# --------------------------------------------------------------------------- #
# Endpoint-level: POST /ingest/audio returns 200 even when the refiner raises
# --------------------------------------------------------------------------- #


@asynccontextmanager
async def _client(repos: Repositories, refiner: Any) -> AsyncIterator[AsyncClient]:
    """ASGI client with ingest repos + the transcript refiner dependency overridden."""
    app.dependency_overrides[ingest_api.get_repos] = lambda: repos
    app.dependency_overrides[ingest_api.get_transcript_refiner_dep] = lambda: refiner
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(ingest_api.get_repos, None)
        app.dependency_overrides.pop(ingest_api.get_transcript_refiner_dep, None)


def _payload() -> dict[str, Any]:
    return {
        "segments": [
            {"speaker": s.speaker, "start": s.start, "end": s.end, "text": s.text}
            for s in _segments()
        ]
    }


async def test_endpoint_refine_raises_returns_200_with_raw(repos: Repositories) -> None:
    """The never-blocks proof: a raising refiner still yields HTTP 200 + raw transcript."""
    async with _client(repos, _RaisingRefiner()) as client:
        resp = await client.post("/ingest/audio", json=_payload())

    assert resp.status_code == 200
    assert len(resp.json()["events"]) == 2
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["helo wrld", "hows it going"]


async def test_endpoint_refine_cleans_text_200(repos: Repositories) -> None:
    refiner = _CannedRefiner(_cleaned_reply(["Hello, world.", "How's it going?"]))
    async with _client(repos, refiner) as client:
        resp = await client.post("/ingest/audio", json=_payload())

    assert resp.status_code == 200
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
