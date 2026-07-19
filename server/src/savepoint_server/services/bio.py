"""Character bio generation service (SAV-36, DESIGN §11).

Writes a short, cozy Stardew-Valley-toned character **bio** for a
:class:`Person` from the events they appear in. The LLM backend is injected as an
:class:`LLMClient` (see ``services/llm.py``) — the same pluggable interface the
daily recap uses — so this module is backend-agnostic and fully testable with a
fake client (no network in CI).

Flow: format the person's name + their events into a prompt → ask the model for a
1-2 sentence warm bio → return the trimmed text. A backend that is unreachable or
erroring (any ``httpx.HTTPError``) never propagates: it degrades to a gentle
canned bio so the endpoint can't 500 during a demo.
"""

from __future__ import annotations

import httpx

from savepoint_server.db.repositories import Repositories
from savepoint_server.models import Event, EventType, Person
from savepoint_server.services.llm import LLMClient

_SYSTEM_PROMPT = (
    "You are the cozy in-game character writer for SavePoint, a Stardew Valley-style "
    "life game where the people someone meets become pixel villagers. Given what you "
    "know about one villager, write a short, warm, whimsical character bio for them — "
    "1 to 2 sentences, game-first and endearing, the kind of blurb that would sit under "
    "their portrait in the town. Keep it kind and a little playful, never clinical or "
    "medical, and never mention data, recordings, or that this is an app. Respond with "
    "ONLY the bio text — no name label, no quotes, no preamble."
)

# Returned verbatim when the LLM backend is unreachable/erroring, so the endpoint
# still yields a valid bio instead of 500ing. Re-running regenerates once it's back.
_CANNED_BIO = "Someone you've crossed paths with — their story is still being written."


def _describe_person(person: Person) -> str:
    """A short who-are-they line for the prompt (name if known, else the id)."""
    return person.name or person.local_id


def _format_events(events: list[Event]) -> str:
    """Render the person's events as readable lines (what / mood / place / when)."""
    lines: list[str] = []
    for event in events:
        when = event.ts.strftime("%Y-%m-%d %H:%M")
        if event.type is EventType.SPOKE:
            head = f'[{when}] said: "{event.text or ""}"'
        else:
            head = f"[{when}] was seen"
        extras: list[str] = []
        if event.emotion:
            extras.append(f"mood: {event.emotion}")
        if event.place:
            extras.append(f"place: {event.place}")
        if extras:
            head = f"{head} ({', '.join(extras)})"
        lines.append(head)
    return "\n".join(lines)


def _build_user_prompt(person: Person, events: list[Event]) -> str:
    """Compose the user-turn prompt describing the person to write a bio for."""
    who = _describe_person(person)
    if events:
        body = (
            f"Here is what you know about {who} from your times together:\n\n"
            f"{_format_events(events)}"
        )
    else:
        body = f"You haven't recorded much about {who} yet — you've only just met."
    return f"{body}\n\nWrite {who}'s cozy character bio now."


async def generate_person_bio(
    person: Person,
    events: list[Event],
    *,
    client: LLMClient,
) -> str:
    """Generate a 1-2 sentence character bio for ``person`` from their ``events``.

    Asks the injected LLM with a small token budget and returns the trimmed reply.
    A backend that raises ``httpx.HTTPError`` (connect/timeout/bad status) or an
    empty reply degrades gracefully to a gentle canned bio — this function never
    raises for a flaky/unreachable model, so callers can't 500 on it.
    """
    try:
        raw = await client.complete(
            system=_SYSTEM_PROMPT,
            user=_build_user_prompt(person, events),
            max_tokens=120,
            temperature=0.7,
        )
    except httpx.HTTPError:
        return _CANNED_BIO
    bio = raw.strip().strip('"').strip()
    return bio or _CANNED_BIO


async def generate_and_store_person_bio(
    local_id: str,
    repos: Repositories,
    client: LLMClient,
) -> Person | None:
    """Load a person + their events, generate their bio, and persist it.

    Returns the updated :class:`Person`, or ``None`` if no person has ``local_id``
    (so the caller can 404). The person's other fields are untouched.
    """
    person = await repos.people.get_by_local_id(local_id)
    if person is None:
        return None
    events = await repos.events.list_for_person(local_id)
    person.bio = await generate_person_bio(person, events, client=client)
    return await repos.people.upsert(person)
