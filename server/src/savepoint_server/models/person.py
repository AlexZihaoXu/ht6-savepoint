"""``people`` collection models (DESIGN §7 sprites, §9 data model)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.models.base import MongoModel


class AvatarParams(BaseModel):
    """Deterministic parametric-sprite attributes read from a face (DESIGN §7).

    The same person always maps to the same sprite — these are the layered-kit
    selectors, never a raw photo.
    """

    model_config = ConfigDict(extra="forbid")

    skin_tone: str
    hair_color: str
    hair_style: str
    glasses: bool = False
    hat: str | None = None
    shirt_color: str


class Person(MongoModel):
    """A person you have met, rendered as a recurring pixel character."""

    local_id: str
    name: str | None = None
    avatar_params: AvatarParams
    # Speaker voiceprint (ECAPA, 192-d). Kept on-device where feasible (DESIGN §8);
    # optional here for enrolled speakers bound server-side.
    voice_embedding: list[float] | None = None
    # Face-attribute embedding from the edge detector (512-d, MobileFaceNet /
    # w600k_mbf.onnx; see edge/types.py). Stored from EdgeEvents so future
    # detections can nearest-neighbour match a face to a known Person (DESIGN §9).
    face_embedding: list[float] | None = None
    tags: list[str] = Field(default_factory=list)
    favorite: bool = False
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    notes: str | None = None
