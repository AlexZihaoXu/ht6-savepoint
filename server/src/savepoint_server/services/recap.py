"""Daily recap generation service (SAV-33, DESIGN §11).

Turns a day's :class:`Event` log into a warm, Stardew-Valley-toned narrative
:class:`Recap`. The LLM backend is injected as an :class:`LLMClient` (see
``services/llm.py``), so this module is backend-agnostic and fully testable with a
fake client — no network in CI.

Flow: format the day's events into a prompt → ask the model for a small JSON
object (``narrative`` + 2-4 ``highlights``) → parse it robustly (tolerating prose
or markdown fences, never crashing) → return a :class:`Recap`. An empty day skips
the model entirely and returns a gentle canned recap.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from savepoint_server.db.repositories import Repositories
from savepoint_server.models import Event, EventType, Recap, RecapScope
from savepoint_server.services.llm import LLMClient

_SYSTEM_PROMPT = (
    "You are the cozy in-game journal narrator for SavePoint, a Stardew Valley-style "
    "life game where the people someone meets become pixel villagers and each day "
    "grows a plant in their garden. Looking back over the player's day, write a warm, "
    "gentle, second-person diary entry — nostalgic and kind, a little whimsical, never "
    "clinical or medical. Respond with ONLY a JSON object, no prose around it, with "
    'exactly two keys: "narrative" (2-4 warm sentences of prose) and "highlights" (a '
    "JSON array of 2 to 4 short bullet strings, each a small memorable moment from the "
    "day). Do not wrap the JSON in markdown fences."
)

_EMPTY_NARRATIVE = (
    "A quiet day in the valley. No new faces crossed your path today, but the garden "
    "kept growing all the same — patient and green. Rest up; tomorrow is a fresh page."
)


def _format_events(events: list[Event]) -> str:
    """Render the day's events as readable lines for the prompt (who / what / mood)."""
    lines: list[str] = []
    for event in events:
        when = event.ts.strftime("%H:%M")
        if event.type is EventType.SPOKE:
            head = f'[{when}] {event.person_id} said: "{event.text or ""}"'
        else:
            head = f"[{when}] You saw {event.person_id}"
        extras: list[str] = []
        if event.emotion:
            extras.append(f"mood: {event.emotion}")
        if event.place:
            extras.append(f"place: {event.place}")
        if extras:
            head = f"{head} ({', '.join(extras)})"
        lines.append(head)
    return "\n".join(lines)


def _build_user_prompt(events: list[Event], day_date: date) -> str:
    """Compose the user-turn prompt describing the day to summarize."""
    return (
        f"Here is everything that happened on {day_date.isoformat()}:\n\n"
        f"{_format_events(events)}\n\n"
        "Write the cozy journal entry for this day as JSON now."
    )


def _strip_code_fences(text: str) -> str:
    """Drop a leading ```/```json fence and its closing ``` if the text is fenced."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    """Best-effort pull of a JSON object out of ``raw`` (fences / surrounding prose).

    Tries, in order: a direct parse, a fence-stripped parse, and the substring
    between the first ``{`` and last ``}``. Returns the first object that parses, or
    ``None`` if none do.
    """
    text = raw.strip()
    candidates = [text, _strip_code_fences(text)]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _parse_recap_fields(raw: str) -> tuple[str, list[str]]:
    """Parse ``narrative`` + ``highlights`` from an LLM reply, never raising.

    Falls back to using the whole reply text as the narrative (with no highlights)
    when the reply has no usable JSON object or no ``narrative`` string.
    """
    obj = _extract_json_object(raw)
    if isinstance(obj, dict) and isinstance(obj.get("narrative"), str):
        narrative = obj["narrative"].strip()
        highlights_val = obj.get("highlights")
        highlights: list[str] = []
        if isinstance(highlights_val, list):
            highlights = [str(h).strip() for h in highlights_val if str(h).strip()]
        if narrative:
            return narrative, highlights
    return raw.strip(), []


def _canned_recap(day_date: date, scope: RecapScope) -> Recap:
    """A gentle, LLM-free recap for a day with no events."""
    return Recap(date=day_date, scope=scope, narrative=_EMPTY_NARRATIVE, highlights=[])


async def generate_recap(
    events: list[Event],
    day_date: date,
    scope: RecapScope = RecapScope.DAY,
    *,
    client: LLMClient,
) -> Recap:
    """Generate a narrative :class:`Recap` for ``day_date`` from its ``events``.

    An empty day short-circuits to a canned recap without ever calling the model.
    Otherwise the day is formatted into a prompt, the model is asked for a small
    JSON object, and the reply is parsed robustly (prose/fences tolerated; an
    unparseable reply becomes the narrative verbatim with no highlights).
    """
    if not events:
        return _canned_recap(day_date, scope)

    raw = await client.complete(
        system=_SYSTEM_PROMPT,
        user=_build_user_prompt(events, day_date),
        max_tokens=512,
        temperature=0.7,
    )
    narrative, highlights = _parse_recap_fields(raw)
    return Recap(date=day_date, scope=scope, narrative=narrative, highlights=highlights)


async def generate_and_store_day_recap(
    day_date: date,
    repos: Repositories,
    client: LLMClient,
) -> Recap:
    """Load a day's events, generate its DAY recap, and upsert it (one per day)."""
    events = await repos.events.list_for_day(day_date.isoformat())
    recap = await generate_recap(events, day_date, RecapScope.DAY, client=client)
    return await repos.recaps.upsert(recap)
