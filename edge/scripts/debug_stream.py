"""Dev-only MJPEG debug viewer: camera + live SCRFD boxes in a browser.

Standalone — opens its own camera, so it can't run alongside the
`savepoint-edge` service (picamera2/libcamera only allow one owner at a
time). If the service is already running, prefer
`SAVEPOINT_EDGE_DEBUG_PORT` (see main.py) instead: same view, in-process,
no camera contention. This script is still useful before the service
exists at all (initial camera bring-up on a fresh Pi).

Run it, then open http://<pi-tailscale-ip>:8090/ from any browser on the
tailnet.

Usage:
    SAVEPOINT_EDGE_FACE_MODEL=models/det_2.5g.onnx \\
    SAVEPOINT_EDGE_FACE_EMBED_MODEL=models/w600k_mbf.onnx \\
    uv run python scripts/debug_stream.py
"""

from __future__ import annotations

import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from savepoint_edge.backends.linux.linux_camera import LinuxCamera
from savepoint_edge.backends.linux.linux_face_detector import LinuxFaceDetector
from savepoint_edge.debug_view import IdentityLabels, annotated_jpeg
from savepoint_edge.identity_gallery import IdentityGallery

_PORT = 8090
# Matches LinuxCamera's own default — see that module's docstring for why
# 640x480 measurably hurt embedding quality on real hardware.
_SIZE = (1280, 960)


def _make_handler(
    camera: LinuxCamera,
    detector: LinuxFaceDetector,
    gallery: IdentityGallery,
    labels: IdentityLabels,
) -> type[BaseHTTPRequestHandler]:
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
                    frame = camera.capture_frame()
                    if frame is None:
                        continue
                    faces = detector.detect(frame)
                    jpeg = annotated_jpeg(frame, faces, gallery, labels)
                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                    self.wfile.write(jpeg)
                    self.wfile.write(b"\r\n")
                    # No extra sleep — detect()+embed() (~100-200ms/frame on
                    # Pi 5) already paces the loop; an added delay on top of
                    # that just makes the stream feel slower than it is.
            except (BrokenPipeError, ConnectionResetError):
                pass  # client closed the tab — not an error

        def log_message(self, fmt: str, *args: object) -> None:
            pass  # quiet: this is a dev tool, not a service to monitor

    return Handler


def main() -> int:
    model_path = os.environ.get("SAVEPOINT_EDGE_FACE_MODEL", "")
    embed_model_path = os.environ.get("SAVEPOINT_EDGE_FACE_EMBED_MODEL", "")
    camera = LinuxCamera(size=_SIZE)
    detector = LinuxFaceDetector(model_path, embed_model_path)
    gallery = IdentityGallery()
    labels = IdentityLabels()

    server = ThreadingHTTPServer(
        ("0.0.0.0", _PORT), _make_handler(camera, detector, gallery, labels)
    )
    print(f"[debug_stream] serving on http://0.0.0.0:{_PORT}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        camera.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
