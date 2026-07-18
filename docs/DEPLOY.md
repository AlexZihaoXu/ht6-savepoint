# SavePoint — Deployment runbook (SAV-17)

How each end of SavePoint is deployed for a demo / judging run, plus the
networking that ties them together. This is essentially what we already run for
the live prototype link, **plus the Pi**.

> ⚠️ **The actual deploy + end-to-end verification is a HUMAN task.** Running each
> end on real hardware (a laptop, a Pi 5, a phone) and confirming the full loop
> works is **human-manipulated** — it cannot be performed or verified by the
> agent (Claude). See [§7 Human verification](#7-human-verification-human-only).
> Every command below is meant for a person to run on the real devices.

## Topology at a glance

```
  📱 Phone (PWA + mic)  ──HTTPS cloudflared tunnel──▶  🗄️ Backend + MongoDB (laptop)
  🍓 Pi 5 (edge camera) ──tailnet IP :8000──────────▶        │  ▲
                                                             │  │ OpenAI-compat
                                                             ▼  │
                                                     🧠 Gemma LLM (Alex's box)
```

One laptop runs **backend + Mongo**; a **phone** runs the PWA (and is the mic);
a **Pi 5** runs the edge camera; **Gemma** stays on Alex's self-hosted box. No
cloud needed.

---

## 1. Backend + MongoDB (a laptop)

Mongo (data persists in `--dbpath`):

```bash
mongod --dbpath ~/mongo-data --port 27017 --bind_ip 127.0.0.1
```

Backend — bind `0.0.0.0` so the phone (via tunnel) and Pi (via tailnet) can both
reach it. Recap/bios/refine use Gemma; secrets are read from files, never pasted:

```bash
cd server
SAVEPOINT_MONGO_URI=mongodb://127.0.0.1:27017 \
SAVEPOINT_RECAP_BACKEND=gemma \
SAVEPOINT_GEMMA_BASE_URL=https://chat.alex-xu.site/v1 \
SAVEPOINT_GEMMA_API_KEY=$(cat ~/.gemma_token) \
SAVEPOINT_GEMMA_MODEL=gemma-4-12B-it-Q4_K_M.gguf \
uv run uvicorn savepoint_server.main:app --host 0.0.0.0 --port 8000
```

Optional add-ons (append to the env above):
- **Transcript cleanup** (Gemini→Gemma→raw, never blocks): `SAVEPOINT_TRANSCRIPT_REFINE=gemini SAVEPOINT_GEMINI_API_KEY=$(cat ~/.gemini_key)` — Gemma is the quota-free fallback, so cleanup works even without a live Gemini key.
- **Real diarization** (else the CI-safe stub answers): `SAVEPOINT_TRANSCRIBER=real SAVEPOINT_HF_TOKEN=$(cat ~/.hf_token)` — needs the pipeline venvs (`~/two-speaker-demo`) reachable and enough CPU/RAM for torch (see §5).

Expose it to the phone with a public HTTPS tunnel and grab the URL:

```bash
cloudflared tunnel --url http://localhost:8000        # → https://<name>.trycloudflare.com
```

Sanity: `curl -s http://127.0.0.1:8000/health` → `{"status":"ok"}`; `/docs` is the API surface.

## 2. Frontend PWA (the phone)

The Vite build reads `VITE_API_BASE` from `app/.env.local` (**not** shell env), so
point it at the backend's tunnel URL, build, serve the static output, and tunnel
that too:

```bash
cd app
echo "VITE_API_BASE=https://<backend-name>.trycloudflare.com" > .env.local
pnpm install && pnpm build
pnpm preview --host 0.0.0.0 --port 4173               # or any static server on dist/
cloudflared tunnel --url http://localhost:4173        # → https://<app-name>.trycloudflare.com
```

On the phone: open `https://<app-name>.trycloudflare.com/plaza`, then **Add to
Home Screen** (it's an installable PWA). HTTPS is required so the **mic**
(`getUserMedia`) works — the cloudflared tunnel provides it.

> For quick iteration you can instead run `pnpm dev --host` + a tunnel (Vite already
> allows `*.trycloudflare.com`); for a stable demo prefer the built `preview`.

## 3. Edge — Pi 5 (camera)

On the Pi (Raspberry Pi OS), copy the example env and point the sink at the
backend's **tailnet IP** (not the tunnel hostname — the sink's timeout bounds the
socket, not DNS, so an IP literal is robust for the always-on Pi):

```bash
cd edge
cp .env.example .env
# edit .env:
#   SAVEPOINT_EDGE_BACKEND=linux
#   SAVEPOINT_EDGE_SINK=http://100.64.151.86:8000/ingest/video   # backend's tailnet IP
#   SAVEPOINT_EDGE_FACE_MODEL / SAVEPOINT_EDGE_FACE_EMBED_MODEL = the ONNX model paths on the Pi
uv sync
set -a; . ./.env; set +a
uv run savepoint-edge
```

Requires the Pi hardware deps (`picamera2`, `gpiozero`, `onnxruntime`) — see
`edge/README.md` → "Setup on the Pi". The edge posts each detection as a JSON
array (`list[EdgeEvent]`) to `/ingest/video`; a confirmed face shows up as a
`seen` event + upserted Person.

## 4. Gemma LLM (Alex's self-hosted box)

Already running at `https://chat.alex-xu.site/v1` (OpenAI-compatible). Nothing to
deploy — the backend reaches it via the `SAVEPOINT_GEMMA_*` env in §1. Note: the
Gemma call **must** send `chat_template_kwargs {"enable_thinking": false}` (the
code does this) or content comes back empty.

## 5. Speech pipeline (server-side)

Diarization + transcription (`pyannote → SepFormer → faster-whisper`) run
**server-side**, out-of-process, only when `SAVEPOINT_TRANSCRIBER=real`. It needs
the two vendored venvs (`~/two-speaker-demo/.venv` + `.venv-stream`), an
`HF_TOKEN` for the gated models, and enough CPU/RAM (torch is heavy — a weak
laptop may OOM; run it on a beefier box, or keep the **stub** for the demo). The
default stub returns a canned transcript so the whole flow is exercisable without
torch.

## 6. Networking summary

| Link | How | Why |
| --- | --- | --- |
| Phone → Backend | cloudflared **HTTPS tunnel** | mic `getUserMedia` needs HTTPS; phone need not be on the tailnet |
| Pi → Backend | **tailnet IP** `:8000/ingest/video` | robust (IP literal, no DNS hang); both on the tailnet |
| Backend → Gemma | `SAVEPOINT_GEMMA_BASE_URL` | recaps / bios / transcript cleanup |
| Backend ↔ Mongo | `127.0.0.1:27017` | same box |

Bind dev servers to `0.0.0.0` (never `127.0.0.1`). Free a port with
`fuser -k <port>/tcp` — never `pkill uvicorn`. Every tunnel restart mints a **new**
`*.trycloudflare.com` URL — re-grab it and re-point `.env.local` / the Pi sink.

---

## 7. Human verification (HUMAN-ONLY)

**This section is a human-manipulated task — it cannot be run or verified by the
agent.** It requires physically operating real hardware. A team member runs it:

1. Bring up **backend + Mongo + tunnel** (§1) on the laptop; confirm `/health` + `/docs`.
2. Bring up the **PWA** (§2) on the phone; open `/plaza`, confirm it loads people/days.
3. Bring up the **Pi** (§3) pointed at the backend's tailnet IP.
4. **Full-loop smoke** (the demo): stand in front of the Pi camera → confirm a
   `seen` event + a Person appears (`GET /people` / the plaza). On the phone, tap
   the **mic**, speak a few lines, stop → confirm the clip uploads and the day's
   scene shows the dialogue. Use **tap-to-name** to bind a `Speaker N` to the
   person. Open the day → confirm the recap + bios render.
5. Confirm the two streams **align on the timeline** (the spoken lines land near
   the `seen` events by wall-clock time).

Report pass/fail per step. Anything broken here is a real integration bug to file.
