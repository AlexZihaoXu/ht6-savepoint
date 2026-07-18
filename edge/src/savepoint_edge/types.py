"""Shared data shapes for the edge capture pipeline.

Backend-agnostic: sim and linux backends both produce/consume these same
dataclasses. See hal.py for the interfaces built around them.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Dimensionality of the face-attribute embedding produced by whatever model
# ends up wired into a FaceDetector (DESIGN.md §13 names MobileFaceNet).
# 512 matches w600k_mbf.onnx (LinuxFaceDetector's real embedding model,
# confirmed via its ONNX graph's output shape) — adjust if that model
# changes; nothing else here assumes a specific value.
FACE_EMBEDDING_DIM = 512


@dataclass
class Frame:
    """One captured camera frame.

    `pixels` is raw interleaved RGB8 unless `format` says otherwise. Sim
    backends may leave `pixels` empty since nothing downstream in sim mode
    looks at pixel content — only a real FaceDetector would.
    """

    width: int = 0
    height: int = 0
    format: str = "rgb8"
    pixels: bytes = b""
    timestamp_ms: int = 0


@dataclass
class DetectedFace:
    """One face found in a Frame, plus the attribute embedding used to
    derive a deterministic sprite (DESIGN.md §7) and a coarse same-session
    identity."""

    x: float = 0.0  # normalized bbox, top-left origin, [0, 1]
    y: float = 0.0
    w: float = 0.0
    h: float = 0.0
    confidence: float = 0.0
    embedding: list[float] = field(default_factory=list)


@dataclass
class AvatarParams:
    """The parametric sprite-kit selectors read from a face (DESIGN.md §7).

    Mirrors server/src/savepoint_server/models/person.py::AvatarParams field
    names exactly, so it round-trips through server's Pydantic model as-is.

    Token values below (skin_tone/hair_color/hair_style/shirt_color choices
    in sprite_params.py) are PROVISIONAL: no real layered pixel-art sprite
    kit exists yet (app/src/components/SpriteAvatar.tsx still renders a
    tinted-initials placeholder). Whoever builds the sprite kit's asset
    names is the source of truth — update sprite_params.py's token lists to
    match.
    """

    skin_tone: str = ""
    hair_color: str = ""
    hair_style: str = ""
    glasses: bool = False
    hat: str | None = None
    shirt_color: str = ""


@dataclass
class EdgeEvent:
    """What edge ships off-device. This is NOT the server's `events` Mongo
    document (server/src/savepoint_server/models/event.py) — it's a raw
    detection the (not-yet-built) server ingest endpoint is expected to turn
    into a `people` upsert + an `events` document, per DESIGN.md §9's flow:
    "Pi emits an event -> server upserts people (match by nearest face/voice
    embedding, else new localId) -> append events". See README.md's "Wire
    format vs. server data model" for the full explanation.
    """

    ts_unix_ms: int = 0
    local_id: str = ""  # stable per-face id, see sprite_params.py
    type: str = "seen"  # edge only ever emits "seen" — "spoke" events come
    # from the server-side speech pipeline (pipeline/), not from edge.
    avatar_params: AvatarParams = field(default_factory=AvatarParams)
    face_embedding: list[float] | None = None  # present for "seen" events
    place: str | None = None
    schema_version: str = "savepoint.edge.v1"
