"""Tests for the character-bio service and POST /people/{local_id}/bio (SAV-36).

CI-safe: no real network / LLM call ever happens. Every test injects a
``FakeLLMClient`` (canned text) or an ``UnreachableLLMClient`` (raises httpx
errors), so we exercise prompt -> bio, the graceful canned fallback when the
backend is down or returns nothing, the load-generate-store round trip through the
real test Mongo, and the endpoint (200 + persisted, 404 for unknown, and a 200
canned bio — never a 500 — when the LLM is unreachable). A final check confirms
``GET /people/{id}`` surfaces the stored ``bio``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
from httpx import ASGITransport, AsyncClient

from savepoint_server.api.bio import get_llm_client, get_repos
from savepoint_server.api.read import get_repos as read_get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Event, EventType, Person
from savepoint_server.models.person import AvatarParams
from savepoint_server.services.bio import (
    _CANNED_BIO,
    generate_and_store_person_bio,
    generate_person_bio,
)

BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)
GOOD_BIO = "A sunny early riser who always has a story about the sea."


def _avatar() -> AvatarParams:
    return AvatarParams(
        skin_tone="fair", hair_color="brown", hair_style="short", shirt_color="blue"
    )


def _person(local_id: str, *, name: str | None = None) -> Person:
    return Person(
        local_id=local_id,
        name=name,
        avatar_params=_avatar(),
        first_seen=BASE,
        last_seen=BASE,
    )


def _event(person_id: str, ts: datetime, text: str, **extra: object) -> Event:
    return Event(
        ts=ts,
        person_id=person_id,
        type=EventType.SPOKE,
        text=text,
        day_id=ts.date().isoformat(),
        **extra,  # type: ignore[arg-type]
    )


class FakeLLMClient:
    """An :class:`LLMClient` that records its calls and returns a canned string."""

    def __init__(self, response: str) -> None:
        self._response = response
        self.calls: list[dict[str, object]] = []

    async def complete(self, system: str, user: str, max_tokens: int, temperature: float) -> str:
        self.calls.append(
            {
                "system": system,
                "user": user,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
        )
        return self._response

    @property
    def called(self) -> bool:
        return bool(self.calls)


class UnreachableLLMClient:
    """An :class:`LLMClient` modelling an unreachable backend by raising httpx errors."""

    def __init__(self, exc: httpx.HTTPError | None = None) -> None:
        self._exc = exc or httpx.ConnectError("connection refused")

    async def complete(self, system: str, user: str, max_tokens: int, temperature: float) -> str:
        raise self._exc


@asynccontextmanager
async def _client(
    repos: Repositories, llm: FakeLLMClient | UnreachableLLMClient
) -> AsyncIterator[AsyncClient]:
    """ASGI client with the bio router's repos + LLM deps (and read's repos) overridden."""
    app.dependency_overrides[get_repos] = lambda: repos
    app.dependency_overrides[read_get_repos] = lambda: repos
    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_repos, None)
        app.dependency_overrides.pop(read_get_repos, None)
        app.dependency_overrides.pop(get_llm_client, None)


# --------------------------------------------------------------------------- #
# generate_person_bio: prompt -> bio
# --------------------------------------------------------------------------- #


async def test_generate_person_bio_returns_text_and_builds_prompt() -> None:
    fake = FakeLLMClient(GOOD_BIO)
    person = _person("alex", name="Alex")
    events = [
        _event("alex", BASE, "morning by the docks!", emotion="happy", place="harbor"),
        _event("alex", BASE.replace(hour=17), "caught a big one today"),
    ]

    bio = await generate_person_bio(person, events, client=fake)

    assert bio == GOOD_BIO

    # The client was called once, and the prompt actually carried the person + events.
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert isinstance(call["user"], str)
    assert "Alex" in call["user"]
    assert "morning by the docks!" in call["user"]
    assert "caught a big one today" in call["user"]
    # Mood/place get surfaced into the prompt too.
    assert "happy" in call["user"]
    assert "harbor" in call["user"]
    # A tight token budget for a 1-2 sentence bio.
    assert call["max_tokens"] == 120


async def test_generate_person_bio_strips_wrapping_quotes() -> None:
    fake = FakeLLMClient(f'  "{GOOD_BIO}"  ')
    bio = await generate_person_bio(_person("alex", name="Alex"), [], client=fake)
    assert bio == GOOD_BIO


async def test_generate_person_bio_no_events_still_generates() -> None:
    fake = FakeLLMClient(GOOD_BIO)
    bio = await generate_person_bio(_person("stranger"), [], client=fake)
    assert bio == GOOD_BIO
    assert fake.called is True


# --------------------------------------------------------------------------- #
# Graceful fallback: backend unreachable or empty reply -> canned bio, no raise
# --------------------------------------------------------------------------- #


async def test_generate_person_bio_llm_unreachable_falls_back() -> None:
    bio = await generate_person_bio(
        _person("alex", name="Alex"),
        [_event("alex", BASE, "hi")],
        client=UnreachableLLMClient(),
    )
    assert bio == _CANNED_BIO


async def test_generate_person_bio_empty_reply_falls_back() -> None:
    bio = await generate_person_bio(_person("alex", name="Alex"), [], client=FakeLLMClient("   "))
    assert bio == _CANNED_BIO


# --------------------------------------------------------------------------- #
# generate_and_store_person_bio: load -> generate -> persist
# --------------------------------------------------------------------------- #


async def test_generate_and_store_round_trips_via_repo(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))
    await repos.events.insert(_event("alex", BASE, "good morning"))

    updated = await generate_and_store_person_bio("alex", repos, FakeLLMClient(GOOD_BIO))

    assert updated is not None
    assert updated.bio == GOOD_BIO
    # Persisted on the person doc and reads back identically.
    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.bio == GOOD_BIO
    # Other fields are untouched.
    assert from_db.name == "Alex"


async def test_generate_and_store_unknown_person_returns_none(repos: Repositories) -> None:
    fake = FakeLLMClient(GOOD_BIO)
    result = await generate_and_store_person_bio("ghost", repos, fake)
    assert result is None
    # No person -> the model is never consulted.
    assert fake.called is False


# --------------------------------------------------------------------------- #
# POST /people/{local_id}/bio
# --------------------------------------------------------------------------- #


async def test_post_person_bio_returns_200_and_persists(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))
    await repos.events.insert(_event("alex", BASE, "good morning"))
    fake = FakeLLMClient(GOOD_BIO)

    async with _client(repos, fake) as client:
        resp = await client.post("/people/alex/bio")

    assert resp.status_code == 200
    body = resp.json()
    assert body["local_id"] == "alex"
    assert body["bio"] == GOOD_BIO
    # A valid Person payload round-trips through the model.
    assert Person.model_validate(body).bio == GOOD_BIO

    # Actually written to Mongo.
    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.bio == GOOD_BIO
    assert fake.called is True


async def test_post_person_bio_unknown_person_404(repos: Repositories) -> None:
    async with _client(repos, FakeLLMClient(GOOD_BIO)) as client:
        resp = await client.post("/people/ghost/bio")
    assert resp.status_code == 404


async def test_post_person_bio_llm_unreachable_returns_200(repos: Repositories) -> None:
    """POST /people/{id}/bio degrades to a canned bio (200) when the LLM is down."""
    await repos.people.upsert(_person("alex", name="Alex"))
    await repos.events.insert(_event("alex", BASE, "good morning"))

    async with _client(repos, UnreachableLLMClient()) as client:
        resp = await client.post("/people/alex/bio")

    assert resp.status_code == 200
    body = resp.json()
    assert body["bio"] == _CANNED_BIO
    # The graceful bio was still persisted so the read API can serve it.
    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.bio == _CANNED_BIO


async def test_get_person_detail_includes_bio(repos: Repositories) -> None:
    """After generation, GET /people/{id} surfaces the stored bio (SAV-36 step 5)."""
    await repos.people.upsert(_person("alex", name="Alex"))
    fake = FakeLLMClient(GOOD_BIO)

    async with _client(repos, fake) as client:
        await client.post("/people/alex/bio")
        detail = await client.get("/people/alex")

    assert detail.status_code == 200
    assert detail.json()["bio"] == GOOD_BIO
