"""Vision router: upload a frame -> deterministic sprite params (SAV-31).

Stateless — no DB writes here; persisting a person's sprite is a later ticket.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from savepoint_server.models.sprite import SpriteParams
from savepoint_server.services.vision import frame_to_sprite_params

router = APIRouter(prefix="/vision", tags=["vision"])


FrameUpload = Annotated[UploadFile, File(description="Camera frame image.")]


@router.post("/analyze", response_model=SpriteParams)
async def analyze(file: FrameUpload) -> SpriteParams:
    """Analyse an uploaded camera frame and return deterministic sprite params."""
    image_bytes = await file.read()
    return frame_to_sprite_params(image_bytes)
