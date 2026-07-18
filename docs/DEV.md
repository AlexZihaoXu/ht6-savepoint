# Developer runbook

Practical notes for running SavePoint locally and sharing demos during the hackathon.

## Toolchain

- **Node → TypeScript.** App uses Node 20+ with **pnpm**.
- **Python → uv.** Server and pipeline use Python 3.11+ managed with **uv** (`uv sync`,
  `uv run …`).
- **Conventional Commits** on every change; CI runs format + lint + type-check + test +
  build as required checks.

## Running the services

Each component has its own dev server. **Always bind to `0.0.0.0`** so teammates can reach
it over the tailnet (or through a tunnel) — never bind to `127.0.0.1` for anything the team
needs to click.

| Service       | Dir         | Command                                                                 | Port   |
| ------------- | ----------- | ----------------------------------------------------------------------- | ------ |
| App (PWA)     | `app/`      | `pnpm dev --host 0.0.0.0`                                                | 5173   |
| Backend API   | `server/`   | `uv run uvicorn savepoint_server.main:app --reload --host 0.0.0.0 --port 8000`        | 8000   |
| Speech demo   | `pipeline/` | see `pipeline/README.md`                                                 | varies |

## Sharing a service (demo links)

Two ways to expose a locally-bound service:

1. **Tailnet IP link** — share `http://<tailnet-ip>:<port>` with teammates on the tailnet.
   Get the current IP with `tailscale ip -4`. (Do **not** use `tailscale serve`.)
2. **Public tunnel** — `cloudflared tunnel --url http://localhost:<port>` mints a
   `*.trycloudflare.com` URL for judges/external viewers.

> **Tunnels are re-minted on every restart.** Each container restart kills running services
> and their tunnels, and a fresh `*.trycloudflare.com` URL is issued. Old links in chat
> history are dead — always grab the new URL from the tunnel log and repost it. Never let
> anyone click a stale link.

## Ports & processes

- **Kill by port, never broadly.** To free a port use `fuser -k <port>/tcp` — do **not**
  `pkill uvicorn` (it takes down every server at once).

## Environment & secrets

- Secrets live in untracked local files (paths only, never commit values). `.env` /
  `.env.*` are gitignored.
- The container is disposable; **GitHub is the only durable copy.** Push in-flight work to
  its feature branch before any restart or risky operation.
