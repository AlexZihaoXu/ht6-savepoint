"""Speech router: upload audio -> diarized transcript -> Events in Mongo (SAV-32).

With the default :class:`~savepoint_server.services.speech.StubTranscriber` this
runs end to end in dev and CI without torch. Selecting the real pipeline is a
config switch (``SAVEPOINT_TRANSCRIBER=real``); the endpoint code is identical.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Transcript
from savepoint_server.services.speech import transcribe_and_store, transcript_from_events

router = APIRouter(prefix="/speech", tags=["speech"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


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
