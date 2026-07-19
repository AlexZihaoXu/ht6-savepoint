"""Vision router: upload a frame -> deterministic sprite params (SAV-31).

Stateless — no DB writes here; persisting a person's sprite is a later ticket.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from savepoint_server.models.sprite import SpriteParams
from savepoint_server.services.vision import ImageDecodeError, frame_to_sprite_params

router = APIRouter(prefix="/vision", tags=["vision"])


FrameUpload = Annotated[UploadFile, File(description="Camera frame image.")]


@router.post("/analyze", response_model=SpriteParams)
async def analyze(file: FrameUpload) -> SpriteParams:
    """Analyse an uploaded camera frame and return deterministic sprite params."""
    image_bytes = await file.read()
    try:
        return frame_to_sprite_params(image_bytes)
    except ImageDecodeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
