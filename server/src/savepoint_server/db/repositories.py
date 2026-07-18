"""Async repositories: typed CRUD over the SavePoint collections.

Each repository returns Pydantic models (never raw Mongo documents) and keeps
``_id`` handling in one place. Identity strategy:

* **People** — ``_id`` is the stable, edge-assigned ``local_id`` so the same
  person always maps to the same document (upsert-by-key).
* **Days** — ``_id`` is the ISO calendar date (one garden tile per day).
* **Recaps** — ``_id`` is ``"<date>:<scope>"`` (one narrative per span).
* **Events** — append-only; a random ``uuid4`` hex ``_id`` per event.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Generic, TypeVar
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING

from savepoint_server.db.mongo import get_db
from savepoint_server.models import Day, Event, Person, Recap
from savepoint_server.models.base import MongoModel
from savepoint_server.models.recap import RecapScope

ModelT = TypeVar("ModelT", bound=MongoModel)


class BaseRepository(Generic[ModelT]):
    """Shared async CRUD for a single collection of ``MongoModel`` documents."""

    collection_name: str
    model_cls: type[ModelT]

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._col = db[self.collection_name]

    def _make_id(self, doc: ModelT) -> str:
        """Return the ``_id`` for a new document (random unless overridden)."""
        return uuid4().hex

    async def insert(self, doc: ModelT) -> ModelT:
        """Insert a document, assigning a deterministic/random ``_id`` if absent."""
        payload = doc.to_mongo()
        payload.setdefault("_id", self._make_id(doc))
        await self._col.insert_one(payload)
        return self.model_cls.from_mongo(payload)

    async def get(self, id_: str) -> ModelT | None:
        """Fetch a single document by ``_id`` (``None`` if missing)."""
        doc = await self._col.find_one({"_id": id_})
        if doc is None:
            return None
        return self.model_cls.from_mongo(doc)

    async def list(
        self,
        filters: dict[str, Any] | None = None,
        *,
        sort: list[tuple[str, int]] | None = None,
        limit: int = 100,
    ) -> list[ModelT]:
        """List documents matching ``filters`` (simple equality), newest control
        left to the caller via ``sort``."""
        cursor = self._col.find(filters or {})
        if sort is not None:
            cursor = cursor.sort(sort)
        cursor = cursor.limit(limit)
        return [self.model_cls.from_mongo(doc) async for doc in cursor]

    async def count(self, filters: dict[str, Any] | None = None) -> int:
        """Count documents matching ``filters``."""
        return int(await self._col.count_documents(filters or {}))

    async def delete(self, id_: str) -> bool:
        """Delete a document by ``_id``; return whether one was removed."""
        result = await self._col.delete_one({"_id": id_})
        return bool(result.deleted_count)


class PeopleRepository(BaseRepository[Person]):
    """People — keyed by the stable ``local_id`` so re-seen people stay one doc."""

    collection_name = "people"
    model_cls = Person

    def _make_id(self, doc: Person) -> str:
        return doc.local_id

    async def upsert(self, person: Person) -> Person:
        """Insert or replace by ``local_id`` — same person → same document."""
        payload = person.to_mongo()
        payload["_id"] = person.local_id
        await self._col.replace_one({"_id": person.local_id}, payload, upsert=True)
        return Person.from_mongo(payload)

    async def get_by_local_id(self, local_id: str) -> Person | None:
        return await self.get(local_id)

    async def list_favorites(self, *, limit: int = 100) -> list[Person]:
        return await self.list({"favorite": True}, limit=limit)


class EventsRepository(BaseRepository[Event]):
    """Events — append-only interaction log (a person seen or a line spoken)."""

    collection_name = "events"
    model_cls = Event

    async def list_for_day(self, day_id: str, *, limit: int = 500) -> list[Event]:
        return await self.list({"day_id": day_id}, sort=[("ts", ASCENDING)], limit=limit)

    async def list_for_person(self, person_id: str, *, limit: int = 500) -> list[Event]:
        return await self.list({"person_id": person_id}, sort=[("ts", DESCENDING)], limit=limit)


class DaysRepository(BaseRepository[Day]):
    """Days — one garden-tile document per ISO calendar date."""

    collection_name = "days"
    model_cls = Day

    def _make_id(self, doc: Day) -> str:
        return doc.date.isoformat()

    async def upsert(self, day: Day) -> Day:
        """Insert or replace by ISO date — one document per calendar day."""
        payload = day.to_mongo()
        payload["_id"] = day.date.isoformat()
        await self._col.replace_one({"_id": payload["_id"]}, payload, upsert=True)
        return Day.from_mongo(payload)

    async def get_by_date(self, day: date) -> Day | None:
        return await self.get(day.isoformat())


class RecapsRepository(BaseRepository[Recap]):
    """Recaps — one narrative per (date, scope), keyed deterministically."""

    collection_name = "recaps"
    model_cls = Recap

    @staticmethod
    def _key(day: date, scope: RecapScope) -> str:
        return f"{day.isoformat()}:{scope.value}"

    def _make_id(self, doc: Recap) -> str:
        return self._key(doc.date, doc.scope)

    async def upsert(self, recap: Recap) -> Recap:
        """Insert or replace by (date, scope) — one narrative per span."""
        payload = recap.to_mongo()
        payload["_id"] = self._key(recap.date, recap.scope)
        await self._col.replace_one({"_id": payload["_id"]}, payload, upsert=True)
        return Recap.from_mongo(payload)

    async def get_by_date_scope(self, day: date, scope: RecapScope) -> Recap | None:
        return await self.get(self._key(day, scope))


@dataclass(slots=True)
class Repositories:
    """Bundle of all entity repositories bound to one database handle."""

    people: PeopleRepository
    events: EventsRepository
    days: DaysRepository
    recaps: RecapsRepository


def get_repositories(db: AsyncIOMotorDatabase | None = None) -> Repositories:
    """Build the repository bundle for ``db`` (defaults to the app database)."""
    database = db if db is not None else get_db()
    return Repositories(
        people=PeopleRepository(database),
        events=EventsRepository(database),
        days=DaysRepository(database),
        recaps=RecapsRepository(database),
    )
