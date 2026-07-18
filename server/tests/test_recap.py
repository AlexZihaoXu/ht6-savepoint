"""Tests for the daily recap service and POST /day/{date}/recap (SAV-33).

Absolutely CI-safe: no real network / LLM call ever happens. Every test injects a
``FakeLLMClient`` that returns canned text, so we exercise prompt -> parse -> Recap
(including robust parsing of messy/fenced JSON and the unparseable fallback), the
empty-day canned recap (asserting the client is *not* called), the
generate-and-store round trip through the real test Mongo, and the endpoint with
both ``get_repos`` and ``get_llm_client`` overridden.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.recap import get_llm_client, get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Event, EventType, Recap
from savepoint_server.models.recap import RecapScope
from savepoint_server.services.recap import generate_and_store_day_recap, generate_recap

DAY = date(2026, 7, 18)
DAY_ID = DAY.isoformat()
BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)

# A well-formed reply the fake client returns by default: narrative + 3 highlights.
GOOD_JSON = (
    '{"narrative": "You spent the morning with Alex, trading stories over coffee.", '
    '"highlights": ["Coffee with Alex", "A sunny walk", "Plans for tomorrow"]}'
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


def _event(person_id: str, ts: datetime, text: str, **extra: object) -> Event:
    return Event(
        ts=ts,
        person_id=person_id,
        type=EventType.SPOKE,
        text=text,
        day_id=DAY_ID,
        **extra,  # type: ignore[arg-type]
    )


@asynccontextmanager
async def _client(repos: Repositories, llm: FakeLLMClient) -> AsyncIterator[AsyncClient]:
    """ASGI client with the recap router's repos + LLM client dependencies overridden."""
    app.dependency_overrides[get_repos] = lambda: repos
    app.dependency_overrides[get_llm_client] = lambda: llm
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_repos, None)
        app.dependency_overrides.pop(get_llm_client, None)


# --------------------------------------------------------------------------- #
# generate_recap: prompt -> parse -> Recap
# --------------------------------------------------------------------------- #


async def test_generate_recap_parses_narrative_and_highlights() -> None:
    fake = FakeLLMClient(GOOD_JSON)
    events = [
        _event("Alex", BASE, "morning!", emotion="happy", place="kitchen"),
        _event("Alex", BASE.replace(hour=10), "let's go for a walk"),
    ]

    recap = await generate_recap(events, DAY, client=fake)

    assert isinstance(recap, Recap)
    assert recap.date == DAY
    assert recap.scope is RecapScope.DAY
    assert recap.narrative == "You spent the morning with Alex, trading stories over coffee."
    assert 2 <= len(recap.highlights) <= 4
    assert recap.highlights[0] == "Coffee with Alex"

    # The client was called once, and the prompt actually carried the day's content.
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert isinstance(call["user"], str)
    assert "Alex" in call["user"]
    assert "let's go for a walk" in call["user"]
    assert DAY_ID in call["user"]
    # Mood/place get surfaced into the prompt too.
    assert "happy" in call["user"]
    assert "kitchen" in call["user"]
    # It asked with a bounded token budget.
    assert call["max_tokens"] == 512


# --------------------------------------------------------------------------- #
# Robust JSON parsing: markdown fences, surrounding prose, and the fallback
# --------------------------------------------------------------------------- #


async def test_generate_recap_parses_fenced_json() -> None:
    fenced = "```json\n" + GOOD_JSON + "\n```"
    recap = await generate_recap([_event("Alex", BASE, "hi")], DAY, client=FakeLLMClient(fenced))
    assert recap.narrative.startswith("You spent the morning with Alex")
    assert len(recap.highlights) == 3


async def test_generate_recap_parses_json_wrapped_in_prose() -> None:
    messy = (
        "Sure! Here is your cozy recap for the day:\n\n"
        + GOOD_JSON
        + "\n\nLet me know if you'd like a different tone."
    )
    recap = await generate_recap([_event("Alex", BASE, "hi")], DAY, client=FakeLLMClient(messy))
    assert recap.narrative == "You spent the morning with Alex, trading stories over coffee."
    assert len(recap.highlights) == 3


