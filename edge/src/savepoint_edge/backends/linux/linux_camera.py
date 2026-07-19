"""Real camera capture via picamera2 — the official Raspberry Pi Foundation
library, actively maintained, with first-party Camera Module 3 support.
`capture_array()` is picamera2's standard, documented way to pull a frame
into a numpy array (see picamera2's manual, "Capturing a numpy array").

Verified on real Pi 5 hardware (OV5647 sensor):

  1. picamera2's "RGB888" format is, despite the name, actually BGR byte
     order — confirmed both against picamera2's own docs/source (inherited
     from libcamera/Linux DRM format naming) and empirically on this
     hardware. `capture_frame()` does NOT do this flip itself — callers
     that need true RGB (e.g. LinuxFaceDetector) flip it themselves; see
     that module's docstring.
  2. Needs `sudo apt install -y python3-picamera2 python3-libcamera` plus a
     venv created with `--system-site-packages` — see README.md's "Setup on
     the Pi". Importing this module without that setup raises a clear
     ImportError pointing back here.

`_DEFAULT_SIZE` is 1280x960, not picamera2's more common 640x480 default:
at 640x480 a face that isn't filling the frame (any real usage — someone
standing a normal conversational distance away, camera not aimed exactly at
eye level) crops down to on the order of 70x80px once detected, which then
gets upscaled to LinuxFaceDetector's 112x112 embedding input — mostly
interpolated blur, not real detail. That measurably degraded embedding
quality enough to make the same real person's cosine similarity across
frames unreliable. 1280x960 costs ~3x the inference latency (~380ms vs
~110ms per frame on Pi 5 for detect+embed combined, measured) but that's
still well inside main.py's 0.5s tick — worth it for detection/embedding
quality. Confirmed by direct before/after visual comparison of the aligned
112x112 crop on real hardware, not assumed.

1280x960 also comes from the OV5647's full-field-of-view binned sensor mode
(1296x972), NOT a crop. The 1920x1080 mode this sensor offers is a *center
crop* of the array (crop origin (348,434), 1928x1080 out of 2592x1944) — it
throws away the wide field of view, which is exactly the wrong trade for a
wearable meant to catch whoever you're facing. Higher resolution ≠ better
here; wider FOV wins.

White balance (SAVEPOINT_EDGE_AWB env var): the ISP's auto white balance,
left fully automatic, visibly *swings* frame-to-frame in mixed/warm venue
lighting — settling on a cold (blue-heavy) white point one moment and a
warm (red-heavy) one the next. That was diagnosed on real hardware: with
the lens capped, the raw Bayer black level is neutral (all four channels
~equal) and the processed frame is genuinely black — the intermittent blue
cast people saw was purely the auto-WB tinting a near-black noise floor at
max gain, not a channel-order or bit-depth bug. To stop the swing:
  - "auto" (default): full per-frame auto WB — correct on average but can
    swing; unchanged legacy behavior.
  - "lock": let auto WB converge on the ACTUAL current lighting for a beat,
    then freeze those gains so color stops swinging (best for a stable
    scene / demo; if lighting later changes a lot, color drifts). Don't
    start in "lock" with the lens capped — it'd freeze garbage gains.
  - "R,B" (two floats, e.g. "1.4,1.8"): fixed manual colour gains.
Stable color also marginally helps embedding consistency — the recognition
model sees a steady color transform instead of a frame-to-frame-varying one.
"""

from __future__ import annotations

import os
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

_DEFAULT_SIZE = (1280, 960)
# How long to let auto WB converge before freezing it, in "lock" mode.
_AWB_CONVERGE_S = 1.5


class LinuxCamera:
    def __init__(self, size: tuple[int, int] = _DEFAULT_SIZE) -> None:
        self._width, self._height = size
        self._picam2 = Picamera2()
        config = self._picam2.create_preview_configuration(
            main={"size": size, "format": "RGB888"}
        )
        self._picam2.configure(config)
        self._picam2.start()
        self._apply_white_balance()

    def _apply_white_balance(self) -> None:
        """Honor SAVEPOINT_EDGE_AWB (see module docstring): 'auto' (default,
        no-op), 'lock' (converge-then-freeze), or 'R,B' fixed gains."""
        spec = os.environ.get("SAVEPOINT_EDGE_AWB", "auto").strip().lower()
        if spec == "auto":
            return
        if spec == "lock":
            time.sleep(_AWB_CONVERGE_S)
            gains = self._picam2.capture_metadata().get("ColourGains")
            if gains is not None:
                self._picam2.set_controls({"AwbEnable": False, "ColourGains": gains})
            return
        try:
            red, blue = (float(x) for x in spec.split(","))
        except ValueError as exc:
            raise ValueError(
                f"SAVEPOINT_EDGE_AWB={spec!r} not understood — use 'auto', 'lock', "
                "or two floats 'RED,BLUE' (e.g. '1.4,1.8')."
            ) from exc
        self._picam2.set_controls({"AwbEnable": False, "ColourGains": (red, blue)})

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
