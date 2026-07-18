"""PixelLab sprite generator tests (SAV-61) — fully mocked, no network, no real gens.

Covers the pure prompt builder, RGBA decode, the generate -> save -> manifest flow
with a fake backend, the fire-and-forget ingest hook (fires only for a brand-new
Person, is gated on config, and NEVER propagates an error), default-off behavior,
the static ``/sprites`` mount, and ``Person.sprite`` flowing through the read API.
Everything uses small in-memory PIL images and the fake backend below — the real
``PixelLabClient`` is never exercised (it would cost credits).
"""

from __future__ import annotations

import asyncio
import base64
from io import BytesIO
from pathlib import Path

import numpy as np
from httpx import ASGITransport, AsyncClient
from PIL import Image
from starlette.routing import Mount

from savepoint_server.api import ingest as ingest_api
from savepoint_server.api import read as read_api
from savepoint_server.core.config import Settings
from savepoint_server.db import Repositories
from savepoint_server.main import create_app
from savepoint_server.models import Person
from savepoint_server.models.person import AvatarParams
from savepoint_server.services import pixellab
from savepoint_server.services.ingest import EdgeEvent, ingest_day, ingest_video_detections
from savepoint_server.services.pixellab import (
    PixelLabError,
    _decode_rgba_image,
    _generate_and_store_sprite,
    build_character_description,
    build_sprite_hook,
    generate_person_sprite,
)
from savepoint_server.services.speech import StubTranscriber

_AVATAR = AvatarParams(
    skin_tone="tan",
    hair_color="brown",
    hair_style="short",
    glasses=True,
    hat="cap",
    shirt_color="green",
)


def _small_rgba(color: tuple[int, int, int, int], size: tuple[int, int] = (8, 8)) -> Image.Image:
    """A tiny solid RGBA image standing in for a PixelLab sprite frame."""
    return Image.new("RGBA", size, color)


def _solid_png(color: tuple[int, int, int], size: tuple[int, int] = (128, 128)) -> bytes:
    """PNG bytes for a solid-colour frame (faceless, so vision uses whole-image fallback)."""
    arr = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    arr[:, :] = color
    buf = BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    return buf.getvalue()


class FakeBackend:
    """A :class:`~savepoint_server.services.pixellab.SpriteBackend` that returns
    in-memory images and records calls — no network."""

    def __init__(self, *, frames: int = 3, raise_on_create: bool = False) -> None:
        self.frames = frames
        self.raise_on_create = raise_on_create
        self.create_calls: list[str] = []
        self.animate_calls: list[tuple[str, str]] = []

    async def create_character_4dir(self, description: str) -> pixellab.CharacterResult:
        self.create_calls.append(description)
        if self.raise_on_create:
            raise PixelLabError("simulated PixelLab failure")
        images = {
            direction: _small_rgba((i * 10, 0, 0, 255))
            for i, direction in enumerate(("south", "east", "west", "north"))
        }
        return {"character_id": "char-1", "images": images}

    async def animate_walk(self, character_id: str, direction: str = "east") -> list[Image.Image]:
        self.animate_calls.append((character_id, direction))
        return [_small_rgba((0, j * 10, 0, 255)) for j in range(self.frames)]


# --------------------------------------------------------------------------- #
# Pure prompt builder
# --------------------------------------------------------------------------- #


def test_build_character_description_includes_axes_and_style() -> None:
    prompt = build_character_description(_AVATAR)
    assert "brown short hair" in prompt
    assert "tan skin" in prompt
    assert "green hoodie/shirt" in prompt
    assert "wearing round glasses" in prompt
    assert "wearing a cap" in prompt
    # Fixed style spec is always appended.
    assert "chibi RPG character sprite, oversized head" in prompt
    assert "1px black outline" in prompt
    assert "transparent background" in prompt


def test_build_character_description_negatives() -> None:
    plain = AvatarParams(
        skin_tone="fair",
        hair_color="black",
        hair_style="buzz",
        glasses=False,
        hat=None,
        shirt_color="blue",
    )
    prompt = build_character_description(plain)
    assert "no glasses" in prompt
    assert "no hat" in prompt


def test_build_character_description_is_deterministic() -> None:
    assert build_character_description(_AVATAR) == build_character_description(_AVATAR)


# --------------------------------------------------------------------------- #
# RGBA decode
# --------------------------------------------------------------------------- #


