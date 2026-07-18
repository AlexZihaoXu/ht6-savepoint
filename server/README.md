# SavePoint Server

FastAPI backend for **SavePoint** — it binds edge (QNX/Pi) events and the speech
pipeline into people, days, and recaps, persists them in MongoDB, and serves the API
the PWA reads. See the repo-root `DESIGN.md` (§4 architecture, §9 data model) and
`PLAN.md` for the full picture.

> *"Your life autosaves."*

## Requirements

- Python **3.12+**
- [`uv`](https://docs.astral.sh/uv/) for dependency and environment management
- A MongoDB instance (local `mongodb://127.0.0.1:27017`, or Atlas) — optional for the
  `/health` check and running the app; required once data endpoints land.

## Setup

```bash
cd server
uv sync            # creates .venv and installs runtime + dev deps
```

## Run

```bash
uv run uvicorn savepoint_server.main:app --host 0.0.0.0 --port 8000
```

Or via the installed console script:

```bash
uv run savepoint-server
```

Then:

- Health check: <http://127.0.0.1:8000/health> → `{"status": "ok"}`
- Root: <http://127.0.0.1:8000/> → `{"name": "<app name>"}`
- Interactive docs: <http://127.0.0.1:8000/docs>

> Per team convention, bind to `0.0.0.0` and expose over the tailnet IP or a
> `cloudflared` tunnel — never `tailscale serve`.

## Configuration

Settings load from environment variables (or a `.env` file in `server/`) via
`pydantic-settings`. See `src/savepoint_server/core/config.py`. Common vars:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SAVEPOINT_APP_NAME` | `SavePoint Server` | Display name (root route + OpenAPI title) |
| `SAVEPOINT_MONGO_URI` | `mongodb://127.0.0.1:27017` | MongoDB connection string |
| `SAVEPOINT_MONGO_DB` | `savepoint` | Database name |
| `SAVEPOINT_GEMMA_BASE_URL` | `http://127.0.0.1:8000/v1` | Self-hosted Gemma OpenAI-compatible endpoint (recaps/bios) |
| `SAVEPOINT_GEMINI_API_KEY` | _unset_ | Gemini API key (daily recap / Q&A) |
| `SAVEPOINT_CORS_ORIGINS` | `["*"]` | Allowed CORS origins (JSON list) |

Prefix is `SAVEPOINT_`; e.g. `export SAVEPOINT_MONGO_URI=...`.

## Develop

```bash
uv run ruff format .        # format
uv run ruff check .         # lint
uv run mypy                 # type-check (config in pyproject)
uv run pytest               # tests
```

## Layout

```
server/
  pyproject.toml
  src/savepoint_server/
    main.py            # FastAPI app factory, CORS, GET / and GET /health
    core/config.py     # pydantic-settings configuration
    api/               # routers (health; more to come)
    db/mongo.py        # lazy async Motor client + get_db()
    models/            # Pydantic models: Person, Event, Day, Recap
    services/          # business logic (placeholder for now)
  tests/
    test_health.py
```
