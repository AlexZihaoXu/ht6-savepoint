"""HttpSink posts to the server's /ingest/video route as a JSON array.

The server accepts ``list[EdgeEvent]`` at ``POST /ingest/video`` (PR #19), so
the sink must send a JSON ARRAY, not a bare object (a bare object would 422).
No real network: ``urlopen`` is monkeypatched.
"""

from __future__ import annotations

import json
import math
import urllib.error
from dataclasses import replace

from savepoint_edge.sinks import http_sink
from savepoint_edge.sinks.http_sink import HttpSink
from savepoint_edge.types import AvatarParams, EdgeEvent


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
        face_embedding=[0.1, 0.2, 0.3],
        place="hackathon",
    )


class _FakeResponse:
    def __init__(self, status: int = 200) -> None:
        self.status = status

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def test_publish_posts_a_json_array(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        captured["content_type"] = request.headers.get("Content-type")
        captured["body"] = request.data
        return _FakeResponse(200)

    monkeypatch.setattr(http_sink.urllib.request, "urlopen", fake_urlopen)

    sink = HttpSink("http://100.64.151.86:8000/ingest/video")
    assert sink.publish(_sample_event()) is True

    assert captured["method"] == "POST"
    assert captured["content_type"] == "application/json"
    assert captured["url"] == "http://100.64.151.86:8000/ingest/video"

    body = json.loads(captured["body"])
    # The whole point: a LIST, not a bare object.
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["local_id"] == "edge-deadbeef"
    assert body[0]["type"] == "seen"
    assert body[0]["schema_version"] == "savepoint.edge.v1"


def test_publish_non_2xx_returns_false(monkeypatch) -> None:
    monkeypatch.setattr(
        http_sink.urllib.request, "urlopen", lambda request, timeout=None: _FakeResponse(500)
    )
    assert HttpSink("http://x/ingest/video").publish(_sample_event()) is False


def test_publish_network_error_returns_false_never_raises(monkeypatch) -> None:
    def boom(request, timeout=None):  # noqa: ANN001, ANN202
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(http_sink.urllib.request, "urlopen", boom)
    # Must not raise — a sink hiccup can't crash the capture loop.
    assert HttpSink("http://x/ingest/video").publish(_sample_event()) is False


def test_publish_bad_float_returns_false_no_request(monkeypatch) -> None:
    called = False

    def should_not_run(request, timeout=None):  # noqa: ANN001, ANN202
        nonlocal called
        called = True
        return _FakeResponse(200)

    monkeypatch.setattr(http_sink.urllib.request, "urlopen", should_not_run)
    bad = replace(_sample_event(), face_embedding=[0.1, math.nan, 0.3])
    # Non-finite float -> serialization returns None -> publish False, no POST.
    assert HttpSink("http://x/ingest/video").publish(bad) is False
    assert called is False
