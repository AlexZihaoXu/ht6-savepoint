"""Ingest services: land camera + microphone signal as Person + Events + Day.

Three write flows share the same deterministic core (sprite params -> Person, day
tally + garden-plant stage):

* :func:`ingest_day` — the M1 **combined** flow (SAV-30). One frame + one audio
  clip -> vision + speech -> Person + SPOKE events + Day behind a single call.
* :func:`ingest_video_detections` / :func:`ingest_audio_segments` — the
  **decoupled two-stream JSON** flow (SAV-40). The Pi posts a list of edge
  :class:`EdgeEvent` detections (``local_id`` + ``avatar_params`` + face embedding
  + ``ts_unix_ms``) and the app posts diarized audio segments — **no raw media
  ever crosses the wire** (privacy). Both carry **absolute, NTP-synced
  timestamps**, so the server lands them on one shared day timeline; alignment is
  implicit-by-timestamp and the day view + tap-to-name
  (:func:`assign_speaker_for_day`) tie the streams together.
* :func:`assign_speaker_for_day` — **tap-to-name** (SAV-39). After a day, a
  diarized ``Speaker N`` label is bound to a real Person, re-pointing that day's
  SPOKE events so the day view resolves them to the right character.

Everything is deterministic and torch-free on the default path, so the full
"signal -> Mongo" chain is exercisable in dev and CI.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import UTC, date, datetime

from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.core.config import get_settings
from savepoint_server.db.repositories import Repositories
from savepoint_server.models import (
    Day,
    DaySummary,
    Event,
    EventType,
    Person,
    SpriteParams,
    compute_plant_stage,
)
from savepoint_server.models.person import AvatarParams
from savepoint_server.services.speech import AudioInput, Transcriber, transcribe_and_store
from savepoint_server.services.transcript_refine import TranscriptRefineClient, refine_segments
from savepoint_server.services.vision import frame_to_sprite_params

# A synchronous "a brand-new Person was just created" callback the ingest paths
# invoke exactly once per newly-met person (never for a re-seen one). It must
# return immediately — the PixelLab wiring (services/pixellab.build_sprite_hook)
# uses it to schedule a fire-and-forget sprite job. ``None`` (the default) makes
# ingest behave exactly as before: this module knows nothing about PixelLab.
NewPersonHook = Callable[[Person], None]

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
# Shared write helpers (Person upsert + Day rollup)
# --------------------------------------------------------------------------- #


async def _upsert_person(
    sprite: SpriteParams,
    repos: Repositories,
    *,
    person_key: str | None,
    seen_at: datetime,
    sprite_hook: NewPersonHook | None = None,
) -> Person:
    """Upsert the deterministic Person for ``sprite`` (same face -> same document).

    A re-seen person keeps their name/tags/first_seen/avatar and only refreshes
    ``last_seen``; a newly met face is created with ``first_seen == last_seen
    == seen_at``. The avatar is deliberately NOT recomputed on a re-seen touch
    even though ``avatar_from_sprite`` is pure/deterministic for a given
    ``sprite`` — ``sprite`` itself comes from a fresh per-frame vision read
    that isn't perfectly stable frame to frame, so blindly overwriting would
    let a recurring character's look drift/reset on every re-sighting instead
    of staying the one fixed appearance the person was first met with. When a
    NEW person is created and ``sprite_hook`` is supplied, it is fired once
    (fire-and-forget sprite generation).
    """
    local_id = derive_person_id(sprite, person_key)
    avatar = avatar_from_sprite(sprite)

    existing = await repos.people.get_by_local_id(local_id)
    if existing is not None:
        return await repos.people.upsert(
            existing.model_copy(
                update={
                    "first_seen": existing.first_seen or seen_at,
                    "last_seen": seen_at,
                }
            )
        )
    created = await repos.people.upsert(
        Person(local_id=local_id, avatar_params=avatar, first_seen=seen_at, last_seen=seen_at)
    )
    if sprite_hook is not None:
        sprite_hook(created)
    return created


async def refresh_day(
    day_id: str,
    repos: Repositories,
    *,
    extra_person_ids: set[str] | None = None,
) -> Day:
    """(Re)compute a day's :class:`DaySummary` + garden-plant stage and upsert it.

    Re-aggregates the day's stored events into a small tally (distinct people +
    event count) and the derived plant growth stage, preserving any existing
    journal fields on the day tile. ``extra_person_ids`` folds in people who have
    no event of their own this day (e.g. a SEEN-only person in the combined ingest).
    """
    day_date = date.fromisoformat(day_id)
    day_events = await repos.events.list_for_day(day_id)
    people_ids = {e.person_id for e in day_events}
    if extra_person_ids:
        people_ids |= extra_person_ids
    summary = DaySummary(people=len(people_ids), events=len(day_events))
    plant_stage = compute_plant_stage(events=summary.events, people=summary.people)

    existing_day = await repos.days.get_by_date(day_date)
    if existing_day is not None:
        day_doc = existing_day.model_copy(update={"summary": summary, "plant_stage": plant_stage})
    else:
        day_doc = Day(date=day_date, summary=summary, plant_stage=plant_stage)
    return await repos.days.upsert(day_doc)


# --------------------------------------------------------------------------- #
# Combined ingest (M1): one frame + one audio clip
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
    sprite_hook: NewPersonHook | None = None,
) -> IngestResult:
    """Ingest one frame + audio clip into Mongo, tying vision + speech + day.

    Runs the vision service on ``frame_bytes`` to derive sprite params and upsert
    a :class:`Person`, transcribes ``audio`` into SPOKE :class:`Event` documents
    under ``day_id`` (today when omitted), and upserts the :class:`Day` with a
    small :class:`DaySummary`. Returns everything that was stored. ``sprite_hook``
    (default ``None``) fires only when a brand-new Person is created.
    """
    resolved_day = day_id or datetime.now(UTC).date().isoformat()
    now = datetime.now(UTC)

    # 1. Vision: frame -> deterministic sprite params -> upsert Person.
    sprite = frame_to_sprite_params(frame_bytes)
    person = await _upsert_person(
        sprite, repos, person_key=person_key, seen_at=now, sprite_hook=sprite_hook
    )

    # 2. Speech: audio -> diarized transcript -> SPOKE events under the day.
    events = await transcribe_and_store(
        audio, day_id=resolved_day, repos=repos, transcriber=transcriber
    )

    # 3. Day: upsert (by date) with a tally of the day's people/events. The SEEN
    #    person has no event of their own here, so fold them in explicitly.
    day = await refresh_day(resolved_day, repos, extra_person_ids={person.local_id})

    return IngestResult(person=person, sprite=sprite, events=events, day=day)


# --------------------------------------------------------------------------- #
# Decoupled two-stream JSON ingest (SAV-40)
# --------------------------------------------------------------------------- #


class IngestValidationError(ValueError):
    """Raised on a malformed absolute timestamp in a decoupled-ingest payload.

    A dedicated type so the router can translate it into a clean ``400`` (mirroring
    how the combined ``/ingest`` route maps a bad frame to ``400``) instead of
    letting it surface as a ``500``.
    """


def _parse_iso_datetime(value: str, *, field: str) -> datetime:
    """Parse an absolute ISO-8601 timestamp, raising :class:`IngestValidationError`."""
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise IngestValidationError(
            f"Invalid {field} '{value}'; expected an absolute ISO-8601 datetime."
        ) from exc


def _datetime_from_unix_ms(ts_unix_ms: int) -> datetime:
    """Convert absolute unix epoch milliseconds to a UTC datetime.

    Raises :class:`IngestValidationError` when the value is out of the range a
    datetime can represent, so a bad ``ts_unix_ms`` surfaces as a clean 400.
    """
    try:
        return datetime.fromtimestamp(ts_unix_ms / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise IngestValidationError(
            f"Invalid ts_unix_ms '{ts_unix_ms}'; expected unix epoch milliseconds."
        ) from exc


class EdgeEvent(BaseModel):
    """One derived detection shipped by the Pi edge (``edge/types.py::EdgeEvent``).

    The Pi has already reduced a face to sprite-kit ``avatar_params`` + a stable
    ``local_id`` on-device; **no image bytes ever cross the wire**. ``avatar_params``
    field names match the server's :class:`AvatarParams`, so it round-trips as-is.
    Extra fields are ignored so an edge-side ``schema_version`` bump that adds a
    field never 400s the whole batch.
    """

    model_config = ConfigDict(extra="ignore")

    ts_unix_ms: int = Field(description="Absolute unix epoch milliseconds the face was seen.")
    local_id: str = Field(description="Stable per-face id assigned on the edge.")
    type: str = Field(default="seen", description="Edge only ever emits 'seen'.")
    avatar_params: AvatarParams = Field(description="On-device parametric sprite-kit selectors.")
    face_embedding: list[float] | None = Field(
        default=None, description="512-d face-attribute embedding (present for 'seen')."
    )
    place: str | None = Field(default=None, description="Optional place label for the moment.")
    schema_version: str = Field(
        default="savepoint.edge.v1", description="Edge wire-format schema version."
    )


class VideoIngestResult(BaseModel):
    """What the video stream wrote: the distinct people, SEEN events, and days touched."""

    model_config = ConfigDict(extra="forbid")

    people: list[Person] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    days: list[Day] = Field(default_factory=list)


class AudioSegment(BaseModel):
    """One diarized transcript segment from the app's microphone stream.

    No audio bytes cross the wire — the app (or the speech pipeline) has already
    diarized + transcribed; the server only stores the derived text.
    """

    model_config = ConfigDict(extra="forbid")

    speaker: str = Field(description="Raw diarization label, e.g. 'Speaker 1'.")
    start: str = Field(description="Absolute ISO-8601 start timestamp (NTP-synced).")
    end: str = Field(description="Absolute ISO-8601 end timestamp (NTP-synced).")
    text: str = Field(description="What was said in this turn.")


class AudioIngestRequest(BaseModel):
    """Body for ``POST /ingest/audio`` — the app's diarized-transcript stream."""

    model_config = ConfigDict(extra="forbid")

    segments: list[AudioSegment] = Field(
        default_factory=list, description="Diarized transcript segments to land on the timeline."
    )


