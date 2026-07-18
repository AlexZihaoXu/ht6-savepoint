"""Shared Pydantic base for MongoDB-backed documents."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class MongoModel(BaseModel):
    """Base model for documents stored in MongoDB.

    Exposes the Mongo ``_id`` as ``id`` while allowing population by either name.
    ``id`` is optional so new documents can be created before insertion.
    """

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str | None = Field(default=None, alias="_id")
