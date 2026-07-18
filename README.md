# SavePoint

> **Your life autosaves.**

A cozy, Stardew-Valley-style journal of your real day. A Raspberry Pi 5 wearable turns the
people you talk to into pixel characters; a companion PWA replays your day back as a calm,
structured game world — people become sprites, days become plants in a garden, and
conversations become video-game dialogue boxes you can revisit.

**Game-first, privacy-first.** The intelligence that matters — face detection and
who-said-what — runs on-device; raw faces never leave the wearable.

See [`DESIGN.md`](./DESIGN.md) for the full design and [`PLAN.md`](./PLAN.md) for the
execution plan.

---

## Monorepo layout

| Path         | What lives here                                                                   |
| ------------ | --------------------------------------------------------------------------------- |
| `app/`       | SavePoint PWA — React + TypeScript + HeroUI v3 + Tailwind v4 (Vite), cozy-pixel UI |
| `server/`    | FastAPI backend — event ingest, MongoDB store, Gemini/Backboard recaps, app API   |
| `pipeline/`  | Speech pipeline — diarization → overlap-split → transcription → `Speaker N: text`  |
| `edge/`      | Pi 5 IO-source capture (Raspberry Pi OS, face detect, GPIO mute + LED)            |
| `design/`    | Shared design assets (HeroUI theme baseline, tokens)                              |
| `docs/`      | Developer docs & runbooks                                                          |

---

## Quickstart

Requirements: **Node 20+** (with [pnpm](https://pnpm.io/)) for the app, and
**Python 3.11+** with [uv](https://docs.astral.sh/uv/) for the server & pipeline.

### App (PWA dev server)

```bash
cd app
pnpm install
pnpm dev --host 0.0.0.0    # Vite dev server, reachable on the tailnet
```

### Server (FastAPI dev server)

```bash
cd server
uv sync
uv run uvicorn savepoint_server.main:app --reload --host 0.0.0.0 --port 8000
```

Dev services bind to `0.0.0.0` so teammates can reach them over the tailnet (or via a
cloudflared tunnel). See [`docs/DEV.md`](./docs/DEV.md) for the full runbook.

---

*Hack the 6ix 2026 · Team SavePoint*
