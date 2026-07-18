"""Real face detection via ONNX Runtime — a normal, well-supported pip
package on Linux aarch64, so this can go further than a pure skeleton: the
constructor genuinely loads a model, which is real, testable value today —
point SAVEPOINT_EDGE_FACE_MODEL at any .onnx file and confirm it loads,
even before you're anywhere near a Pi.

What's NOT implemented is detect() itself. DESIGN.md §7 names SCRFD/
BlazeFace (detection) + MobileFaceNet (embedding) but no model file ships
with this repo, and each model's exact output tensor layout (anchor
decoding, NMS thresholds, how many outputs, embedding-pass wiring) depends
entirely on how *you* export it. Writing speculative pre/post-processing
against an unknown export would be worse than useless — it would silently
produce garbage detections that look like they work. Implement detect()
once you have a real exported model to test against.
"""

from __future__ import annotations

import onnxruntime as ort

from savepoint_edge.types import DetectedFace, Frame


class LinuxFaceDetector:
    def __init__(self, model_path: str) -> None:
        if not model_path:
            raise ValueError(
                "SAVEPOINT_EDGE_FACE_MODEL is not set — point it at an .onnx file "
                "(see this module's docstring)."
            )
        self._session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self._input_name = self._session.get_inputs()[0].name

    def detect(self, frame: Frame) -> list[DetectedFace]:
        raise NotImplementedError(
            "LinuxFaceDetector.detect() is not implemented — see this module's "
            "docstring. The ONNX Runtime session above (self._session) does load "
            "for real; only the model-specific pre/post-processing is missing."
        )
