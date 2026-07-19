"""Tests for the optional, non-blocking transcript refinement (SAV-56/58).

Absolutely CI-safe: no real network / Gemini / Gemma call ever happens. Every test
injects fake engines (or a fake ``LLMClient`` behind :class:`GemmaRefiner`), so we
exercise the whole flow — factory dispatch, the ``refine_segments`` engine CHAIN and
its guard rails, the Gemini REST client's request/parse shape (via
``httpx.MockTransport``), the Gemma engine wrapping ``LLMClient.complete``, and the
audio-ingest path with refinement OFF, ON, falling back, and failing entirely.

The overriding property under test is jiucheng's #1 requirement: refinement can
**never block or 500 ingest** — when Gemini 429s the chain falls back to Gemma, and
when *every* engine fails it falls back to the RAW transcript and the request still
returns 200.
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
    _REFINE_SYSTEM,
    GeminiRefiner,
    GemmaRefiner,
    get_transcript_refiner,
    refine_segments,
)

DAY = "2026-07-18"
BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)

# A real (non-placeholder) Gemma host, so _gemma_configured() sees a usable endpoint.
REAL_GEMMA_URL = "https://gemma.example/v1"


# --------------------------------------------------------------------------- #
# Fakes: refine engines + a fake LLMClient behind the Gemma engine
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
    """Models an unreachable / timing-out / 429ing engine by raising from generate()."""

    def __init__(self, exc: Exception | None = None) -> None:
        self._exc = exc or httpx.ConnectError("connection refused")
        self.prompts: list[str] = []

    async def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        raise self._exc

    @property
    def called(self) -> bool:
        return bool(self.prompts)


class _FakeLLM:
    """A fake ``services.llm.LLMClient`` used to back :class:`GemmaRefiner`.

    Returns canned chat-completion content or raises (an unreachable Gemma box),
    recording every ``complete()`` call so we can assert the refine prompt is wired
    through as the user message.
    """

    def __init__(self, *, response: str | None = None, exc: Exception | None = None) -> None:
        self._response = response
        self._exc = exc
        self.calls: list[dict[str, Any]] = []

    async def complete(self, system: str, user: str, max_tokens: int, temperature: float) -> str:
        self.calls.append(
            {"system": system, "user": user, "max_tokens": max_tokens, "temperature": temperature}
        )
        if self._exc is not None:
            raise self._exc
        assert self._response is not None
        return self._response

    @property
    def called(self) -> bool:
        return bool(self.calls)


def _gemma_engine(
    *, cleaned: list[str] | None = None, exc: Exception | None = None
) -> GemmaRefiner:
    """A real :class:`GemmaRefiner` backed by a fake LLM (cleans, or raises)."""
    response = _cleaned_reply(cleaned) if cleaned is not None else None
    return GemmaRefiner(_FakeLLM(response=response, exc=exc))


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
    """A well-formed LLM reply: a JSON array of cleaned turns."""
    labels = speakers or ["Speaker 1", "Speaker 2"]
    return json.dumps([{"index": i, "speaker": labels[i], "text": t} for i, t in enumerate(texts)])


# --------------------------------------------------------------------------- #
# get_transcript_refiner factory dispatch (builds the ordered engine chain)
# --------------------------------------------------------------------------- #


def test_factory_off_by_default_returns_none() -> None:
    """Default settings (transcript_refine='none') build NO engine — ingest stays raw."""
    assert get_transcript_refiner(Settings()) is None


def test_factory_gemini_no_key_no_gemma_returns_none() -> None:
    """gemini mode with no key and only the placeholder gemma host -> refinement off."""
    assert get_transcript_refiner(Settings(transcript_refine="gemini")) is None


def test_factory_gemini_with_key_only_builds_gemini_chain() -> None:
    """gemini + key, no real gemma host -> a one-engine [Gemini] chain."""
    settings = Settings(
        transcript_refine="gemini", gemini_api_key="k", gemini_model="gemini-2.0-flash"
    )
    chain = get_transcript_refiner(settings)
    assert chain is not None and len(chain) == 1
    gemini = chain[0]
    assert isinstance(gemini, GeminiRefiner)
    assert gemini._api_key == "k"
    assert gemini._model == "gemini-2.0-flash"


def test_factory_gemini_with_key_and_gemma_builds_ordered_chain() -> None:
    """gemini + key + a real gemma host -> [Gemini, Gemma] in that order (Gemma is fallback)."""
    settings = Settings(
        transcript_refine="gemini", gemini_api_key="k", gemma_base_url=REAL_GEMMA_URL
    )
    chain = get_transcript_refiner(settings)
    assert chain is not None and len(chain) == 2
    assert isinstance(chain[0], GeminiRefiner)
    assert isinstance(chain[1], GemmaRefiner)


def test_factory_gemini_without_key_but_gemma_builds_gemma_only() -> None:
    """gemini mode, no Gemini key, but a real gemma host -> [Gemma] (fallback still usable)."""
    settings = Settings(transcript_refine="gemini", gemma_base_url=REAL_GEMMA_URL)
    chain = get_transcript_refiner(settings)
    assert chain is not None and len(chain) == 1
    assert isinstance(chain[0], GemmaRefiner)


def test_factory_gemma_mode_builds_gemma_only() -> None:
    """gemma mode + a real gemma host -> a one-engine [Gemma] chain, no Gemini key needed."""
    settings = Settings(transcript_refine="gemma", gemma_base_url=REAL_GEMMA_URL)
    chain = get_transcript_refiner(settings)
    assert chain is not None and len(chain) == 1
    assert isinstance(chain[0], GemmaRefiner)


def test_factory_gemma_mode_without_real_host_returns_none() -> None:
    """gemma mode but the base_url is still the nonfunctional placeholder -> off."""
    assert get_transcript_refiner(Settings(transcript_refine="gemma")) is None


# --------------------------------------------------------------------------- #
# refine_segments: happy path + every guard rail (pure, no Mongo)
# --------------------------------------------------------------------------- #


async def test_refine_cleans_text_and_preserves_structure() -> None:
    segs = _segments()
    reply = _cleaned_reply(["Hello, world.", "How's it going?"])
    out = await refine_segments(segs, engines=[_CannedRefiner(reply)])

    assert [s.text for s in out] == ["Hello, world.", "How's it going?"]
    # Speaker labels, count, and timing are untouched — TEXT ONLY.
    assert [s.speaker for s in out] == [s.speaker for s in segs]
    assert [s.start for s in out] == [s.start for s in segs]
    assert [s.end for s in out] == [s.end for s in segs]


async def test_refine_empty_input_skips_engines() -> None:
    spy = _CannedRefiner(_cleaned_reply([]))
    out = await refine_segments([], engines=[spy])
    assert out == []
    assert spy.called is False  # no point calling an LLM on an empty batch


async def test_refine_empty_chain_returns_input() -> None:
    segs = _segments()
    out = await refine_segments(segs, engines=[])
    assert out is segs  # no engines configured -> raw, unchanged


async def test_refine_engine_raises_returns_input() -> None:
    segs = _segments()
    out = await refine_segments(segs, engines=[_RaisingRefiner()])
    assert out is segs  # unchanged, no exception


async def test_refine_wrong_turn_count_returns_input() -> None:
    segs = _segments()
    reply = _cleaned_reply(["only one turn"])  # 1 != 2
    out = await refine_segments(segs, engines=[_CannedRefiner(reply)])
    assert out is segs


async def test_refine_changed_speaker_returns_input() -> None:
    segs = _segments()
    reply = _cleaned_reply(["Hi.", "Yo."], speakers=["Speaker 9", "Speaker 2"])
    out = await refine_segments(segs, engines=[_CannedRefiner(reply)])
    assert out is segs


async def test_refine_empty_cleaned_text_returns_input() -> None:
    segs = _segments()
    reply = _cleaned_reply(["Hello, world.", "   "])  # blank cleaned turn -> distrust reply
    out = await refine_segments(segs, engines=[_CannedRefiner(reply)])
    assert out is segs


async def test_refine_unparseable_reply_returns_input() -> None:
    segs = _segments()
    out = await refine_segments(segs, engines=[_CannedRefiner("not json at all")])
    assert out is segs


async def test_refine_tolerates_fenced_json() -> None:
    segs = _segments()
    reply = "```json\n" + _cleaned_reply(["Hello.", "Hi."]) + "\n```"
    out = await refine_segments(segs, engines=[_CannedRefiner(reply)])
    assert [s.text for s in out] == ["Hello.", "Hi."]


# --------------------------------------------------------------------------- #
# refine_segments: the ENGINE CHAIN — fallback, advance-on-invalid, all-fail
# --------------------------------------------------------------------------- #


async def test_refine_gemini_429_falls_back_to_gemma() -> None:
    """THE FALLBACK: a raising (429) Gemini hands off to Gemma, whose clean text wins."""
    segs = _segments()
    gemini = _RaisingRefiner(RuntimeError("429 Too Many Requests"))
    gemma_llm = _FakeLLM(response=_cleaned_reply(["Hello, world.", "How's it going?"]))
    gemma = GemmaRefiner(gemma_llm)

    out = await refine_segments(segs, engines=[gemini, gemma])

    assert [s.text for s in out] == ["Hello, world.", "How's it going?"]
    assert gemini.called is True  # Gemini was tried first
    assert gemma_llm.called is True  # then Gemma actually did the work


async def test_refine_first_engine_invalid_advances_to_second() -> None:
    """A structurally mismatched engine 1 is skipped; engine 2's valid cleanup is used."""
    segs = _segments()
    bad = _CannedRefiner(_cleaned_reply(["only one turn"]))  # wrong turn count -> invalid
    good = _CannedRefiner(_cleaned_reply(["Hello.", "Hi."]))

    out = await refine_segments(segs, engines=[bad, good])

    assert bad.called is True
    assert good.called is True
    assert [s.text for s in out] == ["Hello.", "Hi."]


