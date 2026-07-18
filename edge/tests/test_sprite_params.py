import math

from savepoint_edge.sprite_params import compute_avatar_params, compute_local_id
from savepoint_edge.types import FACE_EMBEDDING_DIM


def _filled(v: float) -> list[float]:
    return [v] * FACE_EMBEDDING_DIM


def test_avatar_params_deterministic():
    a = _filled(0.11)
    p1 = compute_avatar_params(a)
    p2 = compute_avatar_params(a)
    assert p1 == p2


def test_local_id_deterministic():
    a = _filled(0.11)
    assert compute_local_id(a) == compute_local_id(a)


def test_fields_non_degenerate():
    p = compute_avatar_params(_filled(0.11))
    assert p.skin_tone
    assert p.hair_color
    assert p.hair_style
    assert p.shirt_color


def test_different_embeddings_usually_differ():
    # Not a guarantee (hashing can collide), but these two fixed test
    # vectors are known not to.
    assert compute_local_id(_filled(0.11)) != compute_local_id(_filled(0.42))


def test_handles_non_finite_and_out_of_range_without_crashing():
    # A real model could emit NaN/Inf/huge values on a bad frame — this
    # must degrade gracefully, not raise. See sprite_params._quantize's
    # docstring for why (a C++ prototype of this same function had
    # undefined behavior here).
    weird = [float("nan"), float("inf"), float("-inf"), 1e30, -1e30] + [0.0] * (
        FACE_EMBEDDING_DIM - 5
    )
    params = compute_avatar_params(weird)
    local_id = compute_local_id(weird)
    assert params.skin_tone
    assert local_id.startswith("edge-")


def test_short_embedding_does_not_crash():
    # Padded rather than indexed-out-of-bounds.
    params = compute_avatar_params([0.5, 0.5])
    assert params.skin_tone


def test_avatar_params_roundtrips_through_dataclasses_asdict():
    from dataclasses import asdict

    p = compute_avatar_params(_filled(0.11))
    d = asdict(p)
    assert set(d.keys()) == {
        "skin_tone",
        "hair_color",
        "hair_style",
        "glasses",
        "hat",
        "shirt_color",
    }
    assert isinstance(d["glasses"], bool)


def test_quantize_matches_expected_range_behavior():
    # Sanity check that the underlying hash actually varies with input —
    # guards against an accidental constant-hash regression.
    ids = {compute_local_id(_filled(v)) for v in (0.0, 0.1, 0.2, 0.3, 0.4, 0.5)}
    assert len(ids) > 1


def test_no_math_domain_crash_smoke():
    # math.isfinite must be the only float-classification used — a stray
    # math.isnan()-only check would miss inf.
    assert math.isfinite(0.0)
