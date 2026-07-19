"""Database access layer (MongoDB via Motor)."""

from __future__ import annotations

from savepoint_server.db.mongo import (
    close_client,
    ensure_indexes,
    get_client,
    get_db,
)
from savepoint_server.db.repositories import (
    BaseRepository,
    DaysRepository,
    EventsRepository,
    PeopleRepository,
    RecapsRepository,
    Repositories,
    WearerVoiceRepository,
    get_repositories,
)

__all__ = [
    "BaseRepository",
    "DaysRepository",
    "EventsRepository",
    "PeopleRepository",
    "RecapsRepository",
    "Repositories",
    "WearerVoiceRepository",
    "close_client",
    "ensure_indexes",
    "get_client",
    "get_db",
    "get_repositories",
]
