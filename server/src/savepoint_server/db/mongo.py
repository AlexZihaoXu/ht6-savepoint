"""Lazy async MongoDB client.

The Motor client is created on first use so that importing the app (e.g. in tests
or CI) never requires a running MongoDB. Collections map to ``DESIGN.md`` §9:
``people``, ``events``, ``days``, ``recaps``.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from savepoint_server.core.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    """Return the process-wide Motor client, creating it on first call."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongo_uri)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    """Return the configured application database handle."""
    settings = get_settings()
    return get_client()[settings.mongo_db]


def close_client() -> None:
    """Close and reset the client (call on shutdown / between test sessions)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
