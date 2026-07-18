"""Async MongoDB connection layer.

A single process-wide :class:`AsyncIOMotorClient` is created lazily on first use
(so importing the app in tests/CI never requires a live database) and torn down
via the FastAPI lifespan. Collections map to ``DESIGN.md`` §9: ``people``,
``events``, ``days``, ``recaps``.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from savepoint_server.core.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    """Return the process-wide Motor client, creating it on first call.

    ``tz_aware=True`` makes stored datetimes come back as timezone-aware UTC,
    matching what the models write.
    """
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongo_uri, tz_aware=True)
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


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create the collection indexes SavePoint relies on (idempotent).

    * ``people.local_id`` — unique; the stable edge-assigned identity so the same
      person maps to one document.
    * ``events`` — timestamp (descending, for recent-first day feeds) plus lookups
      by ``person_id`` and ``day_id``.
    * ``days.date`` — unique; one garden tile per calendar day.
    * ``recaps.(date, scope)`` — unique; one narrative per span.
    """
    await db["people"].create_index([("local_id", ASCENDING)], unique=True, name="uq_local_id")
    await db["events"].create_index([("ts", DESCENDING)], name="ix_ts")
    await db["events"].create_index([("person_id", ASCENDING)], name="ix_person_id")
    await db["events"].create_index([("day_id", ASCENDING)], name="ix_day_id")
    await db["days"].create_index([("date", ASCENDING)], unique=True, name="uq_date")
    await db["recaps"].create_index(
        [("date", ASCENDING), ("scope", ASCENDING)], unique=True, name="uq_date_scope"
    )