class AudioIngestResult(BaseModel):
    """What the audio stream wrote: the SPOKE events and days touched."""

    model_config = ConfigDict(extra="forbid")

    events: list[Event] = Field(default_factory=list)
    days: list[Day] = Field(default_factory=list)


# Same embedding space as edge/identity_gallery.py's own matching (w600k_mbf
# ArcFace, 512-d, L2-normalized) — see that module's citation for why 0.30.
# Overridable per-call via Settings.person_match_similarity_threshold (routed
# through the API layer); this is only the fallback for direct callers (tests,
# the combined-ingest path) that don't thread one through.
_DEFAULT_PERSON_MATCH_THRESHOLD = 0.30

# How many recent face-embedding samples a Person keeps (services/models/person.py's
# face_embeddings). Each SEEN event with a face is a one-shot edge-side event (fired
# once per confirmed track, not per frame — see edge/main.py), so this caps slowly
# over real usage, not per-frame; a handful of samples is enough to span a day's
# lighting/pose variation without the gallery growing unbounded.
_MAX_FACE_GALLERY = 8


def _append_face_embedding(
    gallery: list[list[float]], embedding: list[float], *, cap: int = _MAX_FACE_GALLERY
) -> list[list[float]]:
    """Append a fresh sample to a Person's face-embedding gallery, newest last,
    keeping only the most recent ``cap`` samples."""
    return [*gallery, embedding][-cap:]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = sum(a[i] * b[i] for i in range(n))
    norm_a = math.sqrt(sum(v * v for v in a[:n]))
    norm_b = math.sqrt(sum(v * v for v in b[:n]))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


