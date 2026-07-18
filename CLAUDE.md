# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SavePoint ("your life autosaves") — a Hack the 6ix 2026 project. A Raspberry Pi 5 wearable turns
people you talk to into pixel characters; a companion PWA replays the day back as a cozy,
Stardew-style game world. **Game-first, privacy-first**: only **derived data** (sprite params,
embeddings, transcript text) leaves the device — never raw faces. Face detection + who-said-what
run **server-side today**, and can *optionally* move on-device on the Pi.

Read `DESIGN.md` (architecture §4, speech pipeline §6, data model §9, UI §10) and `PLAN.md`
(workstreams, milestones — see its "v7" changelog) for intent. **QNX is dropped** — `edge/`
runs on regular Raspberry Pi OS, no RTOS (PLAN.md, DESIGN.md §5). `docs/DEV.md` is the
runbook.

## Monorepo layout — four independent workstreams

Each subproject has its own toolchain, dependency file, and **path-filtered CI** (a change under
`app/**` only runs `ci-frontend.yml`, etc.). There is no root package manager — always `cd` into
the subproject first.

| Path        | Stack                                              | Status                          |
| ----------- | -------------------------------------------------- | ------------------------------- |
| `app/`      | React 19 + TS + HeroUI v3 + Tailwind v4 (Vite), pnpm | **Redesign feature-complete on branch `feat/plaza-prototype`** (plaza + garden + cinematic day view + People/Past on the live read API — DESIGN §10); awaiting merge to `main` |
| `server/`   | FastAPI + MongoDB (Motor), Python 3.12, uv         | **M1–M3 done** — `/ingest` + read API + vision + speech + **daily recap** (gemma) |
| `pipeline/` | Speech: pyannote → SepFormer → faster-whisper, uv  | Working, validated offline      |
| `edge/`     | Pi 5 capture, Raspberry Pi OS + Python, uv         | Sim mode working; **linux backend (SCRFD→ArcFace face-rec) implemented + deployed on the Pi** (PR #18); on-hardware e2e smoke = SAV-59 (human) |

## Commands

### app/ (pnpm, Node 20+/22 in CI)
```bash
cd app && pnpm install
pnpm dev                    # Vite dev server on 0.0.0.0:5173
pnpm test                   # vitest run (jsdom); pnpm test -- --run in CI
pnpm test -- src/App.test.tsx   # single test file
pnpm typecheck              # tsc -b
pnpm lint                   # eslint
pnpm format:check           # prettier --check (CI gate); `pnpm format` to fix
pnpm build                  # tsc -b && vite build
```
CI runs, in order: `format:check` → `lint` → `typecheck` → `test` → `build`. All are required.

### server/ (uv, Python 3.12)
```bash
cd server && uv sync
uv run uvicorn savepoint_server.main:app --host 0.0.0.0 --port 8000   # or: uv run savepoint-server
uv run pytest               # tests
uv run pytest tests/test_health.py::test_health   # single test
uv run ruff format --check .   # format gate (use `ruff format .` to fix)
uv run ruff check .            # lint
uv run mypy src                # strict type-check
```
The ASGI app is `savepoint_server.main:app` (README/DEV/server-README all agree). Live
endpoints — **write:** `/ingest`, `/ingest/video` (Pi EdgeEvents), `/ingest/audio` +
`/ingest/audio/clip` (app mic → server diarize), `/day/{date}/assign-speaker` (tap-to-name),
`/vision/analyze`, `/speech/transcribe`; **read:** `/today`, `/day/{date}`, `/days`,
`/people`, `/people/{id}`, `/month/{YYYY-MM}/summary`; **LLM:** `/day/{date}/recap`,
`/people/{id}/bio`; plus `/health`.

### pipeline/ (uv, Python 3.12) — heavy ML, mostly run by hand
```bash
cd pipeline && uv sync
uv run pytest               # cheap schema check on testcases/*.json only — NO models, no HF_TOKEN
uv run ruff check .

# Full pipeline (needs HF_TOKEN + model downloads; not run in CI):
HF_TOKEN=hf_xxx python diarize.py clip.wav -o diar.json --device cpu     # step 1
HF_TOKEN=hf_xxx python align.py clip.wav --diar diar.json --out out.json # step 2
```

## Architecture (the big picture)

Two tiers (DESIGN §4). **Edge tier** (`edge/` on the Pi) captures the **camera** and can
*optionally* run face detect on-device: camera → deterministic **parametric sprite params +
ts** (never raw video); a **hardware GPIO mute** button + LED (`gpiozero`) that cuts the
camera. The **microphone is app/phone-side**, not on the Pi. **App/cloud tier**
(`server/` + `app/`) does the **timeline alignment** (Pi frames ⟷ app audio by `ts`),
binding, storage, and non-real-time storytelling: bind utterance→character, store,
summarize, replay.

Data flow: Pi emits derived events (sprite params, embeddings, transcript text — no raw faces) →
`server/` upserts `people`, appends `events`, and at day-end an LLM writes a `recap` → `app/`
reads the API and renders it as a garden of days + Undertale-style dialogue playback.

**The data model is the contract that spans all workstreams** (DESIGN §9): `people`, `events`,
`days`, `recaps`. It appears three times and the shapes must stay aligned:
- `server/src/savepoint_server/models/` — Pydantic (source of truth). `MongoModel` base exposes
  Mongo `_id` as `id`; models use snake_case.
- `app/src/lib/seed.ts` — TS interfaces + hard-coded seed data the UI renders today. Comment says
  "keep the shapes close to DESIGN.md §9 so the swap [to the real API] is mechanical."

### server/ specifics
- `main.py` is an app factory (`create_app(settings)`), so tests inject `Settings`. `api/__init__.py`
  aggregates feature routers into `api_router`; add new routers there.
- Mongo client (`db/mongo.py`) is **lazy** — importing the app never needs a running DB, so CI and
  unit tests work without Mongo. `services/recap.py` generates a day's narrative recap via a
  pluggable `LLMClient` (`services/llm.py`); `POST /day/{date}/recap` exposes it. Default backend
  is self-hosted Gemma (`recap_backend` in `core/config.py`); the LLM is mocked in tests.
- Config via `pydantic-settings`, env prefix **`SAVEPOINT_`** (e.g. `SAVEPOINT_MONGO_URI`), loaded
  from `server/.env`. mypy is strict (untyped defs disallowed).
- LLM recaps target a self-hosted **Gemma** OpenAI-compatible endpoint; when calling it you must
  pass `chat_template_kwargs {"enable_thinking": false}` or the content comes back empty
  (see `core/config.py`).

### app/ specifics
- Tailwind **v4 is CSS-first** — there is no `tailwind.config.js`; theme lives in `src/styles/`
  (`theme.css` defines light/dark palettes, `globals.css`). Vite plugin is `@tailwindcss/vite`.
- `@/` aliases `src/`. Routes are **code-split** (`React.lazy` per page in `AppShell.tsx`); the
  shell (TopBar/BottomNav) stays mounted across `framer-motion` page transitions.
- Theming (`lib/theme.ts`) sets **both** `data-theme` and the `.dark` class on `<html>`
  (HeroUI + Tailwind belt-and-suspenders), persisted to localStorage.
- PWA-ready via static manifest in `index.html`/`public/` (no service worker yet).

### edge/ (uv, Python 3.11+) — sim mode needs no hardware
```bash
cd edge && uv sync
uv run savepoint-edge       # sim backend by default — synthetic camera/mute/detector
uv run pytest
uv run ruff check .

# Real hardware (Pi 5, Raspberry Pi OS) — see edge/README.md's "Setup on the Pi" for the
# apt + `uv venv --system-site-packages` steps picamera2/gpiozero require:
SAVEPOINT_EDGE_BACKEND=linux uv run savepoint-edge
```
- No QNX anywhere — an earlier QNX/C++ design was scrapped (QNX's own docs call its Pi 5 camera
  support "experimental" and it has no real ONNX Runtime port). `edge/README.md` explains why.
- `SAVEPOINT_EDGE_SINK` picks where events go: `stdout` (default) / `file:<path>` / `http://...`.
- `LinuxFaceDetector.detect()` runs real **SCRFD** (detection ONNX) → **ArcFace**
  (`w600k_mbf` embedding) via ONNX Runtime (PR #18); point `SAVEPOINT_EDGE_FACE_MODEL` /
  `SAVEPOINT_EDGE_FACE_EMBED_MODEL` at the `.onnx` files (not committed to the repo).

### pipeline/ specifics
- `align.py` and `diarize.py` are **vendored verbatim** from an upstream demo and are **exempt from
  ruff** (`extend-exclude` in pyproject) — don't reformat them.
- Two models are **gated on Hugging Face** and need `HF_TOKEN` (see pipeline/README §"Gated models").
- `transcribe.sh` **hardcodes `--device mps`** (Apple Silicon) and assumes a two-venv layout — do
  **not** use it on Linux/CI; call `diarize.py`/`align.py` directly with `--device cpu`.
- **Never add torch/whisper/pyannote to `ci-pipeline.yml`** — CI deliberately installs only
  ruff+pytest and runs the model-free `tests/test_testcases.py`. Real model behavior is checked by hand.

## Conventions

- **Conventional Commits** on every change. CI (format + lint + type-check + test + build) gates PRs.
- **Bind dev servers to `0.0.0.0`**, never `127.0.0.1` — teammates reach them over the tailnet or a
  `cloudflared` tunnel (see `docs/DEV.md`). Vite dev already allows `*.trycloudflare.com` hosts.
- **Free a port with `fuser -k <port>/tcp`** — never `pkill uvicorn` (it kills every server at once).
- The container is disposable; **GitHub is the only durable copy** — push in-flight work before any
  restart. `.env`/`.env.*` are gitignored; keep secrets out of commits.
