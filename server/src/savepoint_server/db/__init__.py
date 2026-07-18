"""Database access layer (MongoDB via Motor)."""

from __future__ import annotations

from savepoint_server.db.mongo import close_client, get_client, get_db

__all__ = ["close_client", "get_client", "get_db"]