async def _find_matching_person(
    embedding: list[float], repos: Repositories, *, threshold: float
) -> Person | None:
    """Nearest-embedding match against every known Person (DESIGN §9).

    Brute-force cosine similarity over the whole collection is fine at this
    project's scale (a session's worth of distinct people, not a production
    corpus) — no vector index exists or is needed yet. Each candidate is
    matched against the *best* of their stored gallery samples (not just the
    latest one), since a person's stored embeddings span several past
    lighting/pose conditions. Returns the highest-scoring candidate at or
    above ``threshold``, or ``None``.
    """
    best: Person | None = None
    best_score = threshold
    for candidate in await repos.people.list(limit=500):
        if not candidate.face_embeddings:
            continue
        score = max(_cosine_similarity(embedding, sample) for sample in candidate.face_embeddings)
        if score >= best_score:
            best = candidate
            best_score = score
    return best


async def _upsert_seen_person(
    local_id: str,
    avatar: AvatarParams,
    repos: Repositories,
    *,
    face_embedding: list[float] | None,
    seen_at: datetime,
    sprite_hook: NewPersonHook | None = None,
    match_threshold: float = _DEFAULT_PERSON_MATCH_THRESHOLD,
) -> Person:
    """Upsert the Person for an edge detection, keyed by ``local_id`` — falling
    back to a nearest-embedding match against already-known people when this
    exact ``local_id`` hasn't been seen before (DESIGN §9).

    That fallback matters because edge/identity_gallery.py's session-scoped,
    in-memory IdentityGallery mints a genuinely fresh ``local_id`` whenever a
    track expires and reforms (e.g. a brief occlusion or a missed detection
    tick) — even for someone who never actually left. Without matching on the
    face itself, every such re-mint would otherwise create a duplicate Person.

    A re-seen person (by either route) keeps their name/tags/first_seen AND
    avatar, refreshing only ``last_seen``. The avatar is deliberately never
    overwritten here: ``avatar`` is derived edge-side from
    ``compute_avatar_params(embedding)``, a hash of the raw per-sighting
    embedding (edge/sprite_params.py) — since embeddings are noisy frame to
    frame (the exact reason edge/identity_gallery.py exists at all), that
    hash routinely differs between sightings of the same real person, so
    overwriting on every touch reshuffled skin tone/hair/glasses/shirt on
    every re-sighting instead of keeping one stable recurring character. A
    genuinely new face is created with ``first_seen == last_seen == seen_at``
    (using THIS sighting's avatar, since there's no prior one to keep). A
    present ``face_embedding`` is appended to the person's gallery (see
    ``_append_face_embedding``) rather than overwriting it — a single
    overwritten sample drifts to whatever lighting/pose was last seen and
    makes future matches unreliable; an absent one leaves the gallery
    untouched. When a NEW person is created and ``sprite_hook`` is supplied,
    it fires once (fire-and-forget).
    """
    existing = await repos.people.get_by_local_id(local_id)
    if existing is None and face_embedding is not None:
        existing = await _find_matching_person(face_embedding, repos, threshold=match_threshold)
    if existing is not None:
        update: dict[str, object] = {
            "first_seen": existing.first_seen or seen_at,
            "last_seen": seen_at,
        }
        if face_embedding is not None:
            update["face_embeddings"] = _append_face_embedding(
                existing.face_embeddings, face_embedding
            )
        return await repos.people.upsert(existing.model_copy(update=update))
    created = await repos.people.upsert(
        Person(
            local_id=local_id,
            avatar_params=avatar,
            face_embeddings=[face_embedding] if face_embedding is not None else [],
            first_seen=seen_at,
            last_seen=seen_at,
        )
    )
    if sprite_hook is not None:
        sprite_hook(created)
    return created


