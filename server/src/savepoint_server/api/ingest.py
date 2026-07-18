"""Ingest router: land camera + microphone signal as Person + Events + Day.

Three write endpoints, all persisting to Mongo and CI-safe (no torch):

* ``POST /ingest`` — the M1 **combined** flow (SAV-30). One multipart request
  carries a camera ``frame`` and an ``audio`` clip; the service turns the frame
  into a Person (deterministic sprite params) and the audio into diarized SPOKE
  events, then upserts the day, returning an :class:`IngestResult`.
* ``POST /ingest/video`` / ``POST /ingest/audio`` — the **decoupled two-stream
  JSON** flow (SAV-40). The Pi posts video-derived detections (sprite params + ts)
  and the app posts audio-derived transcript segments (speaker/text + ts) as JSON
  — **no raw media crosses the wire**. Both carry absolute NTP-synced timestamps,
  so the server lands them on one shared day timeline (aligned implicitly by ts).
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.services.ingest import (
    AudioIngestRequest,
    AudioIngestResult,
    EdgeEvent,
    IngestResult,
    IngestValidationError,
    VideoIngestResult,
    ingest_audio_segments,
    ingest_day,
    ingest_video_detections,
)
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


@router.post("/video", response_model=VideoIngestResult)
async def ingest_video(
    body: list[EdgeEvent],
    repos: Annotated[Repositories, Depends(get_repos)],
) -> VideoIngestResult:
    """Land the Pi's edge detections (``list[EdgeEvent]``): upsert People + SEEN events."""
    try:
        return await ingest_video_detections(body, repos=repos)
    except IngestValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio", response_model=AudioIngestResult)
async def ingest_audio(
    body: AudioIngestRequest,
    repos: Annotated[Repositories, Depends(get_repos)],
) -> AudioIngestResult:
    """Land the app's audio-derived JSON: record diarized SPOKE events by ts."""
    try:
        return await ingest_audio_segments(body, repos=repos)
    except IngestValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
