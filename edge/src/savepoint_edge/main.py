"""The capture loop.

SAVEPOINT_EDGE_BACKEND selects hardware vs. simulation:
  (unset) / "sim" -> synthetic camera/mute/detector, no hardware, no
                      Pi-specific dependencies needed (default)
  "linux"          -> picamera2 + gpiozero + onnxruntime on real Pi 5
                      hardware (see README.md's "Setup on the Pi")

Backend modules are imported lazily, inside _build_backend(), specifically
so `SAVEPOINT_EDGE_BACKEND=sim` (and importing this module for tests) never
requires picamera2/gpiozero/onnxruntime to be installed.
"""

from __future__ import annotations

import os
import signal
import sys
import time
from types import FrameType

from savepoint_edge.hal import Camera, EventSink, FaceDetector, MuteSwitch
from savepoint_edge.identity_gallery import IdentityGallery
from savepoint_edge.sinks.file_sink import FileSink
from savepoint_edge.sinks.http_sink import HttpSink
from savepoint_edge.sinks.stdout_sink import StdoutSink
from savepoint_edge.sprite_params import compute_avatar_params
from savepoint_edge.types import EdgeEvent

_TICK_S = 0.5
_running = True


def _handle_signal(signum: int, frame: FrameType | None) -> None:
    global _running
    _running = False


def _close_quietly(obj: object) -> None:
    """Best-effort resource release: camera/mute backends may define
    close() (LinuxCamera/LinuxMuteSwitch do; sim backends don't need to),
    so this is duck-typed rather than part of the Camera/MuteSwitch
    protocols. A close() failure must never mask whatever's already being
    handled by the caller (an exception mid-loop, a clean shutdown, a
    partial-construction rollback), so it's logged, not raised.
    """
    close = getattr(obj, "close", None)
    if close is None:
        return
    try:
        close()
    except Exception as exc:  # noqa: BLE001 - cleanup must never raise past this point
        print(f"[edge] warning: {type(obj).__name__}.close() failed: {exc}", file=sys.stderr)


def _build_backend() -> tuple[Camera, MuteSwitch, FaceDetector]:
    backend = os.environ.get("SAVEPOINT_EDGE_BACKEND", "sim")

    if backend == "linux":
        # Deferred import: only touches picamera2/gpiozero/onnxruntime when
        # this branch is actually selected (see module docstring).
        from savepoint_edge.backends.linux.linux_camera import LinuxCamera
        from savepoint_edge.backends.linux.linux_face_detector import LinuxFaceDetector
        from savepoint_edge.backends.linux.linux_mute_switch import LinuxMuteSwitch

        print("[edge] running LINUX backend (real hardware)", file=sys.stderr)
        model_path = os.environ.get("SAVEPOINT_EDGE_FACE_MODEL", "")
        embed_model_path = os.environ.get("SAVEPOINT_EDGE_FACE_EMBED_MODEL", "")

        # Built one at a time with rollback on partial failure: e.g. if the
        # camera and mute switch both claim hardware successfully but the
        # face detector then fails to load its model, the already-claimed
        # camera/GPIO must be released here — main() never gets a handle to
        # them to clean up otherwise.
        built: list[object] = []
        try:
            camera = LinuxCamera()
            built.append(camera)
            mute = LinuxMuteSwitch()
            built.append(mute)
            detector = LinuxFaceDetector(model_path, embed_model_path)
            return camera, mute, detector
        except Exception:
            for obj in reversed(built):
                _close_quietly(obj)
            raise

    if backend != "sim":
        print(f"[edge] unknown SAVEPOINT_EDGE_BACKEND={backend!r}, falling back to sim",
              file=sys.stderr)

    from savepoint_edge.backends.sim.sim_camera import SimCamera
    from savepoint_edge.backends.sim.sim_face_detector import SimFaceDetector
    from savepoint_edge.backends.sim.sim_mute_switch import SimMuteSwitch

    print("[edge] running SIM backend (no hardware) — see edge/README.md", file=sys.stderr)
    return SimCamera(), SimMuteSwitch(), SimFaceDetector()


def _build_sink_from_env() -> EventSink:
    """SAVEPOINT_EDGE_SINK selects where events go:
    (unset) / "stdout"   -> one JSON line per event on stdout (default)
    "file:<path>"        -> append newline-delimited JSON to <path>
    "http://host:port/…" -> POST each event's JSON as the request body
    """
    spec = os.environ.get("SAVEPOINT_EDGE_SINK", "stdout")

    if spec == "stdout":
        return StdoutSink()
    if spec.startswith("file:"):
        return FileSink(spec[len("file:") :])
    if spec.startswith("http://") or spec.startswith("https://"):
        return HttpSink(spec)

    print(f"[edge] unknown SAVEPOINT_EDGE_SINK={spec!r}, falling back to stdout", file=sys.stderr)
    return StdoutSink()


def main() -> int:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        camera, mute, detector = _build_backend()
    except Exception as exc:  # noqa: BLE001 - top-level: report and exit cleanly
        print(f"[edge] fatal: failed to initialize backend: {exc}", file=sys.stderr)
        return 1

    sink = _build_sink_from_env()
    identity_gallery = IdentityGallery()

    # try/finally, not just the loop: an exception escaping the loop body
    # (a real bug, not a sink failure — sinks already catch their own) must
    # still turn the LED off and release the camera/GPIO before the process
    # exits, same as a clean SIGINT/SIGTERM shutdown does. This does NOT
    # swallow such exceptions — a genuine bug (e.g. an unimplemented
    # detect()) still surfaces and still ends the process; it just
    # guarantees cleanup runs first, on every exit path.
    try:
        while _running:
            if mute.is_muted():
                mute.set_recording_led(False)
                time.sleep(_TICK_S)
                continue
            mute.set_recording_led(True)

            frame = camera.capture_frame()
            if frame is None:
                print("[edge] capture_frame() returned no frame", file=sys.stderr)
                time.sleep(_TICK_S)
                continue

            for face in detector.detect(frame):
                bbox = (face.x, face.y, face.w, face.h)
                resolution = identity_gallery.resolve(
                    face.embedding, bbox, frame.timestamp_ms
                )
                # Only upload a person once their presence is confirmed —
                # i.e. exactly on the tick they cross the persistence bar
                # (IdentityGallery). A momentary flicker (a one-frame false
                # positive, or someone crossing the far background for an
                # instant) never reaches that bar and so never emits; a
                # sustained presence emits exactly once. Everything else in
                # the loop (LED, mute) still runs regardless.
                if not resolution.newly_confirmed:
                    continue
                event = EdgeEvent(
                    ts_unix_ms=frame.timestamp_ms,
                    local_id=resolution.local_id,
                    type="seen",
                    avatar_params=compute_avatar_params(face.embedding),
                    face_embedding=face.embedding,
                )
                if not sink.publish(event):
                    print(f"[edge] sink.publish() failed for local_id={event.local_id}",
                          file=sys.stderr)

            time.sleep(_TICK_S)
    finally:
        mute.set_recording_led(False)
        _close_quietly(camera)
        _close_quietly(mute)
        print("[edge] shutting down", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