async def ingest_video_detections(
    edge_events: list[EdgeEvent],
    *,
    repos: Repositories,
    sprite_hook: NewPersonHook | None = None,
    match_threshold: float = _DEFAULT_PERSON_MATCH_THRESHOLD,
) -> VideoIngestResult:
    """Land the Pi's edge detections: upsert People + record SEEN events by ts.

    Each :class:`EdgeEvent` carries an absolute ``ts_unix_ms``, a stable ``local_id``,
    the on-device ``avatar_params``, and (for a face) a ``face_embedding``. An
    unrecognized ``local_id`` with an embedding is matched against known people by
    nearest embedding before minting a new Person (DESIGN §9) — see
    :func:`_upsert_seen_person` for why that fallback exists at all. Timestamps are
    converted up front, so a bad ``ts_unix_ms`` fails the whole batch with a clean
    400 before anything is written; detections are processed in timestamp order so
    ``last_seen`` stays chronological, and each day the batch touches is re-rolled up.
    ``sprite_hook`` (default ``None``) fires once per brand-new Person.
    """
    parsed = sorted(
        ((_datetime_from_unix_ms(e.ts_unix_ms), e) for e in edge_events),
        key=lambda item: item[0],
    )

    people: dict[str, Person] = {}
    events: list[Event] = []
    day_ids: set[str] = set()
    for ts, edge in parsed:
        day_id = ts.date().isoformat()
        day_ids.add(day_id)
        person = await _upsert_seen_person(
            edge.local_id,
            edge.avatar_params,
            repos,
            face_embedding=edge.face_embedding,
            seen_at=ts,
            sprite_hook=sprite_hook,
            match_threshold=match_threshold,
        )
        people[person.local_id] = person
        events.append(
            await repos.events.insert(
                Event(
                    ts=ts,
                    person_id=person.local_id,
                    type=EventType.SEEN,
                    place=edge.place,
                    day_id=day_id,
                )
            )
        )

    days = [await refresh_day(day_id, repos) for day_id in sorted(day_ids)]
    return VideoIngestResult(people=list(people.values()), events=events, days=days)


