"""PixelLab AI sprite generator (SAV-61).

Turns a person's deterministic :class:`AvatarParams` into an AI pixel-art sprite
sheet — four static directions (south/east/west/north) plus an east walk cycle —
using PixelLab's API (https://api.pixellab.ai), caches the PNGs on disk, and
returns a small JSON **manifest** the frontend uses to build sprite URLs.

The whole feature is **config-gated and default-off** (see ``core/config.py``):
with no key / ``pixellab_enabled=False`` the ingest paths never even construct a
client, so behavior is byte-identical to today. Generation costs real credits, so
it is **never** exercised in CI/tests — the client is mocked everywhere and real
runs happen by hand (``scripts/gen_sprites.py``).

Pipeline (per person, 3 PixelLab "generations": 1 base + 2 for the walk anim):

1. ``POST /v2/create-character-with-4-directions`` -> a ``character_id`` + a
   background job; poll ``GET /v2/background-jobs/{id}`` until ``completed`` -> the
   four RGBA direction images.
2. ``POST /v2/animate-character`` (``direction="east"``) -> another background job;
   poll -> the ~9 RGBA walk frames.
3. Save every image as a PNG under ``{sprites_dir}/{local_id}/`` and return the
   manifest.

When wired into ingest it runs as a **fire-and-forget** background task that can
never block or fail the request (:func:`build_sprite_hook`).
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, TypedDict

import httpx
from PIL import Image

from savepoint_server.core.config import Settings
from savepoint_server.db.repositories import Repositories
from savepoint_server.models.person import AvatarParams, Person

logger = logging.getLogger(__name__)

# PixelLab API. All calls carry ``Authorization: Bearer <key>``.
DEFAULT_BASE_URL = "https://api.pixellab.ai"
# Directions PixelLab emits for a 4-direction character (north=back, east=right,
# south=front, west=left). Saved + surfaced in the manifest in this order.
DIRECTIONS = ("south", "east", "west", "north")
# Generations charged per person (1 base 4-dir + 2 for the one-direction walk anim).
GEN_COST_PER_PERSON = 3


class PixelLabError(RuntimeError):
    """A PixelLab API call failed (bad status, malformed payload, job failure/timeout)."""


class CharacterResult(TypedDict):
    """The base-character result: a reusable ``character_id`` + its four RGBA images."""

    character_id: str
    images: dict[str, Image.Image]


class SpriteTile(TypedDict):
    """Pixel dimensions of one sprite cell (all frames share a canonical tile)."""

    w: int
    h: int


class SpriteManifest(TypedDict):
    """On-disk sprite-sheet index stored on ``Person.sprite`` and served to the app.

    Filenames are **relative** to ``{sprites_dir}/{local_id}/``; the frontend builds
    URLs as ``${API_BASE}/sprites/{local_id}/{filename}``.
    """

    tile: SpriteTile
    static: dict[str, str]
    walk: dict[str, list[str]]


class SpriteBackend(Protocol):
    """The generation backend :func:`generate_person_sprite` depends on.

    :class:`PixelLabClient` is the real implementation; tests inject a fake that
    returns small in-memory PIL images, so no network is ever touched in CI.
    """

    async def create_character_4dir(self, description: str) -> CharacterResult: ...

    async def animate_walk(
        self, character_id: str, direction: str = "east"
    ) -> list[Image.Image]: ...


# --------------------------------------------------------------------------- #
# Prompt building (pure, unit-tested)
# --------------------------------------------------------------------------- #

# Fixed style spec appended to every character prompt so the whole cast shares one
# cohesive cozy-pixel look regardless of the per-person axes.
_STYLE_SPEC = (
    "neutral standing pose facing right, arms relaxed, feet together, "
    "Game Boy Advance / DS era RPG, soft warm palette, 1px black outline, "
    "3-4 shades per color, no anti-aliasing, crisp pixel-perfect edges, "
    "lighting from above, transparent background"
)


def build_character_description(avatar_params: AvatarParams) -> str:
    """Compose a PixelLab prompt from the 6 avatar axes + the fixed style spec.

    Pure and deterministic: the same :class:`AvatarParams` always yields the same
    prompt string. The axes (skin_tone, hair_color, hair_style, glasses, hat,
    shirt_color) become natural-language phrases; :data:`_STYLE_SPEC` pins the
    shared art direction.
    """
    hair = f"{avatar_params.hair_color} {avatar_params.hair_style} hair"
    glasses = "wearing round glasses" if avatar_params.glasses else "no glasses"
    hat = f"wearing a {avatar_params.hat}" if avatar_params.hat else "no hat"
    return (
        "chibi RPG character sprite, oversized head, "
        f"{hair}, {avatar_params.skin_tone} skin, {avatar_params.shirt_color} hoodie/shirt, "
        f"{glasses}, {hat}, {_STYLE_SPEC}"
    )


# --------------------------------------------------------------------------- #
# RGBA decoding
# --------------------------------------------------------------------------- #


def _decode_rgba_image(item: Any) -> Image.Image:
    """Decode one PixelLab ``rgba_bytes`` image dict into a PIL image.

    Each image is ``{"type": "rgba_bytes", "width": W, "base64": B}``; the height is
    inferred from the byte length (4 bytes/pixel). Raises :class:`PixelLabError` on a
    malformed payload so a bad response never surfaces as an opaque decode crash.
    """
    if not isinstance(item, dict) or "width" not in item or "base64" not in item:
        raise PixelLabError(f"Malformed PixelLab image payload: {type(item).__name__}")
    try:
        width = int(item["width"])
        raw = base64.b64decode(item["base64"])
    except (ValueError, TypeError, binascii.Error) as exc:
        raise PixelLabError("PixelLab image payload could not be decoded") from exc
    if width <= 0 or len(raw) % (width * 4) != 0:
        raise PixelLabError("PixelLab image bytes are not a whole RGBA rectangle")
    height = len(raw) // (width * 4)
    return Image.frombytes("RGBA", (width, height), raw)


def _extract_frames(last: dict[str, Any], direction: str) -> list[Any]:
    """Pull the ordered frame list out of a completed animate-character job.

    The job's ``last_response.images`` is either a flat list of frame dicts (single
    direction), or a dict keyed by direction whose value is that direction's frame
    list. Handle both so a schema tweak on PixelLab's side can't silently drop the walk.
    """
    imgs = last.get("images")
    if isinstance(imgs, list):
        return imgs
    if isinstance(imgs, dict):
        value = imgs.get(direction)
        if value is None and imgs:
            value = next(iter(imgs.values()))
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            return [value]
    return []


# --------------------------------------------------------------------------- #
# HTTP client
# --------------------------------------------------------------------------- #


class PixelLabClient:
    """Async :class:`SpriteBackend` over PixelLab's HTTP API (httpx).

    Handles the POST -> background-job -> poll -> decode flow for both the base
    character and the walk animation, and exposes the account balance. Jobs take
    ~40-90s, so each is polled on an interval up to ``poll_timeout``; a failed or
    timed-out job raises :class:`PixelLabError`.
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        image_size: int = 64,
        timeout: float = 60.0,
        poll_interval: float = 5.0,
        poll_timeout: float = 240.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._image_size = image_size
        self._timeout = timeout
        self._poll_interval = poll_interval
        self._poll_timeout = poll_timeout

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    async def _poll_job(self, client: httpx.AsyncClient, job_id: str) -> dict[str, Any]:
        """Poll ``GET /v2/background-jobs/{job_id}`` until it completes; return
        ``last_response``.

        Raises :class:`PixelLabError` if the job reports a failure state or does not
        complete within ``poll_timeout``.
        """
        deadline = time.monotonic() + self._poll_timeout
        url = f"{self._base_url}/v2/background-jobs/{job_id}"
        while True:
            resp = await client.get(url, headers=self._headers)
            resp.raise_for_status()
            data = resp.json()
            status = data.get("status") if isinstance(data, dict) else None
            if status == "completed":
                last = data.get("last_response")
                if not isinstance(last, dict):
                    raise PixelLabError(f"Completed job {job_id} carried no last_response")
                return last
            if status in ("failed", "error", "cancelled", "canceled"):
                raise PixelLabError(f"PixelLab job {job_id} ended in status {status!r}")
            if time.monotonic() >= deadline:
                raise PixelLabError(
                    f"PixelLab job {job_id} did not complete within {self._poll_timeout:.0f}s"
                )
            await asyncio.sleep(self._poll_interval)

    async def create_character_4dir(self, description: str) -> CharacterResult:
        """Create a 4-direction base character (1 generation) and decode its images."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/v2/create-character-with-4-directions",
                json={
                    "description": description,
                    "image_size": {"width": self._image_size, "height": self._image_size},
                },
                headers=self._headers,
            )
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                raise PixelLabError("create-character response was not a JSON object")
            character_id = str(data["character_id"])
            job_id = str(data["background_job_id"])
            last = await self._poll_job(client, job_id)

        images_raw = last.get("images")
        if not isinstance(images_raw, dict):
            raise PixelLabError("create-character job returned no images dict")
        images = {str(direction): _decode_rgba_image(img) for direction, img in images_raw.items()}
        missing = [d for d in DIRECTIONS if d not in images]
        if missing:
            raise PixelLabError(f"create-character missing directions: {missing}")
        return {"character_id": character_id, "images": images}

    async def animate_walk(self, character_id: str, direction: str = "east") -> list[Image.Image]:
        """Animate a walk cycle for one ``direction`` (~2 generations); decode frames.

        Uses v3 custom mode (auto-detected when no ``template_animation_id`` is given).
        The direction is selected via the ``directions`` LIST (custom mode defaults to
        south only, so an explicit ``["east"]`` is required for a side-facing walk).
        """
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/v2/animate-character",
                json={
                    "character_id": character_id,
                    "action_description": "walking",
                    "directions": [direction],
                },
                headers=self._headers,
            )
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                raise PixelLabError("animate-character response was not a JSON object")
            job_ids = data.get("background_job_ids")
            if not isinstance(job_ids, list) or not job_ids:
                raise PixelLabError("animate-character returned no background_job_ids")
            last = await self._poll_job(client, str(job_ids[0]))

        frames_raw = _extract_frames(last, direction)
        if not frames_raw:
            raise PixelLabError("animate-character job returned no frames")
        return [_decode_rgba_image(frame) for frame in frames_raw]

    async def get_balance(self) -> float:
        """Return the remaining generation count (``subscription.generations``)."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(f"{self._base_url}/v2/balance", headers=self._headers)
            resp.raise_for_status()
            data = resp.json()
        if not isinstance(data, dict):
            raise PixelLabError("balance response was not a JSON object")
        subscription = data.get("subscription")
        if not isinstance(subscription, dict) or "generations" not in subscription:
            raise PixelLabError("balance response had no subscription.generations")
        return float(subscription["generations"])


