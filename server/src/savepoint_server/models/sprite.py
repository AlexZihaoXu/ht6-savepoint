"""Deterministic sprite parameters derived from a camera frame (SAV-31).

The SavePoint core loop turns *a person you meet* into a recurring pixel
character (Wii-Mii aesthetic, DESIGN §7). A frame is reduced to a small set of
robust facial attributes (:class:`FaceAnalysis`) which are then quantized into a
bounded, parametric sprite spec (:class:`SpriteParams`). The mapping is
deterministic: the same input frame always yields the same character.

These models are pure Pydantic (no OpenCV/NumPy imports) so they stay cheap to
import; the extraction logic lives in ``services.vision``.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Bounded sprite kit dimensions (each selector is 0..N-1). Kept as module
# constants so the service and tests share one source of truth for valid ranges.
SKIN_LEVELS = 5  # skin: 0..4
HAIR_COLORS = 8  # hair_color: 0..7
HAIR_STYLES = 6  # hair_style: 0..5
FACE_SHAPES = 4  # face_shape: 0..3
ACCESSORIES = 4  # accessory: 0..3


class FaceAnalysis(BaseModel):
    """Robust, low-level attributes read from a single frame.

    The intermediate representation between raw pixels and sprite selectors. When
    no face is detected the whole image is treated as the "face" region so the
    output is always valid (see ``services.vision.analyze_frame``).
    """

    model_config = ConfigDict(extra="forbid")

    face_detected: bool = Field(description="True if a Haar cascade found a face.")
    face_box: tuple[int, int, int, int] = Field(
        description="Face bounding box (x, y, w, h); whole image on fallback."
    )
    skin_rgb: tuple[int, int, int] = Field(description="Median RGB of the central face region.")
    hair_rgb: tuple[int, int, int] = Field(
        description="Median RGB of the top hair strip of the box."
    )
    face_aspect: float = Field(description="Face box width / height.")
    brightness: float = Field(description="Mean grayscale brightness, 0..255.")
    image_size: tuple[int, int] = Field(description="Decoded image (width, height).")


class SpriteParams(BaseModel):
    """Bounded, deterministic parametric-sprite spec (the layered-kit selectors).

    Every field is a small integer index into a sprite asset kit. ``seed`` is a
    stable hash of the quantized attributes, so identical frames produce identical
    params — the same person always maps to the same character.
    """

    model_config = ConfigDict(extra="forbid")

    skin: int = Field(ge=0, le=SKIN_LEVELS - 1, description="Skin-tone index.")
    hair_color: int = Field(ge=0, le=HAIR_COLORS - 1, description="Hair-colour index.")
    hair_style: int = Field(ge=0, le=HAIR_STYLES - 1, description="Hair-style index.")
    face_shape: int = Field(ge=0, le=FACE_SHAPES - 1, description="Face-shape index.")
    accessory: int = Field(ge=0, le=ACCESSORIES - 1, description="Accessory index.")
    seed: int = Field(ge=0, description="Stable hash of the quantized attributes.")