async def ingest_audio_segments(
    request: AudioIngestRequest,
    *,
    repos: Repositories,
    refine_engines: list[TranscriptRefineClient] | None = None,
) -> AudioIngestResult:
    """Land the app's audio-derived JSON: record diarized SPOKE events by ts.

    ``person_id`` stays the raw ``Speaker N`` label — binding a label to a real
    Person happens later via :func:`assign_speaker_for_day` (tap-to-name). Every
    timestamp is parsed up front (bad ``start``/``end`` -> 400, whole-batch), events
    are stored in start-time order, and each touched day is re-rolled up.

    When ``refine_engines`` is supplied (SAV-56/58, opt-in via
    ``transcript_refine="gemini"``/``"gemma"``), the turns' **text** is first run
    through an OPTIONAL LLM cleanup chain (Gemini, then a quota-free Gemma fallback)
    before events are created — speaker labels, turn count, order, and timing are left
    untouched. That pass is best-effort and can NEVER block or 500 ingest: it is
    guarded here (belt-and-suspenders on top of :func:`refine_segments`, which itself
    tries each engine and never raises), so any failure across all engines just falls
    back to the raw transcript. With no ``refine_engines`` (the default), behavior is
    byte-identical to plain ingest — no LLM call is made.
    """
    segments = request.segments
    if refine_engines:
        try:
            segments = await refine_segments(segments, engines=refine_engines)
        except Exception:
            # refine_segments never raises, but guard the call site too so a transcript
            # refiner can never propagate an error onto the ingest HTTP response.
            segments = request.segments
    parsed = sorted(
        (
            (
                s.speaker,
                _parse_iso_datetime(s.start, field="start"),
                _parse_iso_datetime(s.end, field="end"),
                s.text,
            )
            for s in segments
        ),
        key=lambda item: item[1],
    )

    events: list[Event] = []
    day_ids: set[str] = set()
    for speaker, start, _end, text in parsed:
        day_id = start.date().isoformat()
        day_ids.add(day_id)
        events.append(
            await repos.events.insert(
                Event(
                    ts=start,
                    person_id=speaker,
                    type=EventType.SPOKE,
                    text=text,
                    day_id=day_id,
                )
            )
        )

    # Timeline alignment (DESIGN §4): try to auto-bind whatever raw labels
    # are left to whoever the camera was looking at, per day, before the
    # final rollup — matched labels are patched into the in-memory `events`
    # below so the response reflects the real Person, not the now-stale
    # label it was inserted under a moment ago.
    window_s = get_settings().speaker_seen_match_window_s
    for day_id in sorted(day_ids):
        matched = await auto_match_speakers_to_seen_people(day_id, repos, window_s=window_s)
        if matched:
            for event in events:
                if event.day_id == day_id and event.person_id in matched:
                    event.person_id = matched[event.person_id]

    days = [await refresh_day(day_id, repos) for day_id in sorted(day_ids)]
    return AudioIngestResult(events=events, days=days)


# --------------------------------------------------------------------------- #
# Tap-to-name: bind a diarized speaker label to a real Person (SAV-39)
# --------------------------------------------------------------------------- #


