"""Ingest router: a frame + an audio clip -> Person + Events + Day (SAV-30).

The M1 milestone endpoint. One multipart request carries a camera ``frame`` and
an ``audio`` recording of the moment; the ingest service turns the frame into a
Person (deterministic sprite params) and the audio into diarized SPOKE events,
then upserts the day — all persisted to Mongo and returned as an
:class:`IngestResult`. Runs end to end on the CI-safe stub transcriber, so it
needs no torch.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.services.ingest import IngestResult, ingest_day
from savepoint_server.services.vision import ImageDecodeError

router = APIRouter(prefix="/ingest", tags=["ingest"])


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


FrameUpload = Annotated[UploadFile, File(description="Camera frame image.")]
AudioUpload = Annotated[UploadFile, File(description="Audio recording of the moment.")]


@router.post("", response_model=IngestResult)
async def ingest(
    frame: FrameUpload,
    audio: AudioUpload,
    repos: Annotated[Repositories, Depends(get_repos)],
    day_id: Annotated[str | None, Form(description="ISO day bucket; defaults to today.")] = None,
    person_key: Annotated[
        str | None, Form(description="Explicit stable person id; else derived from the face.")
    ] = None,
) -> IngestResult:
    """Ingest a frame + audio clip: upsert the Person, store SPOKE events, upsert the Day."""
    if day_id is not None:
        _parse_iso_date(day_id)  # validate up front so a bad day_id is a 400, not a 500
    frame_bytes = await frame.read()
    audio_bytes = await audio.read()
    try:
        return await ingest_day(
            frame_bytes,
            audio_bytes,
            day_id=day_id,
            repos=repos,
            person_key=person_key,
        )
    except ImageDecodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
