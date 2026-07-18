# SavePoint — Execution Plan

> *"Your life autosaves."* · **v7** · 2026-07-18

A Raspberry Pi 5 wearable turns the people you talk to into pixel characters; a companion
app is a cozy, Stardew-style journal of your day. This plan maps workstreams, owners, a
milestone roadmap, risks, the demo we protect, and prize alignment.

### What changed in v7

- **M2 read API + M3 recap & scorer shipped** (PRs #7, #10, #11, #12). The app has a full
  read API (`/today`, `/day/{date}`, `/people`, `/days`), and **daily recaps are live** —
  a cozy Stardew-toned narrative generated from a day's events, running on the self-hosted
  **gemma** endpoint by default (verified end-to-end). A **CI-safe speech accuracy scorer**
  (`pipeline/score.py`) landed too, plus a day **`plant_stage`** growth signal.
- **`recap.py` is no longer a placeholder** — it's implemented behind a pluggable
  `LLMClient`; the backend swaps (gemma → Gemini / Backboard / FreeSolo) via **one config
  value** (`recap_backend`), no code change.
- **FreeSolo spike (SAV-51) done.** Finding: Flash is a **fine-tuning service, not a
  drop-in LLM API** — it needs a trained + deployed LoRA adapter (no serverless base-model
  endpoint). So it's a **prize-track play, not a necessity**; gemma covers recaps today.
- **`edge/` merged** (PR #8): a Pi 5 capture package (tested sim backend + a
  hardware-unverified linux backend) — `edge` is now a 4th required CI check.
- **Frontend redesign in progress** (waterprism): a 3-screen game-world layout — a
  **character plaza** (people wander + a whistle-to-line control), a **calendar garden**
  (each day a user-picked plant, auto-suggested), and a **cinematic Day view** (dialogue
  boxes + a timeline scrubber over event times + a transcript-history toggle). Maps ~1:1
  onto the read API. Sprite system = palette-swappable layered parts from the 6 avatar
  axes (design being settled before build).

### What changed in v6

- **QNX is dropped.** The Pi 5 stays as the camera/mic **IO source**, but on a **regular
  Linux image (Raspberry Pi OS) — no QNX RTOS.** The old "edge-migration → QNX prize"
  framing is gone; any optional on-device inference and the hardware mute now just run on
  plain Pi OS. Still a nice hardware story, no longer an RTOS-prize story.
- **Prizes realigned.** No single "primary" anymore — weight work by demo impact across
  **FreeSolo · Backboard · ElevenLabs · MongoDB · Gemini** (all confirmed HT6 2026
  sponsors), plus **Best Hardware** for the device.
- **M0 + M1 shipped.** The monorepo scaffold (M0) and the full backend e2e (M1) are
  **merged to `main`** (PRs #1–#5). The backend runs live + tunneled, so the frontend now
  builds against real endpoints (`/docs`, `/openapi.json`).

---

## ✅ Shipped so far

**Merged to `main` — PRs #1–#12:**

- **M0 · Monorepo scaffold — DONE.** React 19 + HeroUI v3 + Tailwind v4 + framer-motion
  PWA (`app/`), FastAPI + uv server (`server/`), the vendored speech pipeline
  (`pipeline/`), and **CI required on `main`** (format + lint + type-check + test + build).
- **M1 · Backend e2e, no hardware — DONE.** `POST /ingest` takes a frame + audio and
  produces a **deterministic Mii-style Person + sprite** (OpenCV Haar face detect), a
  **diarized-transcript set of Events**, and a **Day** — all persisted in **MongoDB**.
  Endpoints `/health`, `/vision/analyze`, `/speech/transcribe`, and `/ingest` are live in
  Swagger `/docs`. Speech runs behind a `Transcriber` protocol: a stub for CI, the real
  vendored pipeline behind a subprocess. The backend runs **live + tunneled**, so the team
  builds the frontend straight against `/docs` + `/openapi.json` (and is free to redesign
  the UI itself).
- **M2 · Read API — DONE** (PR #7). `GET /today`, `/day/{date}`, `/people`,
  `/people/{id}`, `/days` — the composed views the app renders (people plaza, garden
  calendar, day playback). Each day carries a `plant_stage` growth signal (PR #12).
- **M3 · Daily recap + accuracy scorer — DONE** (PRs #10, #11). A cozy narrative + 2–4
  highlights per day via a pluggable `LLMClient` (**gemma** default, verified live);
  `POST /day/{date}/recap`. Plus a stdlib-only speech accuracy scorer
  (`pipeline/score.py`: speaker-attribution + WER + speaker-count vs `tc1–tc5`).
- **`edge/` · Pi 5 capture — MERGED** (PR #8). HAL protocol → tested sim backend +
  hardware-unverified linux backend (picamera2/gpiozero/onnxruntime) + event sinks;
  emits derived events (sprite params + embedding), no raw frames. 4th required CI check.

**Reused from prep:**

- The vendored **speech pipeline** (diarization → transcription → merged `Speaker N: text`).
- A **clickable SavePoint UI mock** (character scene, garden, people log, person info,
  day-view) that informs the app's design language.

---

## 1. Workstreams & suggested owners

| Stream | Scope | Suggested lead | Key deliverable |
|---|---|---|---|
| **A. Edge / IO (Pi 5)** | Camera + USB-mic capture on a **regular Raspberry Pi OS** image; stream frame+audio to the server. *Optional:* on-device face detect + a **hardware GPIO mute switch + LED** (a nice hardware story, not required for the core loop). | **alexxbot** (hardware) | A Pi that captures and streams IO the server can ingest; optional mute demo |
| **B. Speech / AI** | Diarized who-said-what → transcript → events, plus the recap/bio LLM backend. Pipeline is **vendored** and wired into `/speech/transcribe`. | **zangjiucheng** | Stable `Speaker N: text` events + a chosen recap backend |
| **C. App / UX** | SavePoint front-end: character scene, garden, people log, person info, day-view playback (Undertale dialogue). Wire to the **live backend** (`/openapi.json`). | **waterprism** + **diamondpixals** | Polished, clickable app on real backend data |
| **D. Backend / Integrate** | Server binds frame+audio → Person + sprite + events + day; MongoDB store; Gemini / Backboard / FreeSolo recaps; the API the app reads. **Core path (M1) is done** — now recaps + hardening. | **zangjiucheng** / shared | One pipeline: capture → store → app (**live**) |

*With 4 people, A and C run in parallel; B owns speech + the recap backend; D owns the
glue and is already live end-to-end. Reassign freely.*

---

## 2. Milestones & status

| Milestone | Scope | Status |
|---|---|---|
| **M0 — Scaffold** | Monorepo: PWA (`app/`) + FastAPI server (`server/`) + vendored `pipeline/`; CI required on `main`. | ✅ **Done** (PRs #1–#5) |
| **M1 — Backend e2e** | `POST /ingest` → Person + sprite + diarized events + Day in MongoDB; `/health`, `/vision/analyze`, `/speech/transcribe`, `/ingest` in `/docs`; backend **live + tunneled**. | ✅ **Done** (PRs #1–#5) |
| **M2 — Read API + App on real data** | Read API (`/today`, `/day`, `/people`, `/days`) **done** (PR #7). App wiring to the live API is **in progress** — and the UI is being **redesigned** (waterprism) into the character-plaza / calendar-garden / cinematic-day-view layout. | ⏳ App wiring in progress (API done) |
| **M3 — Speech + recaps** | Daily recap **done** — cozy narrative via a pluggable LLM backend, live on **gemma** (PR #10). CI-safe accuracy scorer **done** (PR #11). Remaining: tune the real pipeline behind `/speech/transcribe`; *optional* ElevenLabs-voiced dialogue. | ✅ Recap + scorer done |
| **M4 — Demo hardening** | Seed a canned "today", rehearse the hero flow 3×, record a backup video, submit Devpost to every track we hit. | ◻ Before freeze |
| **M5 — Optional on-device / Pi polish** | *(formerly the QNX edge migration — no longer the anchor)* Move face detect / hardware mute onto the Pi for the hardware story, time permitting. | ◻ Optional |

---

## 3. The demo we protect (MVP hero-flow) + cut-lines

**Hero flow (build backward from this):** a judge walks up and talks to the wearer → the
Pi's frame + audio hit **`POST /ingest`** → within a few seconds they appear as a
**Stardew / Mii-style character** (a deterministic sprite from face attributes) → their
words attach to *their* character (diarized who-said-what) → it lands in **"Today"** with
an Undertale-style dialogue recap and a one-line LLM summary. *Optional flourish:* toggle
the **hardware mute** and capture visibly stops.

**Cut-lines, in the order you sacrifice them if time runs short:**

1. On-device inference / hardware mute → keep capture on the Pi, inference on the server.
2. Month/year garden rollups → static mock.
3. Live audio auto-binding → fall back to "person in frame = speaker" or tap-to-assign.
4. Cross-day face re-ID → session-scoped.

**Never cut:** the core game loop — **person → character → who-said-what → lands in
"Today."** That loop is live today (M1) and is the whole product.

---

## 4. Risk register

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| **Cross-device audio↔video sync** | 🟠 High | **Decided:** mic = app/phone, camera = Pi; the **server aligns the two streams by timestamp**. Needs comparable clocks (NTP) on both devices; likely decouple `/ingest` into separate frame/audio streams joined by `ts`. Keep **tap-to-assign** as the demo fallback if alignment is loose on stage. | A+B+D |
| **Recap/bio LLM backend** | 🟢 Resolved | `recap.py` is **implemented on gemma** (M3, live) behind a pluggable `LLMClient` — swapping to Gemini/Backboard/FreeSolo is one config value. FreeSolo spike done (SAV-51): fine-tuning-only, a prize-track option not a dependency. | B/D |
| **Thin-AI perception** | 🟠 High | Face-attribute detection alone reads as pedestrian. Lean the "creative AI" story on the deterministic-sprite identity + diarized who-said-what + the narrated recap. | B |
| **Scope creep** | 🟠 High | 6+ screens is too much. Build the 2 hero screens (character scene + day-view), mock the rest. Honor the cut-lines. | All |
| **Demo depends on live capture** | 🟡 Med | Seed a canned "today" so the app demos even if capture wobbles on stage. Record a backup video. | C+D |

---

## 5. Prize-alignment checklist

**No single "primary" anymore — weight by demo impact.** Submit to every track we
legitimately satisfy; each is judged independently.

| Track | What it needs / how we hit it | Owner |
|---|---|---|
| **FreeSolo** | Recap/bio via their **Flash fine-tuning**. Spike done (SAV-51): Flash is fine-tuning-only (no drop-in base-model API) → to win this we'd train + deploy a small cozy-recap LoRA (dataset seedable from gemma). Optional prize play; gemma covers recaps today. | B/D |
| **Backboard** | Multi-model orchestration for character bios + day/month recaps. | D |
| **ElevenLabs** | Voice the **Undertale-style dialogue playback** and/or narrate the daily recap. | C/D |
| **MongoDB** | The people · events · days · recaps store — already the backbone (shipped in M1). | D |
| **Gemini** | Natural-language daily recap + "who did I meet / what did we talk about" Q&A over the day. | D |
| **Best Hardware** | The Pi 5 device: camera/mic capture, optional on-device inference, hardware mute + LED. | A |

---

## 6. Proposed stack

- **Edge:** Pi 5 on a **regular Raspberry Pi OS** image; **Pi Camera only** (mic is
  app/phone-side; server timeline-aligns); *optional* on-device OpenCV / ONNX face detect
  and a GPIO mute switch + LED. **No QNX / RTOS.**
- **Speech:** the vendored **diarization → transcription** pipeline (merged
  `Speaker N: text`), behind a `Transcriber` protocol (stub for CI, real pipeline via a
  subprocess).
- **Backend:** **FastAPI + uv**, **MongoDB** (people / events / days / recaps); recaps via
  the chosen LLM backend — **FreeSolo (spiking, SAV-51) / Gemini / Backboard**, optional
  **ElevenLabs** narration. Runs **live + tunneled**.
- **App:** React 19 + HeroUI v3 + Tailwind v4 + framer-motion **PWA** (cozy pixel,
  Undertale dialogue).
- **Sprites:** parametric assembly from attributes (deterministic — same person, same
  sprite), *not* gen-art.

---

## 7. Open decisions to settle

1. **Recap/bio LLM backend — settled on gemma for now** (implemented, live). Open sub-question:
   do we invest in the **FreeSolo prize** (train + deploy a cozy-recap LoRA), or stay on gemma?
2. **Who implements the redesigned frontend** — waterprism owns the design; is the dev-agent
   wiring `app/` to the live API, or is the team building it? (Blocks the M2 app milestone.)
3. **Speaker → Person link** — dialogue events currently carry diarized `Speaker N` labels,
   not identified people. Need a mechanic to tie a line to the right character sprite.
4. **Cross-device sync (decided):** mic = app/phone, camera = Pi, **server aligns by
   timestamp**. Open: the clock-sync scheme (NTP?) and whether to split `/ingest` into
   separate frame/audio streams joined by `ts`.
5. **Auto-binding vs. tap-to-assign** as the primary who-said-what for the demo.
6. **How far to push M5** (on-device / Pi hardware polish) given remaining time.

---

> **The one thing that decides this project:** the core loop — **person → character →
> who-said-what → lands in "Today"** — is already live end-to-end (M1, merged to `main`).
> From here, every hour goes to what a judge actually sees: the app on real data, a
> narrated recap, and a clean hero-flow rehearsal. The Pi hardware and on-device inference
> are a bonus story now, not the anchor — weight everything by demo impact.
