"""Person-update router: let the frontend edit a person's name, notes, and tags.

``PATCH /people/{local_id}`` loads the person (404 if unknown) and applies a
**partial** update — only the fields the client explicitly sends are touched, so
a name-only PATCH leaves notes/tags alone and vice versa (enforced via
``model_fields_set``). ``name`` keeps its original semantics: a blank or
whitespace-only ``name`` (when sent) clears it back to ``None`` rather than
erroring — the frontend's ``displayName()`` fallback (e.g. showing the
``local_id``) kicks back in once ``name`` is unset. Empty ``notes`` likewise
clears to ``None``; ``tags`` are normalized (trimmed, de-duped, capped).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Person

router = APIRouter(tags=["people"])

# Keep tag lists sane: cap the count and each tag's length so the UI stays tidy
# and a hostile client can't stuff unbounded data onto a person.
_MAX_TAGS = 20
_MAX_TAG_LEN = 40


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


class PersonUpdate(BaseModel):
    """Request body for ``PATCH /people/{local_id}`` (partial update).

    Every field is optional. Only fields present in ``model_fields_set`` (i.e.
    explicitly sent by the client) are applied — omitting a field leaves the
    stored value untouched.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)
    tags: list[str] | None = None


def _clean_tags(raw: list[str]) -> list[str]:
    """Strip each tag, drop empties, de-dupe (order-preserving), cap count + length."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in raw:
        stripped = tag.strip()
        if not stripped:
            continue
        stripped = stripped[:_MAX_TAG_LEN]
        if stripped in seen:
            continue
        seen.add(stripped)
        cleaned.append(stripped)
        if len(cleaned) >= _MAX_TAGS:
            break
    return cleaned


@router.patch("/people/{local_id}", response_model=Person, tags=["people"])
async def update_person(
    local_id: str,
    body: PersonUpdate,
    repos: Annotated[Repositories, Depends(get_repos)],
) -> Person:
    """Update ``local_id``'s name/notes/tags; 404 if unknown.

    Partial: only fields explicitly present in the request body are applied. A
    blank/whitespace-only ``name`` clears the stored name to ``None``; an empty
    ``notes`` clears it to ``None``; ``tags`` are normalized (trimmed, de-duped,
    capped) before storage.
    """
    person = await repos.people.get_by_local_id(local_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Person '{local_id}' not found.")

    sent = body.model_fields_set
    if "name" in sent:
        stripped = body.name.strip() if body.name is not None else None
        person.name = stripped or None
    if "notes" in sent:
        person.notes = body.notes.strip() or None if body.notes is not None else None
    if "tags" in sent:
        person.tags = _clean_tags(body.tags) if body.tags is not None else []

    return await repos.people.upsert(person)
