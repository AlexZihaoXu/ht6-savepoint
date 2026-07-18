"""Hardware-abstraction boundary.

Every interface here has exactly two implementations: a `sim` backend
(backends/sim/, runs on any machine, no hardware) and a `linux` backend
(backends/linux/, needs picamera2/gpiozero/onnxruntime and real hardware —
see README.md's "Setup on the Pi"). main.py is written entirely against
these interfaces so it never changes between "testing on a laptop today"
and "running on the Pi later" — only which backend gets selected changes,
via the SAVEPOINT_EDGE_BACKEND env var (see main.py).

These are typing.Protocol, not ABCs: no inheritance required, so sim/linux
implementations don't need to import this module at all — useful since sim
mode must stay importable with zero Pi-specific dependencies installed.
"""

from __future__ import annotations

from typing import Protocol

from savepoint_edge.types import DetectedFace, EdgeEvent, Frame


class Camera(Protocol):
    def capture_frame(self) -> Frame | None:
        """Blocks until a frame is available, or returns None on a fatal error."""
        ...


class MuteSwitch(Protocol):
    def is_muted(self) -> bool:
        """Polled every loop tick — see main.py's "cannot-fail" note on why
        this is app-level and NOT the only mute guarantee that should exist."""
        ...

    def set_recording_led(self, on: bool) -> None:
        """Recording-indicator LED (DESIGN.md §4/§8): on iff actively
        capturing AND not muted. main.py is the only caller."""
        ...


class FaceDetector(Protocol):
    def detect(self, frame: Frame) -> list[DetectedFace]: ...


class EventSink(Protocol):
    def publish(self, event: EdgeEvent) -> bool:
        """Returns False on a delivery failure; main.py logs and continues
        (never crashes the capture loop over a sink hiccup) — every
        implementation MUST catch its own exceptions internally rather than
        let them propagate, since this is called synchronously in the main
        loop. (An earlier C++ prototype of this exact sink shape had a
        socket call that could hang or crash the whole process on a bad
        peer — see git history / edge/README.md if curious. Don't repeat
        that: catch broadly, always return, never block indefinitely.)
        """
        ...