# --------------------------------------------------------------------------- #
# Full generate -> save -> manifest flow
# --------------------------------------------------------------------------- #

# A ``local_id`` safe to use as a single on-disk directory name: no path separators,
# no ``..``. ``local_id`` originates from untrusted ingest payloads (EdgeEvent.local_id
# on the public POST /ingest/video, or the /ingest ``person_key``), so it must never be
# joined into a filesystem path unchecked.
_SAFE_LOCAL_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")


def _safe_person_dir(sprites_dir: str | Path, local_id: str) -> Path:
    """Return the confined per-person sprite dir, or raise :class:`PixelLabError`.

    Guards against path traversal / arbitrary file writes: a ``local_id`` like ``..`` or
    ``../../etc`` (or an absolute path, which ``Path.__truediv__`` would let replace the
    base entirely) must not escape ``sprites_dir``. The charset check rejects separators,
    the explicit ``..``/`.` check rejects the lone parent/self refs the charset allows, and
    the resolved-containment check is a final backstop. Raising here is safe: the only
    callers are the ingest hook (which swallows all exceptions) and the manual CLI.
    """
    if not _SAFE_LOCAL_ID.fullmatch(local_id) or local_id in {".", ".."}:
        raise PixelLabError(f"unsafe local_id for sprite path: {local_id!r}")
    sprites_root = Path(sprites_dir).resolve()
    person_dir = (sprites_root / local_id).resolve()
    if not person_dir.is_relative_to(sprites_root):
        raise PixelLabError(f"local_id escapes sprites_dir: {local_id!r}")
    return person_dir


