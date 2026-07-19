"""Optional in-process MJPEG debug view, sharing the capture loop's own
camera + detector instead of opening a second one.

picamera2/libcamera only allow one process to hold the camera at a time —
that's why `scripts/debug_stream.py` (a separate process) has to steal the
camera from the running `savepoint-edge` service. This module runs inside
that same process instead, on a background daemon thread, so there's only
ever one Camera/FaceDetector instance. It still needs its own `_lock`
(shared with main.py's loop) around every capture_frame()+detect() call:
picamera2's capture and onnxruntime's session aren't guaranteed safe to
drive from two threads at once, and serializing that one section is cheap
next to a ~150-380ms detect+embed call.

Uses its own IdentityGallery — NEVER the capture loop's real one. resolve()
mutates presence-tracking state on every call and this view polls far
faster than the loop's 0.5s tick; sharing the gallery would corrupt the
loop's own presence confirmation (double-counted sightings, clobbered
embeddings) as a side effect of someone just looking at a browser tab.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from savepoint_edge.debug_view import IdentityLabels, annotated_jpeg
from savepoint_edge.hal import Camera, FaceDetector
from savepoint_edge.identity_gallery import IdentityGallery


def _make_handler(
    camera: Camera,
    detector: FaceDetector,
    lock: threading.Lock,
) -> type[BaseHTTPRequestHandler]:
    gallery = IdentityGallery()
    labels = IdentityLabels()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/":
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while True:
                    with lock:
                        frame = camera.capture_frame()
                        faces = [] if frame is None else detector.detect(frame)
                    if frame is None:
                        continue
                    jpeg = annotated_jpeg(frame, faces, gallery, labels)
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
                    # No extra sleep — detect()+embed() already paces this
                    # (see module docstring); an added delay on top just
                    # holds `lock` for longer without benefit.
            except (BrokenPipeError, ConnectionResetError):
                pass  # client closed the tab — not an error

        def log_message(self, fmt: str, *args: object) -> None:
            pass  # quiet: this is a dev tool, not a service to monitor

    return Handler


def start_debug_server(
    camera: Camera,
    detector: FaceDetector,
    lock: threading.Lock,
    port: int,
) -> ThreadingHTTPServer:
    """Starts serving immediately on a background daemon thread and returns
    the server (mainly so callers/tests can call .shutdown() on it)."""
    server = ThreadingHTTPServer(("0.0.0.0", port), _make_handler(camera, detector, lock))
    thread = threading.Thread(target=server.serve_forever, name="debug-server", daemon=True)
    thread.start()
    return server
