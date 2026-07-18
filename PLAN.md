# SavePoint — Execution Plan

> *"Your life autosaves."* · **v6** · 2026-07-18

A Raspberry Pi 5 wearable turns the people you talk to into pixel characters; a companion
app is a cozy, Stardew-style journal of your day. This plan maps workstreams, owners, a
milestone roadmap, risks, the demo we protect, and prize alignment.

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

**Merged to `main` — PRs #1–#5:**

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
| **M2 — App on real data** | Frontend wired to the live API: character scene + day-view render real people/events; garden calendar. | ⏳ In progress |
| **M3 — Speech + recaps** | Real pipeline behind `/speech/transcribe` tuned; daily recap/bio via the chosen LLM backend (see §5); optional ElevenLabs-voiced dialogue. | ◻ Next |
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
| **Cross-device audio↔video sync** | 🟠 High | Put a **USB mic on the Pi** (one clock) instead of phone audio — dissolves the sync problem. If you keep phone audio, make **tap-to-assign** the real demo and treat auto-binding as a stretch. | A+B |
| **Recap/bio LLM backend unpicked** | 🟠 High | `recap.py` is still a placeholder. Spike **FreeSolo** (SAV-51) against gemma / Gemini / Backboard and lock one by M3; keep the call behind one interface so swapping is cheap. | B/D |
| **Thin-AI perception** | 🟠 High | Face-attribute detection alone reads as pedestrian. Lean the "creative AI" story on the deterministic-sprite identity + diarized who-said-what + the narrated recap. | B |
| **Scope creep** | 🟠 High | 6+ screens is too much. Build the 2 hero screens (character scene + day-view), mock the rest. Honor the cut-lines. | All |
| **Demo depends on live capture** | 🟡 Med | Seed a canned "today" so the app demos even if capture wobbles on stage. Record a backup video. | C+D |

---

## 5. Prize-alignment checklist

**No single "primary" anymore — weight by demo impact.** Submit to every track we
legitimately satisfy; each is judged independently.

| Track | What it needs / how we hit it | Owner |
|---|---|---|
| **FreeSolo** | Recap + character-bio generation via their **Flash fine-tuning** (OpenAI-compatible). Being spiked now — SAV-51. | B/D |
| **Backboard** | Multi-model orchestration for character bios + day/month recaps. | D |
| **ElevenLabs** | Voice the **Undertale-style dialogue playback** and/or narrate the daily recap. | C/D |
| **MongoDB** | The people · events · days · recaps store — already the backbone (shipped in M1). | D |
| **Gemini** | Natural-language daily recap + "who did I meet / what did we talk about" Q&A over the day. | D |
| **Best Hardware** | The Pi 5 device: camera/mic capture, optional on-device inference, hardware mute + LED. | A |

---

## 6. Proposed stack

- **Edge:** Pi 5 on a **regular Raspberry Pi OS** image; Pi Camera + USB mic; *optional*
  on-device OpenCV / ONNX face detect and a GPIO mute switch + LED. **No QNX / RTOS.**
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

1. **Recap/bio LLM backend:** FreeSolo (SAV-51 spike) vs. gemma vs. Gemini vs. Backboard —
   `recap.py` stays a placeholder until this lands.
2. **USB mic on the Pi, or keep audio on the phone?** (Recommend the Pi mic — dissolves
   cross-device sync.)
3. **Auto-binding vs. tap-to-assign** as the primary who-said-what for the demo.
4. **Which 2 screens are the hero screens** (proposed: character scene + day-view).
5. **How far to push M5** (on-device / Pi hardware polish) given remaining time.

---

> **The one thing that decides this project:** the core loop — **person → character →
> who-said-what → lands in "Today"** — is already live end-to-end (M1, merged to `main`).
> From here, every hour goes to what a judge actually sees: the app on real data, a
> narrated recap, and a clean hero-flow rehearsal. The Pi hardware and on-device inference
> are a bonus story now, not the anchor — weight everything by demo impact.
