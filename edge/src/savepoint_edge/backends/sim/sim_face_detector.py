"""Cycles through a small fixed set of synthetic "people" (distinct
embeddings) so the full capture->detect->sprite-params->event pipeline is
exercisable end-to-end without any real model or camera. Deterministic (no
randomness) so a test run is reproducible: call N produces the same
detections every time."""

from __future__ import annotations

from savepoint_edge.types import FACE_EMBEDDING_DIM, DetectedFace, Frame


def _make_mock_face(fill_value: float, confidence: float) -> DetectedFace:
    return DetectedFace(
        x=0.3,
        y=0.2,
        w=0.4,
        h=0.5,
        confidence=confidence,
        embedding=[fill_value] * FACE_EMBEDDING_DIM,
    )


class SimFaceDetector:
    def __init__(self) -> None:
        self._call_index = 0

    def detect(self, frame: Frame) -> list[DetectedFace]:
        # Every 3rd tick: nobody in frame (an empty result is a normal,
        # common case — main.py must handle it without emitting anything).
        cycle = self._call_index % 3
        self._call_index += 1
        if cycle == 0:
            return [_make_mock_face(0.11, 0.94)]
        if cycle == 1:
            return [_make_mock_face(0.42, 0.88), _make_mock_face(0.77, 0.81)]
        return []
