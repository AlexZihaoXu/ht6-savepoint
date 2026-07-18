"""API routers for the SavePoint server.

``api_router`` aggregates every feature router; ``main.create_app`` mounts it.
"""

from __future__ import annotations

from fastapi import APIRouter

from savepoint_server.api.bio import router as bio_router
from savepoint_server.api.health import router as health_router
from savepoint_server.api.ingest import router as ingest_router
from savepoint_server.api.read import router as read_router
from savepoint_server.api.recap import router as recap_router
from savepoint_server.api.speech import router as speech_router
from savepoint_server.api.vision import router as vision_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(vision_router)
api_router.include_router(speech_router)
api_router.include_router(ingest_router)
api_router.include_router(read_router)
api_router.include_router(recap_router)
api_router.include_router(bio_router)

__all__ = ["api_router"]
