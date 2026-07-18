"""Tests for the vision service and the /vision/analyze endpoint (SAV-31).

All test images are generated in-code with NumPy/Pillow — nothing is downloaded.
Synthetic images have no real faces, so these exercise the whole-image fallback
path; that is exactly what guarantees valid output when Haar finds nothing.
"""

from __future__ import annotations

from io import BytesIO

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from savepoint_server.main import app
from savepoint_server.models.sprite import (
    ACCESSORIES,
    FACE_SHAPES,
    HAIR_COLORS,
    HAIR_STYLES,
    SKIN_LEVELS,
    SpriteParams,
)
from savepoint_server.services.vision import analyze_frame, frame_to_sprite_params

client = TestClient(app)


def _solid_png(color: tuple[int, int, int], size: tuple[int, int] = (128, 128)) -> bytes:
    """Return PNG bytes for a solid-colour image of the given (w, h) size."""
    width, height = size
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, :] = color
    buf = BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    return buf.getvalue()


def _gradient_png(size: tuple[int, int] = (160, 120)) -> bytes:
    """Return PNG bytes for a deterministic horizontal RGB gradient."""
    width, height = size
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    ramp = np.linspace(0, 255, width, dtype=np.uint8)
    arr[:, :, 0] = ramp
    arr[:, :, 1] = ramp[::-1]
    arr[:, :, 2] = 128
    buf = BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    return buf.getvalue()


def _assert_valid(params: SpriteParams) -> None:
    """Assert every sprite selector sits inside its declared bounded range."""
    assert 0 <= params.skin < SKIN_LEVELS
    assert 0 <= params.hair_color < HAIR_COLORS
    assert 0 <= params.hair_style < HAIR_STYLES
    assert 0 <= params.face_shape < FACE_SHAPES
    assert 0 <= params.accessory < ACCESSORIES
    assert params.seed >= 0


def test_frame_to_sprite_params_is_deterministic() -> None:
    data = _solid_png((180, 140, 120))
    first = frame_to_sprite_params(data)
    second = frame_to_sprite_params(data)
    assert first == second
    assert first.seed == second.seed


def test_gradient_image_is_deterministic() -> None:
    data = _gradient_png()
    assert frame_to_sprite_params(data) == frame_to_sprite_params(data)


def test_various_images_produce_valid_ranges() -> None:
    images = [
        _solid_png((10, 10, 10)),
        _solid_png((200, 180, 160)),
        _solid_png((50, 120, 200)),
        _solid_png((240, 240, 240)),
        _gradient_png(),
        _solid_png((90, 60, 40), size=(64, 96)),
    ]
    for data in images:
        _assert_valid(frame_to_sprite_params(data))


def test_distinct_images_yield_distinct_seeds() -> None:
    dark = frame_to_sprite_params(_solid_png((15, 15, 15)))
    light = frame_to_sprite_params(_solid_png((230, 210, 190)))
    assert dark.seed != light.seed


def test_analyze_frame_fallback_is_valid() -> None:
    analysis = analyze_frame(_solid_png((100, 100, 100), size=(96, 64)))
    assert analysis.image_size == (96, 64)
    assert isinstance(analysis.face_detected, bool)
    # Fallback uses the whole image as the face box.
    assert analysis.face_box[2] <= 96
    assert analysis.face_box[3] <= 64
    for channel in (*analysis.skin_rgb, *analysis.hair_rgb):
        assert 0 <= channel <= 255
    assert 0.0 <= analysis.brightness <= 255.0


def test_analyze_endpoint_returns_valid_sprite_params() -> None:
    data = _solid_png((150, 120, 100))
    resp = client.post(
        "/vision/analyze",
        files={"file": ("frame.png", data, "image/png")},
    )
    assert resp.status_code == 200
    params = SpriteParams.model_validate(resp.json())
    _assert_valid(params)


def test_analyze_endpoint_is_deterministic() -> None:
    data = _gradient_png()
    files = {"file": ("frame.png", data, "image/png")}
    first = client.post("/vision/analyze", files=files).json()
    second = client.post("/vision/analyze", files=files).json()
    assert first == second


def test_analyze_endpoint_rejects_non_image_with_400() -> None:
    """A text upload is not a decodable image -> clean 400, not a 500."""
    resp = client.post(
        "/vision/analyze",
        files={"file": ("notes.txt", b"this is not an image", "text/plain")},
    )
    assert resp.status_code == 400
    assert "decodable image" in resp.json()["detail"]


def test_analyze_endpoint_rejects_empty_upload_with_400() -> None:
    """An empty upload can't be decoded -> clean 400, not a 500."""
    resp = client.post(
        "/vision/analyze",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert resp.status_code == 400
