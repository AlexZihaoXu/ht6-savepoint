"""Deterministic embedding -> AvatarParams / local_id mapping.

Deterministic: the same embedding always produces the same AvatarParams and
the same local_id (DESIGN.md §7 — "the same person always maps to the same
sprite"). No ML here, just a stable hash -> token-list lookup.

Uses a hand-rolled FNV-1a instead of Python's builtin hash(): builtin
hash() is randomized per-process for str/bytes (PYTHONHASHSEED), so the
same embedding would hash differently across restarts — breaking the
"same person -> same sprite" guarantee across process restarts, not just
within one run.
"""

from __future__ import annotations

import math
import struct

from savepoint_edge.types import FACE_EMBEDDING_DIM, AvatarParams

_FNV_OFFSET_BASIS = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_MASK_64 = (1 << 64) - 1

# PROVISIONAL token lists — placeholders until a real layered sprite kit
# exists (see types.py's AvatarParams docstring). Pick whichever asset-name
# convention the sprite kit ends up using and swap these in; nothing else
# in this file needs to change.
_SKIN_TONES = ["fair", "tan", "olive", "brown", "deep"]
_HAIR_COLORS = ["black", "brown", "blonde", "red", "gray", "auburn"]
_HAIR_STYLES = ["short", "long", "buzzcut", "ponytail", "curly"]
_SHIRT_COLORS = ["red", "blue", "green", "yellow", "purple", "teal"]
_HATS = ["cap", "beanie", "none"]


def _fnv1a(data: bytes) -> int:
    h = _FNV_OFFSET_BASIS
    for byte in data:
        h ^= byte
        h = (h * _FNV_PRIME) & _MASK_64
    return h


def _quantize(value: float) -> int:
    """Clamp+quantize one embedding component to a stable int16 bucket.

    Coarse buckets absorb frame-to-frame jitter in a real model's raw float
    output, so the same face doesn't mint a new local_id every sighting
    (see compute_local_id's docstring). NaN/Inf/out-of-range values are
    clamped rather than trusted verbatim: a C++ prototype of this same
    function cast straight to int16_t with no guard, which is undefined
    behavior in C++ for out-of-range/non-finite input — Python has no UB,
    but `int(float('nan'))` still raises, so an unguarded version here would
    crash the whole capture loop on a single bad embedding component from a
    misbehaving model. Don't remove this guard when porting/changing this.
    """
    if not math.isfinite(value):
        return 0
    scaled = value * 100.0
    return int(max(-32768.0, min(32767.0, scaled)))


def _hash_embedding(embedding: list[float]) -> int:
    quantized = [_quantize(v) for v in embedding[:FACE_EMBEDDING_DIM]]
    # Pad short embeddings (e.g. a hand-built test vector) so hashing is
    # still well-defined rather than silently ignoring missing components.
    quantized += [0] * (FACE_EMBEDDING_DIM - len(quantized))
    packed = struct.pack(f"<{FACE_EMBEDDING_DIM}h", *quantized)
    return _fnv1a(packed)


def compute_avatar_params(embedding: list[float]) -> AvatarParams:
    h = _hash_embedding(embedding)

    hat = _HATS[(h >> 44) % len(_HATS)]
    return AvatarParams(
        skin_tone=_SKIN_TONES[h % len(_SKIN_TONES)],
        hair_color=_HAIR_COLORS[(h // len(_SKIN_TONES)) % len(_HAIR_COLORS)],
        hair_style=_HAIR_STYLES[
            (h // (len(_SKIN_TONES) * len(_HAIR_COLORS))) % len(_HAIR_STYLES)
        ],
        glasses=((h >> 40) & 0x7) == 0,  # ~1-in-8, arbitrary provisional rate
        hat=None if hat == "none" else hat,
        shirt_color=_SHIRT_COLORS[(h >> 32) % len(_SHIRT_COLORS)],
    )


def compute_local_id(embedding: list[float]) -> str:
    """A coarse, session-scoped identity heuristic: hashes the (quantized)
    embedding into a short id. This is NOT face re-identification — two
    photos of the same person taken far apart, or noisy embeddings from two
    frames of the same moment, can hash differently. Matches PLAN.md's
    cut-line #4 ("cross-day face re-ID -> session-scoped"): real identity
    resolution is server-side, matching by nearest embedding (DESIGN.md
    §9), once the server ingest endpoint that reads `face_embedding` exists.
    """
    h = _hash_embedding(embedding)
    return f"edge-{h:016x}"