def test_decode_rgba_image_roundtrips() -> None:
    original = Image.new("RGBA", (5, 7), (10, 20, 30, 255))
    item = {
        "type": "rgba_bytes",
        "width": 5,
        "base64": base64.b64encode(original.tobytes()).decode("ascii"),
    }
    decoded = _decode_rgba_image(item)
    assert decoded.size == (5, 7)
    assert decoded.getpixel((0, 0)) == (10, 20, 30, 255)


def test_decode_rgba_image_rejects_malformed() -> None:
    for bad in ({"width": 5}, {"base64": "abc"}, "not-a-dict"):
        try:
            _decode_rgba_image(bad)
        except PixelLabError:
            continue
        raise AssertionError(f"expected PixelLabError for {bad!r}")


# --------------------------------------------------------------------------- #
# generate -> save -> manifest
# --------------------------------------------------------------------------- #


async def test_generate_person_sprite_writes_files_and_manifest(tmp_path: Path) -> None:
    backend = FakeBackend(frames=4)
    manifest = await generate_person_sprite("demo-1", _AVATAR, client=backend, sprites_dir=tmp_path)

    # Manifest shape.
    assert manifest["tile"] == {"w": 8, "h": 8}
    assert manifest["static"] == {
        "south": "south.png",
        "east": "east.png",
        "west": "west.png",
        "north": "north.png",
    }
    assert manifest["walk"] == {
        "east": ["walk_east_0.png", "walk_east_1.png", "walk_east_2.png", "walk_east_3.png"]
    }

    # Every referenced filename exists on disk under {sprites_dir}/{local_id}/.
    person_dir = tmp_path / "demo-1"
    for filename in list(manifest["static"].values()) + manifest["walk"]["east"]:
        assert (person_dir / filename).is_file()
    # The prompt was built from the avatar and the walk animated the base character.
    assert backend.create_calls == [build_character_description(_AVATAR)]
    assert backend.animate_calls == [("char-1", "east")]


# --------------------------------------------------------------------------- #
# _generate_and_store_sprite: persists on success, swallows failures
# --------------------------------------------------------------------------- #


async def test_generate_and_store_persists_sprite(repos: Repositories, tmp_path: Path) -> None:
    person = await repos.people.upsert(Person(local_id="store-1", avatar_params=_AVATAR))
    assert person.sprite is None

    await _generate_and_store_sprite(
        person, repos=repos, client=FakeBackend(), sprites_dir=tmp_path
    )

    refetched = await repos.people.get_by_local_id("store-1")
    assert refetched is not None
    assert refetched.sprite is not None
    assert refetched.sprite["static"]["south"] == "south.png"
    assert refetched.sprite["walk"]["east"][0] == "walk_east_0.png"


async def test_generate_and_store_swallows_errors(repos: Repositories, tmp_path: Path) -> None:
    person = await repos.people.upsert(Person(local_id="store-fail", avatar_params=_AVATAR))

    # A raising backend must NOT propagate — the fire-and-forget job can never disturb ingest.
    await _generate_and_store_sprite(
        person, repos=repos, client=FakeBackend(raise_on_create=True), sprites_dir=tmp_path
    )

    refetched = await repos.people.get_by_local_id("store-fail")
    assert refetched is not None
    assert refetched.sprite is None  # unchanged


# --------------------------------------------------------------------------- #
# build_sprite_hook gating (only when enabled + key)
# --------------------------------------------------------------------------- #


def test_build_sprite_hook_disabled_by_default(repos: Repositories) -> None:
    # Default-off: no client is constructed and no hook is returned.
    assert build_sprite_hook(Settings(), repos) is None
    # Enabled but no key -> still off.
    assert build_sprite_hook(Settings(pixellab_enabled=True), repos) is None
    # Key but not enabled -> still off.
    assert build_sprite_hook(Settings(pixellab_api_key="k"), repos) is None


def test_build_sprite_hook_enabled_returns_callable(repos: Repositories) -> None:
    hook = build_sprite_hook(
        Settings(pixellab_enabled=True, pixellab_api_key="k"), repos, backend=FakeBackend()
    )
    assert callable(hook)


async def test_hook_schedules_task_and_persists(repos: Repositories, tmp_path: Path) -> None:
    settings = Settings(pixellab_enabled=True, pixellab_api_key="k", sprites_dir=str(tmp_path))
    hook = build_sprite_hook(settings, repos, backend=FakeBackend())
    assert hook is not None

    person = await repos.people.upsert(Person(local_id="bg-1", avatar_params=_AVATAR))
    hook(person)  # fire-and-forget: schedules a background task, returns immediately
    await asyncio.gather(*list(pixellab._BACKGROUND_TASKS))

    refetched = await repos.people.get_by_local_id("bg-1")
    assert refetched is not None
    assert refetched.sprite is not None
    assert refetched.sprite["static"]["north"] == "north.png"


