"""M1 gate e2e: a frame + an audio clip -> Person + Events + Day in Mongo (SAV-30/SAV-35).

This is the milestone test that proves the whole ingest chain lands in Mongo:
feed a camera frame and a recording and you get deterministic sprite params
persisted on a Person, the diarized transcript persisted as SPOKE Events tied to
the day, and the Day upserted with its summary.

Everything is CI-safe and torch-free: the frame is generated in-code with
NumPy/Pillow (a synthetic image, so vision uses its whole-image fallback) and the
audio goes through the default StubTranscriber (a tc1-derived canned transcript).
Persistence is checked against the real test Mongo via the ``repos`` fixture.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from io import BytesIO
from pathlib import Path

import numpy as np
from httpx import ASGITransport, AsyncClient
from PIL import Image

from savepoint_server.api.ingest import get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import EventType, Transcript
from savepoint_server.services.ingest import (
    IngestResult,
    avatar_from_sprite,
    derive_person_id,
    ingest_day,
)
from savepoint_server.services.speech import StubTranscriber
from savepoint_server.services.vision import frame_to_sprite_params

# The stub transcript is tc1-derived; the identical reference lives under fixtures/.
FIXTURE = Path(__file__).parent / "fixtures" / "tc1_stub.json"
DAY_ID = "2026-07-18"


def _expected_transcript() -> Transcript:
    return Transcript.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def _solid_png(color: tuple[int, int, int], size: tuple[int, int] = (128, 128)) -> bytes:
    """Return PNG bytes for a solid-colour image (a synthetic, faceless frame)."""
    width, height = size
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, :] = color
    buf = BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    return buf.getvalue()


async def test_ingest_day_persists_full_path(repos: Repositories) -> None:
    """The M1 gate: frame + audio -> Person(sprite) + Events + Day, all in Mongo."""
    frame = _solid_png((150, 120, 100))
    expected_sprite = frame_to_sprite_params(frame)
    expected_local_id = derive_person_id(expected_sprite)
    expected_avatar = avatar_from_sprite(expected_sprite)
    expected = _expected_transcript()

    result = await ingest_day(
        frame, b"fake audio bytes", day_id=DAY_ID, repos=repos, transcriber=StubTranscriber()
    )
    assert isinstance(result, IngestResult)

    # --- Person: exists in Mongo, carries the deterministic sprite params. ---
    assert result.sprite == expected_sprite
    assert result.person.id == expected_local_id
    assert result.person.local_id == expected_local_id
    assert result.person.avatar_params == expected_avatar

    person_db = await repos.people.get_by_local_id(expected_local_id)
    assert person_db is not None
    assert person_db.avatar_params == expected_avatar
    # Sprite really mapped onto a filled-in avatar (non-empty kit selectors).
    assert person_db.avatar_params.skin_tone
    assert person_db.avatar_params.hair_color
    assert person_db.avatar_params.hair_style
    assert person_db.avatar_params.shirt_color
    assert person_db.first_seen is not None
    assert person_db.last_seen is not None

    # --- Events: exist in Mongo, right count/order/fields, tied to the day. ---
    assert len(result.events) == len(expected.segments) == 3
    assert all(e.id for e in result.events)

    events_db = await repos.events.list_for_day(DAY_ID)
    assert len(events_db) == 3
    # Stored in ascending timestamp order (day feeds read in spoken order).
    assert [e.ts for e in events_db] == sorted(e.ts for e in events_db)
    assert [e.person_id for e in events_db] == [s.speaker for s in expected.segments]
    assert [e.text for e in events_db] == [s.text for s in expected.segments]
    assert [e.start for e in events_db] == [s.start for s in expected.segments]
    assert [e.end for e in events_db] == [s.end for s in expected.segments]
    assert [e.overlap for e in events_db] == [s.overlap for s in expected.segments]
    assert all(e.type is EventType.SPOKE for e in events_db)
    assert all(e.day_id == DAY_ID for e in events_db)

    # --- Day: exists for the date, with a summary of the day's counts. ---
    day_db = await repos.days.get_by_date(date.fromisoformat(DAY_ID))
    assert day_db is not None
    assert day_db.id == DAY_ID
    assert day_db.date == date.fromisoformat(DAY_ID)
    assert day_db.summary is not None
    assert day_db.summary.events == 3
    # Two distinct diarization speakers + the one seen person = 3 people.
    assert day_db.summary.people == 3

    # The returned Day matches what is stored.
    assert result.day.id == DAY_ID
    assert result.day.summary == day_db.summary


async def test_ingest_day_is_deterministic(repos: Repositories) -> None:
    """Same frame -> same person id (upsert, one doc); distinct frame -> distinct id."""
    frame = _solid_png((150, 120, 100))
    expected_local_id = derive_person_id(frame_to_sprite_params(frame))

    first = await ingest_day(
        frame, b"audio a", day_id=DAY_ID, repos=repos, transcriber=StubTranscriber()
    )
    second = await ingest_day(
        frame, b"audio b", day_id=DAY_ID, repos=repos, transcriber=StubTranscriber()
    )

    # Same face resolves to the same document — upsert keeps exactly one Person.
    assert first.person.id == second.person.id == expected_local_id
    assert await repos.people.count() == 1

    # A visibly different frame yields a different seed and a different person.
    other = await ingest_day(
        _solid_png((20, 20, 20)),
        b"audio c",
        day_id=DAY_ID,
        repos=repos,
        transcriber=StubTranscriber(),
    )
    assert other.person.id != expected_local_id
    assert await repos.people.count() == 2


async def test_ingest_day_respects_person_key(repos: Repositories) -> None:
    """An explicit person_key overrides the face-derived id (stable across frames)."""
    result = await ingest_day(
        _solid_png((150, 120, 100)),
        b"fake audio",
        day_id=DAY_ID,
        repos=repos,
        person_key="alex",
        transcriber=StubTranscriber(),
    )
    assert result.person.id == "alex"
    assert await repos.people.get_by_local_id("alex") is not None


async def test_ingest_endpoint_persists_full_path(repos: Repositories) -> None:
    """POST /ingest runs the whole flow and persists Person + Events + Day."""
    app.dependency_overrides[get_repos] = lambda: repos
    frame = _solid_png((150, 120, 100))
    expected_local_id = derive_person_id(frame_to_sprite_params(frame))
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/ingest",
                files={
                    "frame": ("frame.png", frame, "image/png"),
                    "audio": ("clip.wav", b"fake audio bytes", "audio/wav"),
                },
                data={"day_id": DAY_ID},
            )
    finally:
        app.dependency_overrides.pop(get_repos, None)

    assert resp.status_code == 200
    result = IngestResult.model_validate(resp.json())
    assert result.person.id == expected_local_id
    assert len(result.events) == 3
    assert result.day.id == DAY_ID
    assert result.day.summary is not None
    assert result.day.summary.events == 3

    # The full path really landed in Mongo.
    assert await repos.people.get_by_local_id(expected_local_id) is not None
    assert await repos.events.count({"day_id": DAY_ID}) == 3
    day_db = await repos.days.get_by_date(date.fromisoformat(DAY_ID))
    assert day_db is not None
    assert day_db.summary is not None and day_db.summary.events == 3


async def test_ingest_endpoint_defaults_day_id_to_today(repos: Repositories) -> None:
    """Omitting day_id buckets the events (and the Day) under today's ISO date."""
    app.dependency_overrides[get_repos] = lambda: repos
    today = datetime.now(UTC).date().isoformat()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/ingest",
                files={
                    "frame": ("frame.png", _solid_png((150, 120, 100)), "image/png"),
                    "audio": ("clip.wav", b"fake audio bytes", "audio/wav"),
                },
            )
    finally:
        app.dependency_overrides.pop(get_repos, None)

    assert resp.status_code == 200
    assert resp.json()["day"]["_id"] == today
    assert await repos.events.count({"day_id": today}) == 3


