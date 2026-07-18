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
* ``POST /ingest/audio/clip`` — the SAV-40 **option-A** bridge for a raw mic clip
  (multipart): the app uploads recorded ``audio`` bytes plus ``started_at`` (the
  absolute NTP-synced time the recording began). The server diarizes the clip
  (stub by default, no torch), anchors each segment's relative offset onto
  ``started_at``, and lands the turns through the same ``/ingest/audio`` path.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.services.ingest import (
    AudioIngestRequest,
    AudioIngestResult,
    AudioSegment,
    EdgeEvent,
    IngestResult,
    IngestValidationError,
    VideoIngestResult,
    _parse_iso_datetime,
    ingest_audio_segments,
    ingest_day,
    ingest_video_detections,
)
from savepoint_server.services.speech import Transcriber, get_transcriber
from savepoint_server.services.transcript_refine import (
    TranscriptRefineClient,
    get_transcript_refiner,
)
from savepoint_server.services.vision import ImageDecodeError

router = APIRouter(prefix="/ingest", tags=["ingest"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def get_transcriber_dep() -> Transcriber:
    """Provide the configured transcriber (stub default; overridable in tests)."""
    return get_transcriber()


def get_transcript_refiner_dep() -> TranscriptRefineClient | None:
    """Provide the optional transcript refiner (``None`` unless ``transcript_refine``
    is enabled with a Gemini key; overridable in tests via dependency_overrides)."""
    return get_transcript_refiner()


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
    refiner: Annotated[TranscriptRefineClient | None, Depends(get_transcript_refiner_dep)],
) -> AudioIngestResult:
    """Land the app's audio-derived JSON: record diarized SPOKE events by ts.

    When ``transcript_refine`` is enabled the turns' text is first cleaned by an
    optional Gemini pass (SAV-56); that pass can never block or 500 this route.
    """
    try:
        return await ingest_audio_segments(body, repos=repos, refiner=refiner)
    except IngestValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


StartedAtForm = Annotated[
    str,
    Form(description="Absolute ISO-8601 wall-clock time the recording BEGAN (NTP-synced anchor)."),
]


@router.post("/audio/clip", response_model=AudioIngestResult)
async def ingest_audio_clip(
    audio: AudioUpload,
    started_at: StartedAtForm,
    repos: Annotated[Repositories, Depends(get_repos)],
    transcriber: Annotated[Transcriber, Depends(get_transcriber_dep)],
    refiner: Annotated[TranscriptRefineClient | None, Depends(get_transcript_refiner_dep)],
) -> AudioIngestResult:
    """Upload a recorded clip -> diarize -> NTP-anchored SPOKE events (SAV-40 option A).

    The bridge from a raw microphone clip to the decoupled audio stream. The app
    sends the clip bytes plus ``started_at`` (the absolute, NTP-synced wall-clock
    time the recording *began*). The server diarizes the clip — the CI-safe
    :class:`~savepoint_server.services.speech.StubTranscriber` by default, the real
    pipeline on opt-in — into segments whose ``start``/``end`` are offsets *relative*
    to the clip, then anchors every offset onto ``started_at`` so each turn gets an
    absolute timestamp. Those become :class:`AudioSegment` rows landed through the
    exact same :func:`ingest_audio_segments` path as ``POST /ingest/audio``, so the
    resulting SPOKE events line up with the Pi's SEEN events on one shared timeline.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio upload; expected clip bytes.")
    try:
        # Anchor: parse the absolute start (400 on a bad value, like the sibling
        # ingest routes) and require it be timezone-aware, so the derived SPOKE
        # timestamps stay comparable with the UTC-aware SEEN events.
        anchor = _parse_iso_datetime(started_at, field="started_at")
        if anchor.tzinfo is None:
            raise IngestValidationError(
                f"Invalid started_at '{started_at}'; expected a timezone-aware ISO-8601 "
                "datetime (include a UTC offset) so events align on the NTP timeline."
            )
        transcript = transcriber.transcribe(audio_bytes)
        segments = [
            AudioSegment(
                speaker=seg.speaker,
                start=(anchor + timedelta(seconds=seg.start)).isoformat(),
                end=(anchor + timedelta(seconds=seg.end)).isoformat(),
                text=seg.text,
            )
            for seg in transcript.segments
        ]
        return await ingest_audio_segments(
            AudioIngestRequest(segments=segments), repos=repos, refiner=refiner
        )
    except IngestValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
