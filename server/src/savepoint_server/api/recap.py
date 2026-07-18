"""Recap router: generate + store a day's narrative recap (SAV-33).

``POST /day/{date}/recap`` reads the day's events, has the configured LLM backend
write a cozy narrative recap, upserts it (one per day, DESIGN §11), and returns it.
The LLM client is provided through the :func:`get_llm_client` dependency so tests
can override it with a fake — no network in CI.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from savepoint_server.db import Repositories, get_repositories
from savepoint_server.models import Recap
from savepoint_server.services.llm import LLMClient
from savepoint_server.services.llm import get_llm_client as build_llm_client
from savepoint_server.services.recap import generate_and_store_day_recap

router = APIRouter(tags=["recap"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


def get_llm_client() -> LLMClient:
    """Provide the configured LLM client (overridable in tests via dependency_overrides)."""
    return build_llm_client()


def _parse_iso_date(value: str) -> date:
    """Parse a ``YYYY-MM-DD`` path segment, 400ing on anything malformed."""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date '{value}'; expected ISO YYYY-MM-DD."
        ) from exc


@router.post("/day/{date}/recap", response_model=Recap, tags=["recap"])
async def create_day_recap(
    date: str,
    repos: Annotated[Repositories, Depends(get_repos)],
    client: Annotated[LLMClient, Depends(get_llm_client)],
) -> Recap:
    """Generate and store the day-scope recap for an ISO ``YYYY-MM-DD`` date."""
    return await generate_and_store_day_recap(_parse_iso_date(date), repos, client)
