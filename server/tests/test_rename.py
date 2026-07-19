"""Tests for PATCH /people/{local_id} (rename).

CI-safe: no LLM, no network. Every test round-trips through the real test
Mongo via the ``repos`` fixture. Covers renaming an existing person and the
change persisting (visible via GET /people/{local_id}), clearing a name with a
blank/whitespace-only body (not an error — the frontend's ``displayName()``
fallback kicks back in), trimming whitespace around a real name, 404 for an
unknown ``local_id``, and 422 for an unexpected extra field in the body.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient

from savepoint_server.api.read import get_repos as read_get_repos
from savepoint_server.api.rename import get_repos
from savepoint_server.db import Repositories
from savepoint_server.main import app
from savepoint_server.models import Person
from savepoint_server.models.person import AvatarParams

BASE = datetime(2026, 7, 18, 9, 0, tzinfo=UTC)


def _avatar() -> AvatarParams:
    return AvatarParams(
        skin_tone="fair", hair_color="brown", hair_style="short", shirt_color="blue"
    )


def _person(local_id: str, *, name: str | None = None) -> Person:
    return Person(
        local_id=local_id,
        name=name,
        avatar_params=_avatar(),
        first_seen=BASE,
        last_seen=BASE,
    )


@asynccontextmanager
async def _client(repos: Repositories) -> AsyncIterator[AsyncClient]:
    """ASGI client with the rename router's repos (and read's repos) overridden."""
    app.dependency_overrides[get_repos] = lambda: repos
    app.dependency_overrides[read_get_repos] = lambda: repos
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_repos, None)
        app.dependency_overrides.pop(read_get_repos, None)


# --------------------------------------------------------------------------- #
# PATCH /people/{local_id}
# --------------------------------------------------------------------------- #


async def test_patch_person_renames_and_persists(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"name": "Alexandra"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["local_id"] == "alex"
        assert body["name"] == "Alexandra"

        # Persisted: a follow-up GET reflects the new name.
        detail = await client.get("/people/alex")

    assert detail.status_code == 200
    assert detail.json()["name"] == "Alexandra"


async def test_patch_person_blank_name_clears_it(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"name": "   "})

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] is None

    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.name is None


async def test_patch_person_absent_name_clears_it(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={})

    assert resp.status_code == 200
    assert resp.json()["name"] is None


async def test_patch_person_trims_whitespace(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"name": "  Alexandra  "})

    assert resp.status_code == 200
    assert resp.json()["name"] == "Alexandra"

    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.name == "Alexandra"


async def test_patch_person_unknown_local_id_404(repos: Repositories) -> None:
    async with _client(repos) as client:
        resp = await client.patch("/people/ghost", json={"name": "Nobody"})
    assert resp.status_code == 404


async def test_patch_person_rejects_unexpected_field(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"name": "Alex", "favorite": True})

    assert resp.status_code == 422
