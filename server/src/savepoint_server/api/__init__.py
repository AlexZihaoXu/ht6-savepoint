"""API routers for the SavePoint server.

``api_router`` aggregates every feature router; ``main.create_app`` mounts it.
"""

from __future__ import annotations

from fastapi import APIRouter

from savepoint_server.api.health import router as health_router
from savepoint_server.api.vision import router as vision_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(vision_router)

__all__ = ["api_router"]
