from savepoint_edge.debug_view import IdentityLabels, annotated_jpeg
from savepoint_edge.identity_gallery import IdentityGallery
from savepoint_edge.types import FACE_EMBEDDING_DIM, DetectedFace, Frame

_W, _H = 8, 6


def _blank_frame() -> Frame:
    return Frame(width=_W, height=_H, pixels=bytes(_W * _H * 3), timestamp_ms=0)


def _face(x: float, seed: float) -> DetectedFace:
    embedding = [((seed + i * 0.37) % 1.0) - 0.5 for i in range(FACE_EMBEDDING_DIM)]
    return DetectedFace(x=x, y=0.1, w=0.3, h=0.4, confidence=0.9, embedding=embedding)


def test_no_faces_still_produces_a_jpeg():
    jpeg = annotated_jpeg(_blank_frame(), [], IdentityGallery(), IdentityLabels())
    assert jpeg.startswith(b"\xff\xd8")  # JPEG magic bytes


def test_same_person_keeps_its_label_across_calls():
    gallery = IdentityGallery(min_sightings=1, min_presence_ms=0)
    labels = IdentityLabels()
    frame = _blank_frame()
    face = _face(0.1, 0.11)

    annotated_jpeg(frame, [face], gallery, labels)
    annotated_jpeg(frame, [face], gallery, labels)

    assert len(labels._assigned) == 1


def test_distinct_people_get_distinct_short_labels():
    gallery = IdentityGallery(min_sightings=1, min_presence_ms=0)
    labels = IdentityLabels()
    frame = _blank_frame()

    annotated_jpeg(frame, [_face(0.1, 0.11), _face(0.6, 0.91)], gallery, labels)
    short_labels = {short for short, _color in labels._assigned.values()}
    assert short_labels == {"P1", "P2"}