async def generate_person_sprite(
    local_id: str,
    avatar_params: AvatarParams,
    *,
    client: SpriteBackend,
    sprites_dir: str | Path,
) -> SpriteManifest:
    """Generate one person's sprite sheet, save the PNGs, and return the manifest.

    Builds the prompt from ``avatar_params``, asks ``client`` for the 4 static
    directions + the east walk frames, writes them all as PNGs under
    ``{sprites_dir}/{local_id}/`` (``south.png``, ``east.png``, ``west.png``,
    ``north.png``, ``walk_east_0.png`` ...), and returns a :class:`SpriteManifest`
    of relative filenames + the canonical tile size.

    Rejects an unsafe ``local_id`` (path traversal) **before** spending any PixelLab
    generations, so a malicious id never burns credits.
    """
    # Validate the destination first — fail fast before any (paid) API call.
    person_dir = _safe_person_dir(sprites_dir, local_id)

    description = build_character_description(avatar_params)
    character = await client.create_character_4dir(description)
    frames = await client.animate_walk(character["character_id"], direction="east")

    person_dir.mkdir(parents=True, exist_ok=True)

    images = character["images"]
    static: dict[str, str] = {}
    for direction in DIRECTIONS:
        filename = f"{direction}.png"
        images[direction].save(person_dir / filename)
        static[direction] = filename

    walk_files: list[str] = []
    for index, frame in enumerate(frames):
        filename = f"walk_east_{index}.png"
        frame.save(person_dir / filename)
        walk_files.append(filename)

    # Canonical tile = the front (south) image; all cells share the same footprint.
    tile_img = images["south"]
    return {
        "tile": {"w": tile_img.width, "h": tile_img.height},
        "static": static,
        "walk": {"east": walk_files},
    }


