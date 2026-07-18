"""FastAPI application entry point for the SavePoint server."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from savepoint_server.api import api_router
from savepoint_server.core.config import Settings, get_settings
from savepoint_server.db.mongo import close_client, ensure_indexes, get_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Connect to MongoDB and ensure indexes on startup; close on shutdown."""
    await ensure_indexes(get_db())
    try:
        yield
    finally:
        close_client()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build and configure the FastAPI application.

    Passing ``settings`` explicitly is handy for tests; otherwise the cached
    process settings are used.
    """
    settings = settings or get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="SavePoint backend API — people, days, and recaps.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # The API uses no cookies/credentials, and `allow_credentials=True` is an invalid
        # (and browser-rejected) combination with the wildcard `allow_origins=["*"]` the
        # demo needs, so keep credentials off and origins open.
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.get("/", tags=["meta"])
    async def root() -> dict[str, str]:
        """Return the service name so clients can confirm what they hit."""
        return {"name": settings.app_name}

    return app


app = create_app()


def main() -> None:
    """Console-script entry point: run the app with uvicorn.

    Bind to ``0.0.0.0`` per team convention (expose via tailnet IP / cloudflared).
    """
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "savepoint_server.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
