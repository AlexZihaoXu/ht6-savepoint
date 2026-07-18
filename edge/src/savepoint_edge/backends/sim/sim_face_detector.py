"""Cycles through a small fixed set of synthetic "people" (distinct
embeddings) so the full capture->detect->sprite-params->event pipeline is
exercisable end-to-end without any real model or camera. Deterministic (no
randomness) so a test run is reproducible: call N produces the same
detections every time."""

from __future__ import annotations

from savepoint_edge.types import FACE_EMBEDDING_DIM, DetectedFace, Frame


def _make_mock_face(x: float, seed: float, confidence: float) -> DetectedFace:
    # A uniform fill (e.g. [0.11] * N) is a pure scalar multiple of every
    # other uniform fill, so any two "different" mock people would be
    # perfectly collinear — and therefore identical under the real
    # pipeline's cosine-similarity identity matching (identity_gallery.py).
    # Vary the *pattern* per seed, not just the magnitude, so the synthetic
    # people stay distinguishable end to end.
    embedding = [((seed + i * 0.37) % 1.0) - 0.5 for i in range(FACE_EMBEDDING_DIM)]
    # Position also varies per mock person and is non-overlapping between
    # them (see the three x slots below) — IdentityGallery resolves by
    # spatial continuity before embedding similarity (identity_gallery.py),
    # so mock people sharing one hardcoded bbox would all get merged into a
    # single tracked identity regardless of how different their embeddings
    # are.
    return DetectedFace(
        x=x,
        y=0.2,
        w=0.2,
        h=0.4,
        confidence=confidence,
        embedding=embedding,
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
            return [_make_mock_face(0.05, 0.11, 0.94)]
        if cycle == 1:
            return [
                _make_mock_face(0.4, 0.42, 0.88),
                _make_mock_face(0.75, 0.77, 0.81),
            ]
        return []
