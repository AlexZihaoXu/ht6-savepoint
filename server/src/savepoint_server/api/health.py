"""Health / liveness router."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe used by tunnels, CI, and uptime checks."""
    return {"status": "ok"}
