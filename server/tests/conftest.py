"""Shared test fixtures.

Repository tests run against a real MongoDB using a dedicated, disposable
database (``savepoint_test``). Locally this is ``127.0.0.1:27017``; CI points
``SAVEPOINT_MONGO_URI`` at its ``mongo:7`` service. The database is dropped
before and after each test so runs are isolated and self-cleaning.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

from savepoint_server.db import Repositories, ensure_indexes, get_repositories

TEST_URI = os.environ.get("SAVEPOINT_MONGO_URI", "mongodb://127.0.0.1:27017")
TEST_DB = os.environ.get("SAVEPOINT_TEST_MONGO_DB", "savepoint_test")


@pytest_asyncio.fixture
async def repos() -> AsyncIterator[Repositories]:
    """Yield a fresh repository bundle bound to a clean test database."""
    client: AsyncIOMotorClient = AsyncIOMotorClient(TEST_URI, tz_aware=True)
    db = client[TEST_DB]
    await client.drop_database(TEST_DB)
    await ensure_indexes(db)
    try:
        yield get_repositories(db)
    finally:
        await client.drop_database(TEST_DB)
        client.close()