async def test_refine_first_engine_wins_second_not_called() -> None:
    """First valid engine short-circuits the chain — the fallback is never invoked."""
    segs = _segments()
    first = _CannedRefiner(_cleaned_reply(["Hello.", "Hi."]))
    second = _CannedRefiner(_cleaned_reply(["nope.", "nope."]))

    out = await refine_segments(segs, engines=[first, second])

    assert [s.text for s in out] == ["Hello.", "Hi."]
    assert first.called is True
    assert second.called is False


async def test_refine_all_engines_fail_returns_input() -> None:
    """Every engine failing (Gemini 429 + Gemma down) -> the RAW input, unchanged, no raise."""
    segs = _segments()
    out = await refine_segments(
        segs, engines=[_RaisingRefiner(), _gemma_engine(exc=httpx.ConnectError("down"))]
    )
    assert out is segs


# --------------------------------------------------------------------------- #
# GemmaRefiner: wraps LLMClient.complete with the refine prompt (no network)
# --------------------------------------------------------------------------- #


async def test_gemma_engine_cleans_text_and_wraps_complete() -> None:
    segs = _segments()
    llm = _FakeLLM(response=_cleaned_reply(["Hello, world.", "How's it going?"]))
    out = await refine_segments(segs, engines=[GemmaRefiner(llm)])

    assert [s.text for s in out] == ["Hello, world.", "How's it going?"]
    # structure preserved
    assert [s.speaker for s in out] == [s.speaker for s in segs]
    assert [s.start for s in out] == [s.start for s in segs]
    # and the refine prompt was wired through as the user message with a JSON-only system.
    assert llm.calls[0]["system"] == _REFINE_SYSTEM
    assert "Input turns:" in llm.calls[0]["user"]
    assert llm.calls[0]["temperature"] == 0.2
    assert llm.calls[0]["max_tokens"] > 0


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
# ingest_audio_segments: OFF / ON / fallback / all-fail / malformed (real Mongo)
# --------------------------------------------------------------------------- #


