"""Rename router: let the frontend rename (or un-name) a person (SAV-?).

``PATCH /people/{local_id}`` loads the person (404 if unknown), sets their
``name`` from the request body, and persists it. A blank or whitespace-only
``name`` (or an absent one) clears the name back to ``None`` rather than
erroring — that's intentional, since the frontend's ``displayName()`` fallback
(e.g. showing the ``local_id``) kicks back in once ``name`` is unset.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Person

router = APIRouter(tags=["people"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


class PersonRename(BaseModel):
    """Request body for ``PATCH /people/{local_id}``."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=80)


@router.patch("/people/{local_id}", response_model=Person, tags=["people"])
async def rename_person(
    local_id: str,
    body: PersonRename,
    repos: Annotated[Repositories, Depends(get_repos)],
) -> Person:
    """Rename ``local_id`` to ``body.name``; 404 if unknown.

    A blank/whitespace-only (or absent) name clears the stored name back to
    ``None`` instead of erroring.
    """
    person = await repos.people.get_by_local_id(local_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Person '{local_id}' not found.")
    stripped = body.name.strip() if body.name is not None else None
    person.name = stripped or None
    return await repos.people.upsert(person)