# --------------------------------------------------------------------------- #
# Fire-and-forget ingest hook
# --------------------------------------------------------------------------- #

# Strong refs to in-flight fire-and-forget tasks, so the event loop doesn't GC a
# task mid-run (a documented asyncio footgun). Cleared by each task's done-callback.
_BACKGROUND_TASKS: set[asyncio.Task[None]] = set()

# Cap concurrent sprite generations: one POST /ingest/video batch of N brand-new people
# schedules N fire-and-forget jobs at once, and each job is ~3 generations of the small
# trial budget + a slow (~40-90s) PixelLab call. Draining a couple at a time keeps the
# event loop and the credit spend sane without blocking ingest.
_SPRITE_SEMAPHORE = asyncio.Semaphore(2)


async def _generate_and_store_sprite(
    person: Person,
    *,
    repos: Repositories,
    client: SpriteBackend,
    sprites_dir: str | Path,
) -> None:
    """Generate ``person``'s sprite and persist the manifest onto the Person.

    Best-effort and **never raises** — any PixelLab / IO / DB failure is logged and
    swallowed so a background sprite job can never disturb the ingest that spawned
    it. Concurrency is bounded by :data:`_SPRITE_SEMAPHORE`. The Person is re-fetched
    before the write so a concurrent ``last_seen`` refresh isn't clobbered, and a
    person deleted meanwhile is simply skipped.
    """
    try:
        async with _SPRITE_SEMAPHORE:
            manifest = await generate_person_sprite(
                person.local_id, person.avatar_params, client=client, sprites_dir=sprites_dir
            )
            current = await repos.people.get_by_local_id(person.local_id)
            if current is None:
                return
            await repos.people.upsert(current.model_copy(update={"sprite": manifest}))
            logger.info("Generated PixelLab sprite for person %s", person.local_id)
    except Exception:
        logger.exception(
            "PixelLab sprite generation failed for person %s (ignored)", person.local_id
        )


def build_sprite_hook(
    settings: Settings,
    repos: Repositories,
    *,
    backend: SpriteBackend | None = None,
) -> Callable[[Person], None] | None:
    """Build the ingest ``on-new-person`` hook, or ``None`` when the feature is off.

    Returns ``None`` (a true no-op — ingest never touches PixelLab) unless
    ``pixellab_enabled`` is set **and** an API key is configured. Otherwise returns a
    synchronous callback that, for a person without a sprite yet, schedules a
    fire-and-forget :func:`_generate_and_store_sprite` task and returns immediately —
    it can never block or fail the ingest request. ``backend`` is injectable for
    tests (defaults to a real :class:`PixelLabClient`).
    """
    if not settings.pixellab_enabled or not settings.pixellab_api_key:
        return None
    client: SpriteBackend = backend or PixelLabClient(api_key=settings.pixellab_api_key)
    sprites_dir = settings.sprites_dir

    def hook(person: Person) -> None:
        if person.sprite is not None:
            return
        task = asyncio.create_task(
            _generate_and_store_sprite(person, repos=repos, client=client, sprites_dir=sprites_dir)
        )
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)

    return hook
