"""Session-scoped identity matching + presence confirmation.

Two jobs, both stateful and per-process:

A) Give the same physical face a stable local_id across frames, instead of
   re-hashing (and thus re-minting a new id) every single sighting.
   compute_local_id() alone (sprite_params.py) is a pure per-embedding hash
   — by design, per its own docstring, "noisy embeddings from two frames of
   the same moment[...] can hash differently" — so calling it fresh every
   frame makes one person flicker between ids tick to tick. resolve()
   matches each detection to an existing track in two passes:

   1. **Spatial continuity first**: if the detection's bbox overlaps
      (IoU >= _IOU_THRESHOLD) a track seen within the last _MAX_TRACK_AGE_MS,
      reuse that track's id outright — no embedding check. A face turning to
      profile mid-track produces an embedding that can legitimately fall
      below any "same person" cosine threshold (ArcFace-family models are
      trained overwhelmingly on frontal faces), yet it obviously hasn't
      teleported — only turned. Box continuity is a cheap,
      embedding-independent signal for exactly that case.
   2. **Cosine similarity fallback**: nothing overlaps (reappearing after
      leaving frame, or the first sighting) -> match by embedding similarity.
   3. Else mint a fresh local_id.

B) Decide when a track has been present *long enough to be worth uploading*
   (PLAN.md: this is a "who you actually spent time with today" log, not a
   raw detection firehose). A momentary blip — a one-frame false positive,
   or someone crossing the far background for an instant — must NOT produce
   an event. A track is only **confirmed** once it has been seen in
   >= _MIN_SIGHTINGS frames spanning >= min_presence_ms of real capture
   time; resolve() reports the exact tick a track crosses that bar
   (`newly_confirmed`) so the caller can emit one event then and not before.
   Emitting on that single transition (rather than every tick while present)
   also stops one long conversation from minting hundreds of duplicate
   "seen" events; if the person leaves (track expires) and returns, a fresh
   track forms and re-confirms — correctly logging that you saw them again.

Trade-off worth naming: spatial matching alone can't tell apart two
different people who overlap at similar frame positions across ticks (rare
in the small scenes this targets) — accepted because the failure it fixes
(one person fragmenting into many ids on every head turn) was the reported,
reproducing problem, while the failure it risks (two overlapping strangers
merged) was never observed and matters far less to "who was around today".

Deliberately in-memory / per-process only — the "session-scoped" half of
PLAN.md's cut-line #4. Cross-session/cross-day identity is server-side, by
nearest-embedding against persisted `people` (DESIGN.md §9), once the
ingest endpoint that reads `face_embedding` exists — this class neither
persists nor should.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

from savepoint_edge.sprite_params import compute_local_id

# ArcFace-family embeddings (this project's w600k_mbf, see
# linux_face_detector.py) are L2-normalized. w600k_mbf specifically is the
# MobileFaceNet-family backbone — the weakest verification accuracy in the
# whole insightface lineup (LFW/IJB-C numbers consistently trail the
# ResNet50/R100-family models) — so its genuine same-person cosine scores
# run lower than a bigger backbone's. insightface's own guide quotes
# 0.30-0.45 depending on backbone; community demos/production apps
# converge closer to ~0.35-0.4 for MobileFaceNet specifically (0.45 sits
# at the strict end of even the bigger-model range). Real users of larger
# backbones (e.g. Immich, running the bigger w600k_r50) report needing to
# loosen this same knob to stop the same person splitting into multiple
# identities — the exact symptom that motivated dropping this value.
_SIMILARITY_THRESHOLD = 0.35

# A face box overlapping this much with a recent track is treated as the
# same physical face continuing to be tracked, regardless of embedding
# similarity. 0.3 tolerates normal frame-to-frame jitter/motion without
# being so loose that two adjacent-but-distinct faces would count.
_IOU_THRESHOLD = 0.3

# How long a track survives with no matching detection before it stops
# counting for spatial continuity (it can still be re-matched by embedding
# after this, just not "for free" via position alone). 3s comfortably
# covers "turned away and back" without bridging "left and a different
# person walked into the same spot minutes later".
_MAX_TRACK_AGE_MS = 3000

# Presence confirmation (job B above): a track must be seen in at least this
# many frames AND span at least min_presence_ms of capture time before it's
# confirmed and its (single) event is allowed to upload. The frame-count
# guard kills a 1-2 frame flicker even if two stray sightings happen to
# straddle the time window; the time guard makes "long enough" mean real
# seconds, independent of frame rate. Presence time is env-tunable.
_MIN_SIGHTINGS = 3
_MIN_PRESENCE_MS = int(os.environ.get("SAVEPOINT_EDGE_MIN_PRESENCE_MS", "1000"))


@dataclass
class Resolution:
    """Outcome of resolving one detection to a session identity."""

    local_id: str
    # Has this track met the presence bar (this tick or an earlier one)?
    confirmed: bool
    # True ONLY on the single tick the track first crosses the bar — the
    # caller emits its event here and nowhere else, so flickers never upload
    # and a sustained presence uploads exactly once.
    newly_confirmed: bool


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    norm_a = math.sqrt(sum(v * v for v in a[:n]))
    norm_b = math.sqrt(sum(v * v for v in b[:n]))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """IoU of two (x, y, w, h) boxes in the same (e.g. normalized) units."""
    ax1, ay1, ax2, ay2 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


@dataclass
class _Track:
    local_id: str
    embedding: list[float]
    bbox: tuple[float, float, float, float]
    first_seen_ms: int
    last_seen_ms: int
    sightings: int
    confirmed: bool


class IdentityGallery:
    def __init__(
        self,
        similarity_threshold: float = _SIMILARITY_THRESHOLD,
        iou_threshold: float = _IOU_THRESHOLD,
        max_track_age_ms: int = _MAX_TRACK_AGE_MS,
        min_presence_ms: int = _MIN_PRESENCE_MS,
        min_sightings: int = _MIN_SIGHTINGS,
    ) -> None:
        self._threshold = similarity_threshold
        self._iou_threshold = iou_threshold
        self._max_track_age_ms = max_track_age_ms
        self._min_presence_ms = min_presence_ms
        self._min_sightings = min_sightings
        self._tracks: list[_Track] = []

    def resolve(
        self,
        embedding: list[float],
        bbox: tuple[float, float, float, float],
        timestamp_ms: int,
    ) -> Resolution:
        """Match this detection to a session identity and report its
        presence-confirmation state. `bbox` is (x, y, w, h) in the same
        normalized units as DetectedFace; `timestamp_ms` should be the
        source frame's timestamp so aging/presence are measured in real
        capture time, not wall-clock call time."""
        live_tracks = [
            t for t in self._tracks if timestamp_ms - t.last_seen_ms <= self._max_track_age_ms
        ]
        self._tracks = live_tracks

        spatial_match = max(
            (t for t in live_tracks),
            key=lambda t: _iou(bbox, t.bbox),
            default=None,
        )
        if spatial_match is not None and _iou(bbox, spatial_match.bbox) >= self._iou_threshold:
            return self._touch(spatial_match, embedding, bbox, timestamp_ms)

        embedding_match = max(
            (t for t in live_tracks),
            key=lambda t: _cosine_similarity(embedding, t.embedding),
            default=None,
        )
        if (
            embedding_match is not None
            and _cosine_similarity(embedding, embedding_match.embedding) >= self._threshold
        ):
            return self._touch(embedding_match, embedding, bbox, timestamp_ms)

        new_id = compute_local_id(embedding)
        live_tracks.append(
            _Track(
                local_id=new_id,
                embedding=embedding,
                bbox=bbox,
                first_seen_ms=timestamp_ms,
                last_seen_ms=timestamp_ms,
                sightings=1,
                confirmed=False,
            )
        )
        # A brand-new track is a single sighting — never confirmed yet, so it
        # cannot upload. That's the flicker filter: a one-frame blip dies here.
        return Resolution(local_id=new_id, confirmed=False, newly_confirmed=False)

    def _touch(
        self,
        track: _Track,
        embedding: list[float],
        bbox: tuple[float, float, float, float],
        timestamp_ms: int,
    ) -> Resolution:
        """Update a matched track with this sighting and compute whether it
        just crossed the presence bar."""
        track.embedding = embedding
        track.bbox = bbox
        track.last_seen_ms = timestamp_ms
        track.sightings += 1

        newly_confirmed = False
        if not track.confirmed:
            span_ms = track.last_seen_ms - track.first_seen_ms
            if track.sightings >= self._min_sightings and span_ms >= self._min_presence_ms:
                track.confirmed = True
                newly_confirmed = True
        return Resolution(
            local_id=track.local_id, confirmed=track.confirmed, newly_confirmed=newly_confirmed
        )

    def __len__(self) -> int:
        """Count of distinct identities currently tracked — test/debug hook."""
        return len(self._tracks)
