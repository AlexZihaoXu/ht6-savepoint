"""Voice router: enroll the wearer's voice + report enrollment status (SAV-?).

``POST /voice/enroll`` accepts a short sample of the wearer speaking (multipart
``audio``), extracts a speaker embedding via the injected :class:`VoiceEnroller`,
and upserts it as the singleton :class:`WearerVoice` document (``_id`` ``"you"``).
Once enrolled, ``services/voice.py``'s ``match_voice_to_you`` uses that embedding
to auto-label the wearer's own diarized speech as ``"you"`` on future
transcriptions (``POST /speech/transcribe`` and ``POST /ingest/audio/clip``).
``GET /voice/status`` reports whether enrollment has happened yet.

The enroller is provided through the :func:`get_enroller` dependency (same
injection pattern as ``bio.py``'s ``get_llm_client``) so tests can override it
with a fake — no subprocess ever runs in CI. A sample that's too short/unusable
for ``voiceprint.py`` is a user-facing 400 (bad enrollment sample), never a 500.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import WearerVoice
from savepoint_server.services.voice import VoiceEnroller, VoiceEnrollmentError, get_voice_enroller

router = APIRouter(prefix="/voice", tags=["voice"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def get_enroller() -> VoiceEnroller:
    """Provide the configured voice enroller (overridable in tests via dependency_overrides)."""
    return get_voice_enroller()


class EnrollResponse(BaseModel):
    """Result of a successful ``POST /voice/enroll``."""

    enrolled: bool
    enrolled_at: datetime


class StatusResponse(BaseModel):
    """Result of ``GET /voice/status``."""

    enrolled: bool
    enrolled_at: datetime | None = None


AudioUpload = Annotated[UploadFile, File(description="A clean sample of the wearer speaking.")]


@router.post("/enroll", response_model=EnrollResponse)
async def enroll_voice(
    audio: AudioUpload,
    repos: Annotated[Repositories, Depends(get_repos)],
    enroller: Annotated[VoiceEnroller, Depends(get_enroller)],
) -> EnrollResponse:
    """Enroll (or re-enroll) the wearer's voice from a sample recording.

    400 on an empty upload or a sample the enroller can't extract a voiceprint
    from (e.g. too short); on success, upserts the singleton ``WearerVoice`` doc
    (re-enrolling overwrites the previous embedding, not a second document).
    """
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio upload; expected a voice sample.")
    try:
        embedding = enroller.enroll(data)
    except VoiceEnrollmentError as exc:
        raise HTTPException(
            status_code=400, detail=f"Couldn't extract a voiceprint: {exc}"
        ) from exc
    enrolled_at = datetime.now(UTC)
    await repos.wearer_voice.upsert(WearerVoice(embedding=embedding, enrolled_at=enrolled_at))
    return EnrollResponse(enrolled=True, enrolled_at=enrolled_at)


@router.get("/status", response_model=StatusResponse)
async def get_voice_status(
    repos: Annotated[Repositories, Depends(get_repos)],
) -> StatusResponse:
    """Report whether the wearer's voice has been enrolled yet."""
    wearer = await repos.wearer_voice.get("you")
    if wearer is None:
        return StatusResponse(enrolled=False, enrolled_at=None)
    return StatusResponse(enrolled=True, enrolled_at=wearer.enrolled_at)