async def test_ingest_refine_off_stores_raw(repos: Repositories) -> None:
    """No engines (the default) -> RAW text stored, byte-identical to plain ingest."""
    await ingest_audio_segments(AudioIngestRequest(segments=_segments()), repos=repos)

    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["helo wrld", "hows it going"]
    # And the default factory builds no engine, so no LLM call is even possible.
    assert get_transcript_refiner(Settings()) is None


async def test_ingest_refine_on_stores_cleaned_text(repos: Repositories) -> None:
    spy = _CannedRefiner(_cleaned_reply(["Hello, world.", "How's it going?"]))
    await ingest_audio_segments(
        AudioIngestRequest(segments=_segments()), repos=repos, refine_engines=[spy]
    )

    events = await repos.events.list_for_day(DAY)
    assert spy.called is True
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]
    # Speaker labels, count, and timestamps are unchanged.
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
    assert [e.ts for e in events] == [BASE, BASE + timedelta(seconds=4)]


async def test_ingest_gemma_mode_stores_cleaned_text(repos: Repositories) -> None:
    """gemma mode: the Gemma engine cleans text; speakers/turns/timing preserved."""
    gemma = _gemma_engine(cleaned=["Hello, world.", "How's it going?"])
    await ingest_audio_segments(
        AudioIngestRequest(segments=_segments()), repos=repos, refine_engines=[gemma]
    )

    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
    assert [e.ts for e in events] == [BASE, BASE + timedelta(seconds=4)]


