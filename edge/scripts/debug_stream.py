"""Dev-only MJPEG debug viewer: camera + live SCRFD boxes in a browser.

NOT part of the production capture loop (main.py) — this is a standalone
tool for visually sanity-checking the linux backend on real hardware
without a monitor attached to the Pi. Run it, then open
http://<pi-tailscale-ip>:8090/ from any browser on the tailnet.

Usage:
    SAVEPOINT_EDGE_FACE_MODEL=models/det_2.5g.onnx \\
    SAVEPOINT_EDGE_FACE_EMBED_MODEL=models/w600k_mbf.onnx \\
    uv run python scripts/debug_stream.py
"""

from __future__ import annotations

import io
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image, ImageDraw

from savepoint_edge.backends.linux.linux_camera import LinuxCamera
from savepoint_edge.backends.linux.linux_face_detector import LinuxFaceDetector
from savepoint_edge.identity_gallery import IdentityGallery

_PORT = 8090
# Matches LinuxCamera's own default — see that module's docstring for why
# 640x480 measurably hurt embedding quality on real hardware.
_SIZE = (1280, 960)

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


class _IdentityLabels:
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


def _annotated_jpeg(
    camera: LinuxCamera,
    detector: LinuxFaceDetector,
    gallery: IdentityGallery,
    labels: _IdentityLabels,
) -> bytes:
    frame = camera.capture_frame()
    arr_w, arr_h = frame.width, frame.height
    # Same BGR-labeled-as-RGB888 quirk as linux_face_detector.py — flip for
    # correct on-screen color, independent of the detector's own flip.
    arr = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(arr_h, arr_w, 3)[:, :, ::-1]
    img = Image.fromarray(arr)

    faces = detector.detect(frame)
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
        draw.text(
            (x1, max(0, y1 - 14)), f"{short_label} {tag} {face.confidence:.2f}", fill=color
        )

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def _make_handler(
    camera: LinuxCamera,
    detector: LinuxFaceDetector,
    gallery: IdentityGallery,
    labels: _IdentityLabels,
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
                    jpeg = _annotated_jpeg(camera, detector, gallery, labels)
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
    labels = _IdentityLabels()

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
