"""FastAPI application entry point for the SavePoint server."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from savepoint_server.api import api_router
from savepoint_server.core.config import Settings, get_settings
from savepoint_server.db.mongo import close_client, ensure_indexes, get_db

logger = logging.getLogger(__name__)


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

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Ensure an unhandled exception's response still carries CORS headers.

        Starlette's default fallback for a truly unhandled exception
        (ServerErrorMiddleware, wired in automatically OUTSIDE every
        user-added middleware including CORSMiddleware above) returns its
        response without ever passing back through CORSMiddleware — so a
        cross-origin browser request sees no Access-Control-Allow-Origin on
        that 500 and reports the request as failed outright ("can't reach
        the server"), not as a real HTTP 500 the frontend could show. An
        explicit handler runs inside the middleware stack instead, so its
        JSONResponse gets CORS-processed normally like any other response.
        """
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})

    app.include_router(api_router)

    # Serve generated PixelLab sprite PNGs (SAV-61) at /sprites/{local_id}/{file}.
    # The dir is created if missing (StaticFiles requires it to exist at mount time)
    # and is where scripts/gen_sprites.py + the fire-and-forget ingest hook write.
    sprites_path = Path(settings.sprites_dir)
    sprites_path.mkdir(parents=True, exist_ok=True)
    app.mount("/sprites", StaticFiles(directory=str(sprites_path)), name="sprites")

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
