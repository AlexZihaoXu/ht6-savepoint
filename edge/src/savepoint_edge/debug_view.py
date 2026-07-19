"""Rendering for the live debug view: draws SCRFD boxes + identity labels
onto a captured Frame as a JPEG. Pure — no camera, no HTTP, no threading —
so both `debug_server.py` (in-process, shares the running service's camera)
and `scripts/debug_stream.py` (standalone, opens its own camera) can reuse
the exact same annotation logic instead of drifting two copies apart.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw

from savepoint_edge.identity_gallery import IdentityGallery
from savepoint_edge.types import DetectedFace, Frame

# Distinct, high-contrast colors cycled per distinct local_id — so "is this
# the same person as before" is a glance at color, not a squint at a long
# hex id string.
_PALETTE = [
    (0, 255, 0),  # green
    (255, 140, 0),  # orange
    (0, 200, 255),  # cyan
    (255, 0, 255),  # magenta
    (255, 255, 0),  # yellow
    (255, 60, 60),  # red
    (170, 0, 255),  # purple
]


class IdentityLabels:
    """Dev-only presentation layer on top of IdentityGallery: maps each
    distinct local_id to a short "P1"/"P2"/... label and a stable color, in
    first-seen order. Purely cosmetic — the real id is still local_id."""

    def __init__(self) -> None:
        self._assigned: dict[str, tuple[str, tuple[int, int, int]]] = {}

    def label_for(self, local_id: str) -> tuple[str, tuple[int, int, int]]:
        if local_id not in self._assigned:
            n = len(self._assigned) + 1
            self._assigned[local_id] = (f"P{n}", _PALETTE[(n - 1) % len(_PALETTE)])
        return self._assigned[local_id]


def annotated_jpeg(
    frame: Frame,
    faces: list[DetectedFace],
    gallery: IdentityGallery,
    labels: IdentityLabels,
) -> bytes:
    """`gallery` must be a debug-only instance, never the capture loop's
    real one — resolve() mutates presence-tracking state on every call, and
    this is called far more often than the loop's own 0.5s tick (see
    debug_server.py)."""
    arr_w, arr_h = frame.width, frame.height
    # Same BGR-labeled-as-RGB888 quirk as linux_face_detector.py — flip for
    # correct on-screen color, independent of the detector's own flip.
    arr = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(arr_h, arr_w, 3)[:, :, ::-1]
    img = Image.fromarray(arr)

    draw = ImageDraw.Draw(img)
    for face in faces:
        x1, y1 = face.x * arr_w, face.y * arr_h
        x2, y2 = x1 + face.w * arr_w, y1 + face.h * arr_h
        bbox = (face.x, face.y, face.w, face.h)
        res = gallery.resolve(face.embedding, bbox, frame.timestamp_ms)
        short_label, color = labels.label_for(res.local_id)
        # Confirmed (presence-persisted, would upload) = solid box + "OK".
        # Pending (still a possible flicker, would NOT upload yet) = thin
        # box + "..." — so the persistence filter is visible live.
        if res.confirmed:
            draw.rectangle([x1, y1, x2, y2], outline=color, width=4)
            tag = "OK"
        else:
            draw.rectangle([x1, y1, x2, y2], outline=color, width=1)
            tag = "..."
        draw.text((x1, max(0, y1 - 14)), f"{short_label} {tag} {face.confidence:.2f}", fill=color)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()