async def assign_speaker_for_day(
    day_id: str,
    *,
    speaker_label: str,
    person_local_id: str,
    repos: Repositories,
) -> int:
    """Re-point a day's ``speaker_label`` SPOKE events onto a real Person.

    The tap-to-name mechanic: after a day, the user assigns a diarized ``Speaker N``
    label to a real Person and it sticks. Every SPOKE event that day whose
    ``person_id`` still equals ``speaker_label`` is rewritten to ``person_local_id``,
    after which the read API's day-view join resolves them to the real character.

    Idempotent — a second call finds no more raw-label events and rewrites nothing.
    Only re-rolls up the day when something actually changed. The caller is
    responsible for verifying the target Person exists (a 404 concern).
    """
    reassigned = await repos.events.reassign_speaker_for_day(
        day_id, from_label=speaker_label, to_person_id=person_local_id
    )
    if reassigned:
        await refresh_day(day_id, repos)
    return reassigned


# --------------------------------------------------------------------------- #
# Timeline alignment: auto-bind a speaker label from who the camera was
# looking at (DESIGN §4 — "the app/cloud tier does the timeline alignment
# (Pi frames <-> app audio by ts)... bind utterance -> character")
# --------------------------------------------------------------------------- #


def _nearest_seen_person(seen: list[Event], ts: datetime, window_s: float) -> str | None:
    """The SEEN event's person_id closest in time to `ts`, if within window_s seconds."""
    best: tuple[float, str] | None = None
    for e in seen:
        delta = abs((e.ts - ts).total_seconds())
        if delta > window_s:
            continue
        if best is None or delta < best[0]:
            best = (delta, e.person_id)
    return best[1] if best else None


async def auto_match_speakers_to_seen_people(
    day_id: str, repos: Repositories, *, window_s: float
) -> dict[str, str]:
    """Auto-bind remaining raw "Speaker N" labels to whoever the camera was
    looking at when they were talking — the audio/video timeline alignment
    DESIGN §4 describes, running automatically instead of waiting on manual
    tap-to-name.

    For every SPOKE label that day with no real Person doc yet (skips "you",
    already handled by voice matching, and anything already a real Person),
    each of that label's utterances votes for whichever real person has a
    SEEN event within `window_s` seconds (nearest one wins the vote; an
    utterance with nobody nearby simply doesn't vote). The label is bound
    only when every vote agrees on exactly one candidate — any utterance
    pointing at a second, different person makes it ambiguous and the label
    is left alone for manual tap-to-name instead of guessing wrong.

    Reuses assign_speaker_for_day for the actual rewrite (same idempotency +
    day-rollup guarantees tap-to-name already has). Returns {label:
    matched_person_id} for every label actually bound, so a caller holding
    its own in-memory copy of the just-inserted events (stamped with the raw
    labels, now stale) can patch them instead of re-querying.

    Known gap (not fixed here — see services/voice.py's match_voice_to_you):
    the wearer's own voice is never itself a SEEN event (nobody's behind
    their own camera), so if voice-matching fails to positively label their
    speech "you" (e.g. a near-miss on the similarity threshold), this pass
    has no way to distinguish "genuinely a bystander" from "actually the
    wearer, coincidentally near one" — both produce identical event data. A
    day with only one distinct SEEN person is the shape of BOTH the
    legitimate single-visitor case (already covered by
    test_auto_match_binds_the_only_person_seen_nearby) and the wearer
    misattribution failure mode, so it can't be gated on without breaking
    the former to guard the latter. A real fix needs voice-match's
    similarity score threaded in as a veto signal, not a purely
    event-data-based heuristic here.
    """
    events = await repos.events.list_for_day(day_id)
    seen = [e for e in events if e.type is EventType.SEEN]
    spoke = [e for e in events if e.type is EventType.SPOKE]

    labels = {e.person_id for e in spoke} - {"you"}
    bound: dict[str, str] = {}
    for label in sorted(labels):
        if await repos.people.get_by_local_id(label) is not None:
            continue  # already a real Person — nothing to resolve
        candidates: set[str] = set()
        for event in spoke:
            if event.person_id != label:
                continue
            match = _nearest_seen_person(seen, event.ts, window_s)
            if match is not None:
                candidates.add(match)
            if len(candidates) > 1:
                break  # already ambiguous, no need to keep scanning
        if len(candidates) != 1:
            continue
        (matched_person_id,) = candidates
        if await assign_speaker_for_day(
            day_id, speaker_label=label, person_local_id=matched_person_id, repos=repos
        ):
            bound[label] = matched_person_id
    return bound
