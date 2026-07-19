"""Speech router: upload audio -> diarized transcript -> Events in Mongo (SAV-32).

With the default :class:`~savepoint_server.services.speech.StubTranscriber` this
runs end to end in dev and CI without torch. Selecting the real pipeline is a
config switch (``SAVEPOINT_TRANSCRIBER=real``); the endpoint code is identical.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Transcript
from savepoint_server.services.speech import (
    Transcriber,
    get_transcriber,
    transcribe_and_store,
    transcript_from_events,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/speech", tags=["speech"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def get_speech_transcriber() -> Transcriber:
    """Provide the configured transcriber (overridable in tests via dependency_overrides)."""
    return get_transcriber()


def _parse_iso_date(value: str) -> date:
    """Parse an ``YYYY-MM-DD`` ``day_id``, 400ing on anything malformed."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid day_id '{value}'; expected ISO YYYY-MM-DD."
        ) from exc


class TranscribeResponse(BaseModel):
    """Result of transcribing an upload: the transcript plus stored event ids."""

    day_id: str
    transcript: Transcript
    event_ids: list[str] = Field(default_factory=list)


AudioUpload = Annotated[UploadFile, File(description="Audio recording to transcribe.")]


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: AudioUpload,
    repos: Annotated[Repositories, Depends(get_repos)],
    day_id: Annotated[str | None, Form(description="ISO day bucket; defaults to today.")] = None,
) -> TranscribeResponse:
    """Transcribe an uploaded recording and persist each segment as an Event."""
    resolved_day = day_id or datetime.now(UTC).date().isoformat()
    _parse_iso_date(resolved_day)  # validate so a bad day_id is a 400, not a 500
    audio = await file.read()
    events = await transcribe_and_store(audio, day_id=resolved_day, repos=repos)
    return TranscribeResponse(
        day_id=resolved_day,
        transcript=transcript_from_events(events),
        event_ids=[e.id for e in events if e.id is not None],
    )


class PreviewSegment(BaseModel):
    """One diarized turn in a store-free preview response."""

    speaker: str
    start: float
    end: float
    text: str


class PreviewResponse(BaseModel):
    """Diarized segments for a preview transcription — never written to the DB."""

    segments: list[PreviewSegment] = Field(default_factory=list)


@router.post("/preview", response_model=PreviewResponse)
async def preview(
    audio: Annotated[UploadFile, File(description="Audio recording to transcribe (preview only).")],
    transcriber: Annotated[Transcriber, Depends(get_speech_transcriber)],
) -> PreviewResponse:
    """Transcribe an uploaded recording to diarized segments **without storing anything**.

    This backs the record screen's realtime-preview poll: the frontend can call it
    repeatedly on the same (or a growing) clip and just render the segments. Unlike
    ``/speech/transcribe`` and ``/ingest/audio/clip`` it never touches Mongo.

    Robustness: an empty upload is a clean 400, but any transcription/decoding
    failure is swallowed — logged and returned as ``{"segments": []}`` with 200 —
    so a flaky recording can never surface as a 500 to the recorder UI.
    """
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio upload.")
    try:
        transcript = transcriber.transcribe(data)
    except Exception:
        logger.exception("Preview transcription failed; returning empty segments.")
        return PreviewResponse(segments=[])
    return PreviewResponse(
        segments=[
            PreviewSegment(speaker=s.speaker, start=s.start, end=s.end, text=s.text)
            for s in transcript.segments
        ]
    )