async def test_generate_recap_unparseable_falls_back_to_raw_text() -> None:
    junk = "the model rambled and never returned any json at all"
    recap = await generate_recap([_event("Alex", BASE, "hi")], DAY, client=FakeLLMClient(junk))
    # Whole reply becomes the narrative; highlights empty; no crash.
    assert recap.narrative == junk
    assert recap.highlights == []


# --------------------------------------------------------------------------- #
# Empty day: canned recap, LLM never called
# --------------------------------------------------------------------------- #


async def test_generate_recap_empty_day_is_canned_and_skips_llm() -> None:
    fake = FakeLLMClient(GOOD_JSON)
    recap = await generate_recap([], DAY, client=fake)

    assert recap.date == DAY
    assert recap.scope is RecapScope.DAY
    assert recap.narrative  # a gentle, non-empty canned line
    assert recap.highlights == []
    # The whole point: no model call on an empty day.
    assert fake.called is False


# --------------------------------------------------------------------------- #
# generate_and_store: round-trips through the repository
# --------------------------------------------------------------------------- #


async def test_generate_and_store_round_trips_via_repo(repos: Repositories) -> None:
    await repos.events.insert(_event("Alex", BASE, "good morning"))
    await repos.events.insert(_event("Alex", BASE.replace(hour=17), "goodnight"))

    stored = await generate_and_store_day_recap(DAY, repos, FakeLLMClient(GOOD_JSON))

    assert stored.narrative == "You spent the morning with Alex, trading stories over coffee."
    # Persisted under the deterministic (date, scope) key and reads back identically.
    from_db = await repos.recaps.get_by_date_scope(DAY, RecapScope.DAY)
    assert from_db is not None
    assert from_db.id == f"{DAY_ID}:day"
    assert from_db.narrative == stored.narrative
    assert from_db.highlights == stored.highlights


async def test_generate_and_store_empty_day_stores_canned(repos: Repositories) -> None:
    fake = FakeLLMClient(GOOD_JSON)
    stored = await generate_and_store_day_recap(DAY, repos, fake)

    assert fake.called is False
    from_db = await repos.recaps.get_by_date_scope(DAY, RecapScope.DAY)
    assert from_db is not None
    assert from_db.narrative == stored.narrative
    assert from_db.highlights == []


# --------------------------------------------------------------------------- #
# POST /day/{date}/recap
# --------------------------------------------------------------------------- #


async def test_post_day_recap_returns_200_and_persists(repos: Repositories) -> None:
    await repos.events.insert(_event("Alex", BASE, "good morning"))
    fake = FakeLLMClient(GOOD_JSON)

    async with _client(repos, fake) as client:
        resp = await client.post(f"/day/{DAY_ID}/recap")

    assert resp.status_code == 200
    body = resp.json()
    assert body["date"] == DAY_ID
    assert body["scope"] == "day"
    assert body["narrative"] == "You spent the morning with Alex, trading stories over coffee."
    assert 2 <= len(body["highlights"]) <= 4
    # A valid Recap payload round-trips through the model.
    assert Recap.model_validate(body).narrative == body["narrative"]

    # Actually written to Mongo under the day-scope key.
    from_db = await repos.recaps.get_by_date_scope(DAY, RecapScope.DAY)
    assert from_db is not None
    assert from_db.narrative == body["narrative"]
    assert fake.called is True


async def test_post_day_recap_empty_day_returns_canned(repos: Repositories) -> None:
    fake = FakeLLMClient(GOOD_JSON)
    async with _client(repos, fake) as client:
        resp = await client.post(f"/day/{DAY_ID}/recap")

    assert resp.status_code == 200
    assert resp.json()["highlights"] == []
    assert fake.called is False


async def test_post_day_recap_bad_date_400(repos: Repositories) -> None:
    async with _client(repos, FakeLLMClient(GOOD_JSON)) as client:
        resp = await client.post("/day/not-a-date/recap")
    assert resp.status_code == 400
