"""Shared Pydantic base for MongoDB-backed documents."""

from __future__ import annotations

from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field


class MongoModel(BaseModel):
    """Base model for documents stored in MongoDB.

    Exposes the Mongo ``_id`` as ``id`` while allowing population by either name.
    ``id`` is optional so new documents can be created before insertion. The id is
    a plain ``str`` (never a raw ``ObjectId``) so documents round-trip cleanly
    through Pydantic and JSON.
    """

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str | None = Field(default=None, alias="_id")

    def to_mongo(self) -> dict[str, Any]:
        """Serialize to a BSON-ready dict.

        Uses the ``_id`` alias and drops a ``None`` id so Mongo assigns/keeps its
        own key instead of storing a literal ``null`` ``_id``. Repositories may set
        a deterministic ``_id`` afterwards.
        """
        doc = self.model_dump(by_alias=True)
        if doc.get("_id") is None:
            doc.pop("_id", None)
        return doc

    @classmethod
    def from_mongo(cls, doc: dict[str, Any]) -> Self:
        """Build a model from a raw Mongo document (``_id`` maps to ``id``)."""
        return cls.model_validate(doc)