def test_hook_skips_person_that_already_has_a_sprite(repos: Repositories, tmp_path: Path) -> None:
    settings = Settings(pixellab_enabled=True, pixellab_api_key="k", sprites_dir=str(tmp_path))
    hook = build_sprite_hook(settings, repos, backend=FakeBackend())
    assert hook is not None

    before = set(pixellab._BACKGROUND_TASKS)
    sprited = Person(
        local_id="already",
        avatar_params=_AVATAR,
        sprite={"tile": {"w": 8, "h": 8}, "static": {}, "walk": {"east": []}},
    )
    hook(sprited)
    # No new task scheduled for a person that already has a sprite.
    assert set(pixellab._BACKGROUND_TASKS) == before


# --------------------------------------------------------------------------- #
# Ingest wiring: hook fires only for a brand-new Person
# --------------------------------------------------------------------------- #


async def test_video_ingest_hook_fires_only_for_new_person(repos: Repositories) -> None:
    calls: list[str] = []
    events = [EdgeEvent(ts_unix_ms=1_700_000_000_000, local_id="edge-1", avatar_params=_AVATAR)]

    await ingest_video_detections(
        events, repos=repos, sprite_hook=lambda p: calls.append(p.local_id)
    )
    assert calls == ["edge-1"]

    # Re-seen (same local_id) is an update, not a new person -> hook must NOT fire again.
    await ingest_video_detections(
        events, repos=repos, sprite_hook=lambda p: calls.append(p.local_id)
    )
    assert calls == ["edge-1"]


async def test_combined_ingest_hook_fires_only_for_new_person(repos: Repositories) -> None:
    calls: list[str] = []
    frame = _solid_png((150, 120, 100))

    first = await ingest_day(
        frame,
        b"audio a",
        day_id="2026-07-18",
        repos=repos,
        transcriber=StubTranscriber(),
        sprite_hook=lambda p: calls.append(p.local_id),
    )
    assert calls == [first.person.local_id]

    # Same frame -> same person (upsert), re-seen -> hook does not fire again.
    await ingest_day(
        frame,
        b"audio b",
        day_id="2026-07-18",
        repos=repos,
        transcriber=StubTranscriber(),
        sprite_hook=lambda p: calls.append(p.local_id),
    )
    assert calls == [first.person.local_id]


async def test_ingest_without_hook_leaves_sprite_none(repos: Repositories) -> None:
    # Default path (no hook wired) is unchanged: Person.sprite stays None.
    result = await ingest_day(
        _solid_png((150, 120, 100)),
        b"audio",
        day_id="2026-07-18",
        repos=repos,
        transcriber=StubTranscriber(),
    )
    assert result.person.sprite is None


# --------------------------------------------------------------------------- #
# App wiring: static mount + read-API flow-through + default-off dependency
# --------------------------------------------------------------------------- #


def test_static_sprites_mount_present() -> None:
    app = create_app()
    mounts = [r for r in app.routes if isinstance(r, Mount) and r.path == "/sprites"]
    assert mounts, "expected a /sprites static mount"
    assert mounts[0].name == "sprites"


def test_sprite_hook_dependency_off_by_default(repos: Repositories) -> None:
    # With default settings the ingest router's dependency yields no hook.
    assert ingest_api.get_sprite_hook_dep(repos) is None


async def test_person_sprite_flows_through_read_api(repos: Repositories) -> None:
    manifest = {
        "tile": {"w": 8, "h": 8},
        "static": {
            "south": "south.png",
            "east": "east.png",
            "west": "west.png",
            "north": "north.png",
        },
        "walk": {"east": ["walk_east_0.png"]},
    }
    await repos.people.upsert(Person(local_id="sprited", avatar_params=_AVATAR, sprite=manifest))

    app = create_app()
    app.dependency_overrides[read_api.get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            detail = await client.get("/people/sprited")
            listing = await client.get("/people")
    finally:
        app.dependency_overrides.pop(read_api.get_repos, None)

    assert detail.status_code == 200
    assert detail.json()["sprite"] == manifest
    assert listing.status_code == 200
    assert listing.json()[0]["sprite"] == manifest
