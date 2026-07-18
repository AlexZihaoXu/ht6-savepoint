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

> 📋 **Every configurable setting (env var, default, required?, where the secret
> lives) is tabulated in [§8 Configuration reference](#8-configuration-reference--every-setting).**

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

---

## 8. Configuration reference — every setting

Everything you can configure, per end. **Secrets are read from files** (paths in
§8.4) and passed via env at runtime — never committed. Any var left unset uses its
default.

### 8.1 Backend (`server/`)

Config is `pydantic-settings` with env prefix **`SAVEPOINT_`** (so field
`mongo_uri` → env `SAVEPOINT_MONGO_URI`). Set them in the shell before `uvicorn`
(as in §1) or in a `server/.env` file (gitignored). Source: `server/src/savepoint_server/core/config.py`.

| Env var | What it does | Req? | Default | Where to get / notes |
| --- | --- | --- | --- | --- |
| `SAVEPOINT_HOST` | bind address | no | `0.0.0.0` | keep `0.0.0.0` so phone+Pi can reach it |
| `SAVEPOINT_PORT` | port | no | `8000` | — |
| `SAVEPOINT_CORS_ORIGINS` | allowed CORS origins (JSON list) | no | `["*"]` | leave as `*` for the demo |
| `SAVEPOINT_MONGO_URI` | MongoDB connection | **yes** | `mongodb://127.0.0.1:27017` | local `mongod` (§1) |
| `SAVEPOINT_MONGO_DB` | database name | no | `savepoint` | — |
| `SAVEPOINT_RECAP_BACKEND` | LLM for daily recaps + bios | no | `gemma` | `gemma` \| `gemini` \| `backboard` \| `freesolo` — use **gemma** |
| `SAVEPOINT_GEMMA_BASE_URL` | Gemma OpenAI-compat endpoint | **for recaps/bios** | `http://127.0.0.1:8000/v1` *(placeholder — MUST override)* | Alex's box: `https://chat.alex-xu.site/v1` |
| `SAVEPOINT_GEMMA_API_KEY` | Gemma token | **for recaps/bios** | *none* | file `~/.gemma_token` |
| `SAVEPOINT_GEMMA_MODEL` | Gemma served model name | **for recaps/bios** | `gemma` | live value: `gemma-4-12B-it-Q4_K_M.gguf` |
| `SAVEPOINT_TRANSCRIPT_REFINE` | optional transcript cleanup engine | no | `none` | `none` \| `gemini` \| `gemma`. `gemini` = Gemini→Gemma fallback; `gemma` = Gemma only. Never blocks ingest |
| `SAVEPOINT_GEMINI_API_KEY` | Gemini key (for refine `gemini` mode) | no | *none* | file `~/.gemini_key` (demo key, quota may be exhausted → falls back to Gemma) |
| `SAVEPOINT_GEMINI_MODEL` | Gemini model | no | `gemini-2.0-flash` | — |
| `SAVEPOINT_TRANSCRIBER` | speech engine | no | `stub` | `stub` (canned, CI-safe) \| `real` (runs the pipeline, §5) |
| `SAVEPOINT_HF_TOKEN` | HuggingFace token for gated diarization models | **for `real`** | *none* | file `~/.hf_token` |
| `SAVEPOINT_SPEECH_PIPELINE_DIR` | vendored pipeline dir (real transcriber) | no | `/home/agent/two-speaker-demo` | the `two-speaker-demo` checkout on the box |
| `SAVEPOINT_SPEECH_DIARIZE_PYTHON` | diarize venv python | no | `<dir>/.venv/bin/python` | override only if venv path differs |
| `SAVEPOINT_SPEECH_ALIGN_PYTHON` | align venv python | no | `<dir>/.venv-stream/bin/python` | override only if venv path differs |
| `SAVEPOINT_SPEECH_WHISPER_MODEL` | faster-whisper model | no | `small.en` | — |
| `SAVEPOINT_FREESOLO_BASE_URL` / `_API_KEY` / `_MODEL` | FreeSolo recap backend | no (only if `recap_backend=freesolo`) | modal URL / *none* / run-id | file `~/.freesolo_sav51.txt`; not needed for the gemma demo |
| `SAVEPOINT_BACKBOARD_API_KEY` | Backboard recap backend | no | *none* | only if `recap_backend=backboard` |

### 8.2 Frontend (`app/`)

Vite reads these from **`app/.env.local`** (a file — NOT shell env) at build time.

| Env var | What it does | Req? | Default | Where to get |
| --- | --- | --- | --- | --- |
| `VITE_API_BASE` | base URL the PWA calls | **yes** | `http://127.0.0.1:8000` | the **backend's cloudflared tunnel URL** (so the phone can reach it over HTTPS) |

### 8.3 Edge (`edge/`, the Pi)

Set in **`edge/.env`** (copy from `edge/.env.example`).

| Env var | What it does | Req? | Default | Where to get / notes |
| --- | --- | --- | --- | --- |
| `SAVEPOINT_EDGE_BACKEND` | capture source | **yes** | `sim` | `linux` on the real Pi (picamera2/gpiozero/onnxruntime) |
| `SAVEPOINT_EDGE_SINK` | where events go | **yes** | `stdout` | `http://<backend-tailnet-ip>:8000/ingest/video` — use the **tailnet IP** (e.g. `100.64.151.86`), not the tunnel hostname |
| `SAVEPOINT_EDGE_FACE_MODEL` | SCRFD detection ONNX path | **for `linux`** | *empty* | model file on the Pi (not committed) |
| `SAVEPOINT_EDGE_FACE_EMBED_MODEL` | ArcFace embedding ONNX path | **for `linux`** | *empty* | model file on the Pi (not committed) |

### 8.4 Secret files (paths only — never paste values)

| File | Used by | For |
| --- | --- | --- |
| `~/.gemma_token` | backend | `SAVEPOINT_GEMMA_API_KEY` (recaps, bios, refine) |
| `~/.gemini_key` | backend | `SAVEPOINT_GEMINI_API_KEY` (optional refine; demo key) |
| `~/.hf_token` | backend / pipeline | `SAVEPOINT_HF_TOKEN` (gated diarization models) |
| `~/.freesolo_sav51.txt` | backend | FreeSolo key (only if `recap_backend=freesolo`) |
| `~/.linear_key`, `~/.ht6_token` | tooling | Linear API / GitHub PAT (not runtime) |

> Read secrets inline, e.g. `SAVEPOINT_GEMMA_API_KEY=$(cat ~/.gemma_token)`. `.env`
> / `.env.*` are gitignored (except `edge/.env.example`); never commit a real value.

### 8.5 Minimal vs full backend env

- **Minimal demo** (stub speech, no cleanup): just `SAVEPOINT_MONGO_URI` + the three
  `SAVEPOINT_GEMMA_*` (for recaps/bios). This is what the live prototype runs.
- **Full** (real diarization + transcript cleanup): add `SAVEPOINT_TRANSCRIBER=real`
  + `SAVEPOINT_HF_TOKEN`, and `SAVEPOINT_TRANSCRIPT_REFINE=gemini` (or `gemma`).

