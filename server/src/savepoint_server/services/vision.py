"""Vision service: camera frame -> deterministic sprite params (SAV-31).

Pipeline (all deterministic, no model downloads, no GPU):

1. Decode the image bytes with Pillow.
2. Detect faces with OpenCV's bundled Haar cascade
   (``haarcascade_frontalface_default.xml``) and pick the largest. If none is
   found, fall back to analysing the whole image so output is always valid.
3. Sample robust attributes: skin tone (median of the central face region),
   hair tone (median of a top strip), face aspect ratio, and brightness.
4. Quantize those attributes into a bounded sprite spec and derive a stable
   ``seed`` (SHA-256 of the quantized signature) — same bytes -> same params.

Determinism note: we hash with :mod:`hashlib`, never the salted builtin
``hash()``, so the ``seed`` is stable across processes and restarts.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from PIL import Image

from savepoint_server.models.sprite import (
    ACCESSORIES,
    FACE_SHAPES,
    HAIR_COLORS,
    HAIR_STYLES,
    SKIN_LEVELS,
    FaceAnalysis,
    SpriteParams,
)

_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"


@lru_cache(maxsize=1)
def _cascade() -> Any:
    """Return the process-wide (cached) frontal-face Haar cascade classifier."""
    return cv2.CascadeClassifier(_CASCADE_PATH)


def _load_rgb(image_bytes: bytes) -> np.ndarray:
    """Decode raw image bytes into an ``(H, W, 3)`` uint8 RGB array."""
    with Image.open(BytesIO(image_bytes)) as img:
        rgb = img.convert("RGB")
        return np.asarray(rgb, dtype=np.uint8)


def _detect_largest_face(gray: np.ndarray) -> tuple[int, int, int, int] | None:
    """Run the Haar cascade and return the largest ``(x, y, w, h)`` box, or None."""
    faces = _cascade().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    if len(faces) == 0:
        return None
    x, y, w, h = max(faces, key=lambda f: int(f[2]) * int(f[3]))
    return int(x), int(y), int(w), int(h)


def _clip_region(arr: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Return the ``arr`` sub-region for box (x, y, w, h), clipped to bounds.

    Always yields at least a 1x1 patch so downstream median sampling is safe.
    """
    height, width = arr.shape[:2]
    x0 = max(0, min(x, width - 1))
    y0 = max(0, min(y, height - 1))
    x1 = max(x0 + 1, min(x + w, width))
    y1 = max(y0 + 1, min(y + h, height))
    return arr[y0:y1, x0:x1]


def _median_rgb(region: np.ndarray) -> tuple[int, int, int]:
    """Return the per-channel median colour of an ``(h, w, 3)`` region."""
    med = np.median(region.reshape(-1, 3), axis=0)
    return int(med[0]), int(med[1]), int(med[2])


def _luminance(rgb: tuple[int, int, int]) -> float:
    """Perceptual (Rec. 601) luminance of an RGB triple, 0..255."""
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b


def _quantize(value: float, lo: float, hi: float, buckets: int) -> int:
    """Map ``value`` in ``[lo, hi]`` onto an integer bucket in ``0..buckets-1``."""
    if hi <= lo or buckets <= 1:
        return 0
    t = (value - lo) / (hi - lo)
    t = min(0.9999999, max(0.0, t))
    return int(t * buckets)


def analyze_frame(image_bytes: bytes) -> FaceAnalysis:
    """Decode a frame and extract robust facial attributes.

    Detects the largest frontal face with the bundled Haar cascade; if none is
    found, the whole image is used as the face region so a valid
    :class:`FaceAnalysis` is always produced.
    """
    rgb = _load_rgb(image_bytes)
    height, width = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    box = _detect_largest_face(gray)
    detected = box is not None
    if box is None:
        box = (0, 0, width, height)
    x, y, w, h = box

    # Skin: central patch of the box (avoids hairline/background edges).
    skin_region = _clip_region(rgb, x + w // 4, y + h // 3, max(1, w // 2), max(1, h // 3))
    skin_rgb = _median_rgb(skin_region)

    # Hair: a strip spanning the top of (and slightly above) the box.
    hair_y = max(0, y - h // 6)
    hair_region = _clip_region(rgb, x, hair_y, w, max(1, h // 4))
    hair_rgb = _median_rgb(hair_region)

    face_aspect = w / h if h else 1.0
    brightness = float(gray.mean())

    return FaceAnalysis(
        face_detected=detected,
        face_box=(x, y, w, h),
        skin_rgb=skin_rgb,
        hair_rgb=hair_rgb,
        face_aspect=round(face_aspect, 4),
        brightness=round(brightness, 4),
        image_size=(width, height),
    )


def _params_from_analysis(analysis: FaceAnalysis) -> SpriteParams:
    """Quantize a :class:`FaceAnalysis` into a bounded, deterministic sprite spec."""
    skin_lum = _luminance(analysis.skin_rgb)
    hair_lum = _luminance(analysis.hair_rgb)
    sr, sg, sb = analysis.skin_rgb
    hr, hg, hb = analysis.hair_rgb

    # Quantized signature: everything the seed and params derive from. Coarse
    # buckets make the mapping robust to minor pixel noise.
    signature = (
        sr // 32,
        sg // 32,
        sb // 32,
        hr // 32,
        hg // 32,
        hb // 32,
        _quantize(analysis.face_aspect, 0.5, 1.5, 8),
        int(analysis.brightness) // 16,
        int(analysis.face_detected),
    )
    digest = hashlib.sha256(repr(signature).encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big")

    return SpriteParams(
        skin=_quantize(skin_lum, 30.0, 230.0, SKIN_LEVELS),
        hair_color=_quantize(hair_lum, 10.0, 230.0, HAIR_COLORS),
        face_shape=_quantize(analysis.face_aspect, 0.6, 1.4, FACE_SHAPES),
        # Style/accessory have no single robust visual cue, so derive them from
        # independent slices of the stable seed — still fully deterministic.
        hair_style=(seed >> 8) % HAIR_STYLES,
        accessory=(seed >> 16) % ACCESSORIES,
        seed=seed,
    )


def frame_to_sprite_params(image_bytes: bytes) -> SpriteParams:
    """Turn a camera frame into deterministic, bounded sprite parameters.

    Same input bytes always yield identical :class:`SpriteParams`.
    """
    return _params_from_analysis(analyze_frame(image_bytes))
