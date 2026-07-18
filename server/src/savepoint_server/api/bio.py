"""Bio router: generate + store a person's character bio (SAV-36).

``POST /people/{local_id}/bio`` loads the person (404 if unknown), has the
configured LLM backend write a short cozy character bio from their events, stores
it on the person, and returns the updated :class:`Person`. The LLM client is
provided through the :func:`get_llm_client` dependency so tests can override it
with a fake — no network in CI. The endpoint never 500s on a flaky/unreachable
model: :func:`generate_person_bio` degrades to a gentle canned bio instead.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Person
from savepoint_server.services.bio import generate_and_store_person_bio
from savepoint_server.services.llm import LLMClient
from savepoint_server.services.llm import get_llm_client as build_llm_client

router = APIRouter(tags=["bio"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def get_llm_client() -> LLMClient:
    """Provide the configured LLM client (overridable in tests via dependency_overrides)."""
    return build_llm_client()


@router.post("/people/{local_id}/bio", response_model=Person, tags=["bio"])
async def create_person_bio(
    local_id: str,
    repos: Annotated[Repositories, Depends(get_repos)],
    client: Annotated[LLMClient, Depends(get_llm_client)],
) -> Person:
    """Generate and store the character bio for ``local_id``; 404 if unknown."""
    person = await generate_and_store_person_bio(local_id, repos, client)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Person '{local_id}' not found.")
    return person
