"""Admin router: destructive maintenance ops for a clean-slate demo.

``POST /admin/reset`` wipes every SavePoint collection — people, events, days,
recaps (DESIGN.md §9) — and reports how many documents each drop removed. It
lets the companion app offer a "clean" button that resets the plaza + garden
back to empty between demo runs.

The endpoint is intentionally unguarded for the current local-demo workflow.
It talks to whatever ``SAVEPOINT_MONGO_URI`` points at, so put a flag (or drop
this router) before exposing it on a shared/hosted deployment.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from savepoint_server.db import Repositories, get_repositories

router = APIRouter(prefix="/admin", tags=["admin"])


def get_repos() -> Repositories:
    """Provide the repository bundle (overridable in tests via dependency_overrides)."""
    return get_repositories()


class ResetResult(BaseModel):
    """How many documents were deleted from each collection by ``POST /admin/reset``."""

    people: int
    events: int
    days: int
    recaps: int


@router.post("/reset", response_model=ResetResult)
async def reset_data(repos: Annotated[Repositories, Depends(get_repos)]) -> ResetResult:
    """Wipe every SavePoint collection — a clean slate for a fresh demo run."""
    return ResetResult(
        people=await repos.people.clear(),
        events=await repos.events.clear(),
        days=await repos.days.clear(),
        recaps=await repos.recaps.clear(),
    )