async def _post_ingest(
    repos: Repositories,
    *,
    frame: tuple[str, bytes, str],
    data: dict[str, str] | None = None,
) -> int:
    """POST /ingest with the given frame upload + form data; return the status code."""
    app.dependency_overrides[get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            resp = await client.post(
                "/ingest",
                files={"frame": frame, "audio": ("clip.wav", b"fake audio bytes", "audio/wav")},
                data=data or {},
            )
    finally:
        app.dependency_overrides.pop(get_repos, None)
    return resp.status_code


async def test_ingest_endpoint_rejects_non_image_frame_with_400(repos: Repositories) -> None:
    """A text frame is not a decodable image -> clean 400, not a 500."""
    status = await _post_ingest(
        repos, frame=("notes.txt", b"this is not an image", "text/plain"), data={"day_id": DAY_ID}
    )
    assert status == 400


async def test_ingest_endpoint_rejects_empty_frame_with_400(repos: Repositories) -> None:
    """An empty frame upload can't be decoded -> clean 400, not a 500."""
    status = await _post_ingest(
        repos, frame=("empty.png", b"", "image/png"), data={"day_id": DAY_ID}
    )
    assert status == 400


async def test_ingest_endpoint_rejects_bad_day_id_with_400(repos: Repositories) -> None:
    """A malformed day_id is validated up front -> clean 400, not a 500."""
    frame = _solid_png((150, 120, 100))
    for bad in ("today", "2026-13-40", "18/07/2026"):
        status = await _post_ingest(
            repos, frame=("frame.png", frame, "image/png"), data={"day_id": bad}
        )
        assert status == 400, bad
