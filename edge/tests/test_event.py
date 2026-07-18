import json
import sys
from pathlib import Path

import pytest

from savepoint_edge.event import serialize_edge_event
from savepoint_edge.types import AvatarParams, EdgeEvent

_EDGE_AVATAR_PARAM_FIELDS = {
    "skin_tone",
    "hair_color",
    "hair_style",
    "glasses",
    "hat",
    "shirt_color",
}


def _sample_event() -> EdgeEvent:
    return EdgeEvent(
        ts_unix_ms=1752835200000,
        local_id="edge-deadbeef",
        type="seen",
        avatar_params=AvatarParams(
            skin_tone="tan",
            hair_color="brown",
            hair_style="short",
            glasses=True,
            hat=None,
            shirt_color="blue",
        ),
        face_embedding=None,
        place="hackathon",
    )


def test_serializes_valid_json():
    payload = json.loads(serialize_edge_event(_sample_event()))
    assert payload["local_id"] == "edge-deadbeef"
    assert payload["type"] == "seen"
    assert payload["avatar_params"]["skin_tone"] == "tan"
    assert payload["avatar_params"]["glasses"] is True
    assert payload["avatar_params"]["hat"] is None
    assert payload["place"] == "hackathon"
    assert payload["face_embedding"] is None
    assert payload["schema_version"] == "savepoint.edge.v1"


def test_field_names_match_hardcoded_avatar_params_set():
    # Baseline check independent of server/ being importable — see
    # test_field_names_match_server_avatar_params below for the real
    # cross-check against server's actual model.
    payload = json.loads(serialize_edge_event(_sample_event()))
    assert set(payload["avatar_params"].keys()) == _EDGE_AVATAR_PARAM_FIELDS


def test_field_names_match_server_avatar_params():
    # edge/ has no runtime or pyproject.toml dependency on server/ (they're
    # independently deployed — edge on the Pi, server wherever the backend
    # runs), so this reaches across the repo only for this one test, and
    # only when server/'s own deps (pydantic) happen to be importable in
    # this environment — skipping rather than failing when they're not, so
    # this doesn't become a hard coupling. When it CAN run, it's the real
    # cross-check: a field rename on either side fails this test instead of
    # silently diverging until a server-side validation error at runtime.
    server_src = Path(__file__).resolve().parents[2] / "server" / "src"
    sys.path.insert(0, str(server_src))
    try:
        from savepoint_server.models.person import AvatarParams as ServerAvatarParams
    except ImportError:
        pytest.skip(
            "server/'s package (or its deps, e.g. pydantic) isn't importable from "
            "this environment — install server/'s deps to run this cross-check for real."
        )
    finally:
        sys.path.remove(str(server_src))

    server_fields = set(ServerAvatarParams.model_fields.keys())
    assert server_fields == _EDGE_AVATAR_PARAM_FIELDS, (
        f"edge's AvatarParams fields {_EDGE_AVATAR_PARAM_FIELDS} no longer match "
        f"server's {server_fields} — update one side to match the other."
    )


def test_face_embedding_serializes_as_array_when_present():
    event = _sample_event()
    event.face_embedding = [0.1, 0.2, 0.3]
    payload = json.loads(serialize_edge_event(event))
    assert payload["face_embedding"] == [0.1, 0.2, 0.3]


def test_non_finite_float_raises_instead_of_emitting_invalid_json():
    # allow_nan=False (see event.py) — a bad float must fail loudly so the
    # caller's sink can catch it and return False, instead of silently
    # emitting the non-standard NaN/Infinity JSON tokens most parsers
    # (including the server's) reject.
    event = _sample_event()
    event.face_embedding = [float("nan")]
    with pytest.raises(ValueError):
        serialize_edge_event(event)