async def test_ingest_gemini_falls_back_to_gemma_stores_cleaned(repos: Repositories) -> None:
    """gemini 429 -> Gemma fallback used -> cleaned text lands (the fallback, end to end)."""
    engines = [_RaisingRefiner(), _gemma_engine(cleaned=["Hello, world.", "How's it going?"])]
    await ingest_audio_segments(
        AudioIngestRequest(segments=_segments()), repos=repos, refine_engines=engines
    )

    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]


async def test_ingest_all_engines_raise_stores_raw(repos: Repositories) -> None:
    """Both Gemini and Gemma down -> raw stored, ingest still succeeds, no exception."""
    engines = [_RaisingRefiner(), _gemma_engine(exc=httpx.ConnectError("down"))]
    result = await ingest_audio_segments(
        AudioIngestRequest(segments=_segments()), repos=repos, refine_engines=engines
    )

    assert len(result.events) == 2
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["helo wrld", "hows it going"]


async def test_ingest_refine_malformed_stores_raw(repos: Repositories) -> None:
    """A structurally mismatched reply (wrong turn count) falls back to the raw text."""
    spy = _CannedRefiner(_cleaned_reply(["only one turn"]))  # 1 != 2 turns
    await ingest_audio_segments(
        AudioIngestRequest(segments=_segments()), repos=repos, refine_engines=[spy]
    )

    events = await repos.events.list_for_day(DAY)
    assert spy.called is True
    assert [e.text for e in events] == ["helo wrld", "hows it going"]


# --------------------------------------------------------------------------- #
# Endpoint-level: POST /ingest/audio returns 200 through the chain (real Mongo)
# --------------------------------------------------------------------------- #


@asynccontextmanager
async def _client(repos: Repositories, engines: Any) -> AsyncIterator[AsyncClient]:
    """ASGI client with ingest repos + the transcript-refine chain dependency overridden."""
    app.dependency_overrides[ingest_api.get_repos] = lambda: repos
    app.dependency_overrides[ingest_api.get_transcript_refiner_dep] = lambda: engines
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


async def test_endpoint_all_engines_raise_returns_200_with_raw(repos: Repositories) -> None:
    """The never-blocks proof: a WHOLE failing chain still yields HTTP 200 + raw transcript."""
    engines = [_RaisingRefiner(), _gemma_engine(exc=httpx.ConnectError("down"))]
    async with _client(repos, engines) as client:
        resp = await client.post("/ingest/audio", json=_payload())

    assert resp.status_code == 200
    assert len(resp.json()["events"]) == 2
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["helo wrld", "hows it going"]


async def test_endpoint_gemini_falls_back_to_gemma_200(repos: Repositories) -> None:
    """Endpoint-level fallback: Gemini 429 -> Gemma cleans -> HTTP 200 with cleaned text."""
    engines = [_RaisingRefiner(), _gemma_engine(cleaned=["Hello, world.", "How's it going?"])]
    async with _client(repos, engines) as client:
        resp = await client.post("/ingest/audio", json=_payload())

    assert resp.status_code == 200
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]


async def test_endpoint_refine_cleans_text_200(repos: Repositories) -> None:
    refiner = _CannedRefiner(_cleaned_reply(["Hello, world.", "How's it going?"]))
    async with _client(repos, [refiner]) as client:
        resp = await client.post("/ingest/audio", json=_payload())

    assert resp.status_code == 200
    events = await repos.events.list_for_day(DAY)
    assert [e.text for e in events] == ["Hello, world.", "How's it going?"]
    assert [e.person_id for e in events] == ["Speaker 1", "Speaker 2"]
