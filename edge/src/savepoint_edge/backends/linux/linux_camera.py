"""Real camera capture via picamera2 — the official Raspberry Pi Foundation
library, actively maintained, with first-party Camera Module 3 support.
`capture_array()` is picamera2's standard, documented way to pull a frame
into a numpy array (see picamera2's manual, "Capturing a numpy array").

UNVERIFIED — never run against real hardware in this scaffold (no Pi was
available while writing it) — but the API shape below is the well-documented
standard usage pattern, not a guess. Two things worth double-checking once
you have hardware:

  1. picamera2's "RGB888" format has a long-standing, widely-reported quirk
     where the actual byte order in the returned array is BGR, not RGB —
     this has changed across picamera2/libcamera versions before. Verify
     with a known-color test shot (e.g. point at something solidly red)
     before trusting frame.pixels' channel order downstream.
  2. Needs `sudo apt install -y python3-picamera2 python3-libcamera` plus a
     venv created with `--system-site-packages` — see README.md's "Setup on
     the Pi". Importing this module without that setup raises a clear
     ImportError pointing back here.
"""

from __future__ import annotations

import time

from savepoint_edge.types import Frame

try:
    from picamera2 import Picamera2
except ImportError as exc:  # pragma: no cover - exercised only on real hardware
    raise ImportError(
        "picamera2 is not importable. It ships via apt, not pip — see "
        "edge/README.md's 'Setup on the Pi' for the "
        "`apt install python3-picamera2` + `uv venv --system-site-packages` steps."
    ) from exc

_DEFAULT_SIZE = (640, 480)


class LinuxCamera:
    def __init__(self, size: tuple[int, int] = _DEFAULT_SIZE) -> None:
        self._width, self._height = size
        self._picam2 = Picamera2()
        config = self._picam2.create_preview_configuration(
            main={"size": size, "format": "RGB888"}
        )
        self._picam2.configure(config)
        self._picam2.start()

    def capture_frame(self) -> Frame | None:
        array = self._picam2.capture_array()  # HxWx3 uint8 — see channel-order caveat above
        return Frame(
            width=self._width,
            height=self._height,
            format="rgb8",
            pixels=array.tobytes(),
            timestamp_ms=int(time.time() * 1000),
        )

    def close(self) -> None:
        self._picam2.stop()
