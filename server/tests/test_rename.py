"""Tests for PATCH /people/{local_id} (general person update).

CI-safe: no LLM, no network. Every test round-trips through the real test
Mongo via the ``repos`` fixture. Covers renaming an existing person and the
change persisting (visible via GET /people/{local_id}), clearing a name with a
blank/whitespace-only body (not an error — the frontend's ``displayName()``
fallback kicks back in), trimming whitespace around a real name, 404 for an
unknown ``local_id``, and 422 for an unexpected extra field in the body. Also
covers the notes/tags fields and — crucially — the **partial-update** contract:
a PATCH that sends only some fields must leave the others untouched.
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


def _person(
    local_id: str,
    *,
    name: str | None = None,
    notes: str | None = None,
    tags: list[str] | None = None,
) -> Person:
    return Person(
        local_id=local_id,
        name=name,
        avatar_params=_avatar(),
        first_seen=BASE,
        last_seen=BASE,
        notes=notes,
        tags=tags if tags is not None else [],
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


async def test_patch_person_empty_body_leaves_name_intact(repos: Repositories) -> None:
    """Partial-update contract: an empty body touches nothing (name stays).

    (Under the old rename-only endpoint an absent name cleared the name; the
    general update endpoint only touches fields the client explicitly sends, so
    a name is now cleared via an explicit blank ``name`` — see the test above.)
    """
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={})

    assert resp.status_code == 200
    assert resp.json()["name"] == "Alex"


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


# --------------------------------------------------------------------------- #
# notes / tags + partial-update safety (the fields_set contract)
# --------------------------------------------------------------------------- #


async def test_patch_person_notes_only_leaves_name_and_tags(repos: Repositories) -> None:
    await repos.people.upsert(
        _person("alex", name="Alex", notes="old note", tags=["friend", "gym"])
    )

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"notes": "  met at the market  "})

    assert resp.status_code == 200
    body = resp.json()
    # notes updated + trimmed; name and tags untouched.
    assert body["notes"] == "met at the market"
    assert body["name"] == "Alex"
    assert body["tags"] == ["friend", "gym"]

    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.notes == "met at the market"
    assert from_db.name == "Alex"
    assert from_db.tags == ["friend", "gym"]


async def test_patch_person_empty_notes_clears_to_none(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex", notes="something"))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"notes": "   "})

    assert resp.status_code == 200
    assert resp.json()["notes"] is None

    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.notes is None


async def test_patch_person_tags_only_leaves_name_and_notes(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex", notes="keep me", tags=["old"]))

    async with _client(repos) as client:
        # Normalization: whitespace trimmed, empties dropped, dupes collapsed
        # (order preserved).
        resp = await client.patch(
            "/people/alex",
            json={"tags": ["  neighbor  ", "", "friend", "friend", "  "]},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["tags"] == ["neighbor", "friend"]
    # name + notes untouched.
    assert body["name"] == "Alex"
    assert body["notes"] == "keep me"

    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.tags == ["neighbor", "friend"]
    assert from_db.notes == "keep me"


async def test_patch_person_tags_capped_at_20(repos: Repositories) -> None:
    await repos.people.upsert(_person("alex", name="Alex"))

    async with _client(repos) as client:
        resp = await client.patch(
            "/people/alex",
            json={"tags": [f"t{i}" for i in range(30)]},
        )

    assert resp.status_code == 200
    tags = resp.json()["tags"]
    assert len(tags) == 20
    assert tags == [f"t{i}" for i in range(20)]


async def test_patch_person_name_only_leaves_notes_and_tags(repos: Repositories) -> None:
    """Regression: renaming must NOT wipe an existing person's notes/tags."""
    await repos.people.upsert(_person("alex", name="Alex", notes="cherished note", tags=["friend"]))

    async with _client(repos) as client:
        resp = await client.patch("/people/alex", json={"name": "Alexandra"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Alexandra"
    assert body["notes"] == "cherished note"
    assert body["tags"] == ["friend"]

    from_db = await repos.people.get_by_local_id("alex")
    assert from_db is not None
    assert from_db.name == "Alexandra"
    assert from_db.notes == "cherished note"
    assert from_db.tags == ["friend"]
