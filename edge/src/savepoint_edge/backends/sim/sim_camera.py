"""No real camera: fills a fixed-size deterministic pixel buffer on every
call — no image content that means anything. Exercises the same
allocate/pass-a-Frame-downstream plumbing the real linux camera backend
will, without needing hardware. See sim_face_detector.py for where the
actually-interesting sim behavior (cycling through mock faces) lives — it
does NOT look at these pixels."""

from __future__ import annotations

import time

from savepoint_edge.types import Frame


class SimCamera:
    def __init__(self) -> None:
        self._frame_index = 0

    def capture_frame(self) -> Frame | None:
        width, height = 64, 64
        fill = self._frame_index % 256
        frame = Frame(
            width=width,
            height=height,
            format="rgb8",
            pixels=bytes([fill]) * (width * height * 3),
            timestamp_ms=int(time.time() * 1000),
        )
        self._frame_index += 1
        return frame
