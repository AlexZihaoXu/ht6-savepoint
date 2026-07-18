from savepoint_edge.identity_gallery import IdentityGallery
from savepoint_edge.types import FACE_EMBEDDING_DIM

_HERE = (0.3, 0.3, 0.2, 0.3)
_ELSEWHERE = (0.7, 0.1, 0.15, 0.2)


def _vector(seed: float) -> list[float]:
    return [((seed + i * 0.37) % 1.0) - 0.5 for i in range(FACE_EMBEDDING_DIM)]


def _jittered(seed: float, amount: float) -> list[float]:
    base = _vector(seed)
    return [v + (amount if i % 2 == 0 else -amount) for i, v in enumerate(base)]


def _gallery(**kw: object) -> IdentityGallery:
    # Default the persistence knobs low so identity-matching tests don't have
    # to model time; the confirmation tests set them explicitly.
    kw.setdefault("min_presence_ms", 0)
    kw.setdefault("min_sightings", 1)
    return IdentityGallery(**kw)  # type: ignore[arg-type]


# --- identity matching -----------------------------------------------------


def test_same_embedding_reuses_id():
    g = _gallery()
    a = _vector(0.11)
    assert g.resolve(a, _HERE, 0).local_id == g.resolve(a, _HERE, 100).local_id


def test_slightly_noisy_embedding_reuses_id():
    # Two frames of the same real person: same direction, small jitter — the
    # case compute_local_id alone gets wrong.
    g = _gallery()
    first = g.resolve(_vector(0.11), _HERE, 0).local_id
    second = g.resolve(_jittered(0.11, 0.01), _HERE, 100).local_id
    assert first == second


def test_different_people_get_different_ids():
    g = _gallery()
    a = g.resolve(_vector(0.11), _HERE, 0).local_id
    b = g.resolve(_vector(0.77), _ELSEWHERE, 0).local_id
    assert a != b


def test_overlapping_bbox_reuses_id_even_with_dissimilar_embedding():
    # A face turning to profile: embedding misses the cosine threshold, but
    # the box hasn't teleported — same person, same id.
    g = _gallery()
    frontal = g.resolve(_vector(0.11), _HERE, 0).local_id
    profile_bbox = (0.31, 0.29, 0.2, 0.3)
    profile = g.resolve(_vector(0.99), profile_bbox, 100).local_id
    assert frontal == profile


def test_non_overlapping_bbox_falls_back_to_embedding_matching():
    g = _gallery()
    a = g.resolve(_vector(0.11), _HERE, 0).local_id
    b = g.resolve(_vector(0.11), _ELSEWHERE, 100).local_id
    assert a == b


def test_stale_track_does_not_grant_spatial_continuity():
    g = _gallery(max_track_age_ms=1000)
    first = g.resolve(_vector(0.11), _HERE, 0).local_id
    second = g.resolve(_vector(0.99), _HERE, 5000).local_id
    assert first != second


def test_gallery_grows_only_on_new_identity():
    g = _gallery()
    g.resolve(_vector(0.11), _HERE, 0)
    g.resolve(_jittered(0.11, 0.01), _HERE, 100)  # same person again
    g.resolve(_vector(0.77), _ELSEWHERE, 100)  # a genuinely new person
    assert len(g) == 2


def test_empty_embedding_does_not_crash():
    g = _gallery()
    assert g.resolve([], _HERE, 0).local_id.startswith("edge-")


# --- presence confirmation (flicker filter) --------------------------------


def test_single_flicker_never_confirms():
    # One-frame blip: appears once, never seen again -> never uploads.
    g = IdentityGallery(min_presence_ms=1000, min_sightings=3)
    res = g.resolve(_vector(0.11), _HERE, 0)
    assert not res.confirmed
    assert not res.newly_confirmed


def test_two_sightings_spanning_window_still_not_confirmed():
    # Guards against confirming on a stray pair that merely straddles the
    # time window: 2 sightings 1200ms apart still fails the >=3 frame bar.
    g = IdentityGallery(min_presence_ms=1000, min_sightings=3)
    g.resolve(_vector(0.11), _HERE, 0)
    res = g.resolve(_vector(0.11), _HERE, 1200)
    assert not res.confirmed


def test_sustained_presence_confirms_exactly_once():
    g = IdentityGallery(min_presence_ms=1000, min_sightings=3)
    emb = _vector(0.11)
    r0 = g.resolve(emb, _HERE, 0)  # sighting 1
    r1 = g.resolve(emb, _HERE, 500)  # sighting 2, span 500 < 1000
    r2 = g.resolve(emb, _HERE, 1000)  # sighting 3, span 1000 -> confirm
    r3 = g.resolve(emb, _HERE, 1500)  # already confirmed
    assert (r0.newly_confirmed, r1.newly_confirmed) == (False, False)
    assert r2.newly_confirmed is True
    assert r2.confirmed is True
    # newly_confirmed fires on exactly one tick; later ticks stay confirmed
    # but do NOT re-fire, so a long presence uploads once, not every frame.
    assert r3.newly_confirmed is False
    assert r3.confirmed is True


def test_reappearance_after_expiry_confirms_again():
    # Leave (track expires) then return -> a fresh track that re-confirms,
    # correctly logging that you saw them again later.
    g = IdentityGallery(min_presence_ms=1000, min_sightings=2, max_track_age_ms=2000)
    emb = _vector(0.11)
    g.resolve(emb, _HERE, 0)
    first_confirm = g.resolve(emb, _HERE, 1000)
    assert first_confirm.newly_confirmed is True
    # Gone long enough that the track expires...
    g.resolve(emb, _HERE, 10_000)  # new track, sighting 1
    second_confirm = g.resolve(emb, _HERE, 11_000)  # sighting 2 -> re-confirm
    assert second_confirm.newly_confirmed is True
