"""Ingest service: a frame + an audio clip -> Person + Events + Day (SAV-30).

This is the M1 milestone flow that ties the vision and speech services together
behind one call. Given a single camera frame and a recording of the moment:

1. **Vision** turns the frame into deterministic :class:`SpriteParams`
   (``services.vision.frame_to_sprite_params``), which are mapped onto a Person's
   :class:`AvatarParams` and **upserted** as a :class:`Person`. The person id is
   deterministic — the caller's ``person_key`` when given, otherwise derived from
   the sprite ``seed`` so the *same face always maps to the same document*.
2. **Speech** transcribes the audio into a diarized transcript and stores each
   segment as a SPOKE :class:`Event` under the day
   (``services.speech.transcribe_and_store``; the CI-safe stub by default).
3. The **Day** is upserted (keyed by ISO date) carrying a small
   :class:`DaySummary` of the day's people/event counts.

Everything is deterministic and torch-free on the default path, so the full
"frame + audio -> Mongo" chain is exercisable in dev and CI.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from pydantic import BaseModel, ConfigDict

from savepoint_server.db.repositories import Repositories
from savepoint_server.models import (
    Day,
    DaySummary,
    Event,
    Person,
    SpriteParams,
    compute_plant_stage,
)
from savepoint_server.models.person import AvatarParams
from savepoint_server.services.speech import AudioInput, Transcriber, transcribe_and_store
from savepoint_server.services.vision import frame_to_sprite_params

# --------------------------------------------------------------------------- #
# Sprite params -> human-readable avatar kit selectors
# --------------------------------------------------------------------------- #

# Label tables, one entry per bounded sprite index (sizes MUST match the sprite
# kit constants in models.sprite). The integer SpriteParams the vision service
# emits are the machine form; a Person stores these human-meaningful labels.
_SKIN_TONES = ("porcelain", "fair", "tan", "brown", "deep")  # SKIN_LEVELS = 5
_HAIR_COLORS = (
    "black",
    "dark-brown",
    "brown",
    "auburn",
    "blonde",
    "red",
    "gray",
    "white",
)  # HAIR_COLORS = 8
_HAIR_STYLES = ("buzz", "short", "medium", "long", "curly", "ponytail")  # HAIR_STYLES = 6
# accessory index (0..3) -> (glasses, hat)
_ACCESSORIES: tuple[tuple[bool, str | None], ...] = (
    (False, None),
    (True, None),
    (False, "cap"),
    (True, "beanie"),
)  # ACCESSORIES = 4
_SHIRT_COLORS = ("red", "orange", "yellow", "green", "teal", "blue", "indigo", "violet")


def avatar_from_sprite(sprite: SpriteParams) -> AvatarParams:
    """Map deterministic :class:`SpriteParams` onto a Person's :class:`AvatarParams`.

    A pure, total function: every bounded sprite index selects one kit label, and
    the shirt colour is derived from the stable ``seed``. Same sprite in -> same
    avatar out.
    """
    glasses, hat = _ACCESSORIES[sprite.accessory]
    return AvatarParams(
        skin_tone=_SKIN_TONES[sprite.skin],
        hair_color=_HAIR_COLORS[sprite.hair_color],
        hair_style=_HAIR_STYLES[sprite.hair_style],
        glasses=glasses,
        hat=hat,
        shirt_color=_SHIRT_COLORS[sprite.seed % len(_SHIRT_COLORS)],
    )


def derive_person_id(sprite: SpriteParams, person_key: str | None = None) -> str:
    """Return the deterministic Person ``local_id`` for a sprite.

    ``person_key`` (an explicit stable identity supplied by the caller) wins when
    present; otherwise the id is derived from the sprite ``seed`` so the same face
    always resolves to the same document.
    """
    if person_key:
        return person_key
    return f"face-{sprite.seed:016x}"


# --------------------------------------------------------------------------- #
# Ingest result + flow
# --------------------------------------------------------------------------- #


class IngestResult(BaseModel):
    """Outcome of one ingest: what was written to Mongo for this moment."""

    model_config = ConfigDict(extra="forbid")

    person: Person
    sprite: SpriteParams
    events: list[Event]
    day: Day


async def ingest_day(
    frame_bytes: bytes,
    audio: AudioInput,
    *,
    day_id: str | None = None,
    repos: Repositories,
    person_key: str | None = None,
    transcriber: Transcriber | None = None,
) -> IngestResult:
    """Ingest one frame + audio clip into Mongo, tying vision + speech + day.

    Runs the vision service on ``frame_bytes`` to derive sprite params and upsert
    a :class:`Person`, transcribes ``audio`` into SPOKE :class:`Event` documents
    under ``day_id`` (today when omitted), and upserts the :class:`Day` with a
    small :class:`DaySummary`. Returns everything that was stored.
    """
    resolved_day = day_id or datetime.now(UTC).date().isoformat()
    day_date = date.fromisoformat(resolved_day)
    now = datetime.now(UTC)

    # 1. Vision: frame -> deterministic sprite params -> upsert Person.
    sprite = frame_to_sprite_params(frame_bytes)
    local_id = derive_person_id(sprite, person_key)
    avatar = avatar_from_sprite(sprite)

    existing = await repos.people.get_by_local_id(local_id)
    if existing is not None:
        # Re-seen person: refresh the sprite + last_seen, keep name/tags/first_seen.
        person_doc = existing.model_copy(update={"avatar_params": avatar, "last_seen": now})
    else:
        person_doc = Person(
            local_id=local_id,
            avatar_params=avatar,
            first_seen=now,
            last_seen=now,
        )
    person = await repos.people.upsert(person_doc)

    # 2. Speech: audio -> diarized transcript -> SPOKE events under the day.
    events = await transcribe_and_store(
        audio, day_id=resolved_day, repos=repos, transcriber=transcriber
    )

    # 3. Day: upsert (by date) with a small tally of the day's people/events and the
    #    garden-plant growth stage derived from that activity.
    day_events = await repos.events.list_for_day(resolved_day)
    people_ids = {e.person_id for e in day_events} | {person.local_id}
    summary = DaySummary(people=len(people_ids), events=len(day_events))
    plant_stage = compute_plant_stage(events=summary.events, people=summary.people)

    existing_day = await repos.days.get_by_date(day_date)
    if existing_day is not None:
        day_doc = existing_day.model_copy(update={"summary": summary, "plant_stage": plant_stage})
    else:
        day_doc = Day(date=day_date, summary=summary, plant_stage=plant_stage)
    day = await repos.days.upsert(day_doc)

    return IngestResult(person=person, sprite=sprite, events=events, day=day)
