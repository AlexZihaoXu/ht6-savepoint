"""Speech transcript models (SAV-32).

A :class:`Transcript` is the ordered result of the speech pipeline: a list of
:class:`TranscriptSegment` items, each a diarized turn ``Speaker N: text`` with
its time span. These are *not* stored as documents themselves — a later step
maps each segment onto an :class:`~savepoint_server.models.event.Event` — so they
are plain Pydantic models rather than :class:`MongoModel` subclasses.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class TranscriptSegment(BaseModel):
    """One diarized turn: a single speaker's line and when it was said."""

    # Raw diarization label, e.g. "Speaker 1". Mapping a label to a real person
    # is a later ticket, so this stays as the pipeline emits it.
    speaker: str
    text: str
    # Offsets in seconds from the start of the recording.
    start: float
    end: float
    # True when the pipeline flagged this turn as overlapping speech.
    overlap: bool = False


class Transcript(BaseModel):
    """An ordered transcript: diarized segments in reading (start-time) order."""

    segments: list[TranscriptSegment] = Field(default_factory=list)
