"""Speech router: upload audio -> diarized transcript -> Events in Mongo (SAV-32).

With the default :class:`~savepoint_server.services.speech.StubTranscriber` this
runs end to end in dev and CI without torch. Selecting the real pipeline is a
config switch (``SAVEPOINT_TRANSCRIBER=real``); the endpoint code is identical.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Transcript
from savepoint_server.services.speech import transcribe_and_store, transcript_from_events

router = APIRouter(prefix="/speech", tags=["speech"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


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
    audio = await file.read()
    resolved_day = day_id or datetime.now(UTC).date().isoformat()
    events = await transcribe_and_store(audio, day_id=resolved_day, repos=repos)
    return TranscribeResponse(
        day_id=resolved_day,
        transcript=transcript_from_events(events),
        event_ids=[e.id for e in events if e.id is not None],
    )
