# SavePoint — Execution Plan

> *"Your life autosaves."* · draft v1 — **review & edit before we start**

A QNX-on-Pi device turns the people you talk to into pixel characters; a companion app
is a cozy, Stardew-style journal of your day. This plan maps workstreams, owners, a
phased timeline, risks, the demo we protect, and prize alignment. **Everything here is a
proposal to argue with.**

---

## ✅ Already in hand (reuse it)

Built during prep — this de-risks a lot of Day 1:

- A working **speech-separation demo** (mic → VAD → Whisper → ECAPA speaker
  **enrollment**) with a live **calibration slider**.
- A **`/label` validation tool** (upload video → predicted vs. hand-labeled accuracy,
  JSON export).
- A **clickable SavePoint UI mock** (character scene, garden calendar, people log, person
  info, day-view timeline playback — now **Undertale-style** dialogue).
- The **repo** (initial commit staged) + confirmed **QNX Pi 5 flashing** path.

---

## 1. Workstreams & suggested owners

| Stream | Scope | Suggested lead | Key deliverable |
|---|---|---|---|
| **A. Edge / QNX** | Flash QNX on Pi 5, camera capture, on-device face-detect + attributes (oss.qnx.com AI module), **hardware mute switch** (GPIO), emit event JSON. *This is the $1000 prize.* | **alexxbot** (hardware) | A Pi that detects a face on-device & streams events, with a cannot-fail mute |
| **B. Speech / AI** | Speaker enrollment + who-said-what binding, transcript, feed into the day log. Mostly **done** (demo) — integrate + tune. | **zangjiucheng** | "Person X said ___" events with stable identities |
| **C. App / UX** | SavePoint front-end: character scene, garden, people log, person info, day-view playback (Undertale dialogue). Mock exists → wire to real data. | **waterprism** + **diamondpixals** | Polished, clickable app on real (or seeded) data |
| **D. Backend / Integrate** | Server binds Pi events + audio → characters + day log; MongoDB store; Gemini/Backboard recaps; the API the app reads. | **zangjiucheng** / shared | One pipeline: capture → store → app |

*Owners are a starting guess from who's been asking what — reassign freely. With 4 people,
A and C run in parallel; B is largely built; D is the glue one person owns end-to-end.*

---

## 2. Phased timeline (map onto the real HT6 clock)

| Phase | What happens |
|---|---|
| **Pre-event** (now → start) | **De-risk QNX now:** flash the Pi 5, run *one* test inference (ONNX/OpenCV face detect) on QNX → confirm the AI-module path works. Get: USB mic + camera + jumpers/button for the mute switch. Create accounts/keys: Gemini, Backboard, MongoDB Atlas, Presage. Enroll 3–4 teammates' voices. Lock the stack. Seed the repo. |
| **Day 1 AM** | **QNX go/no-go checkpoint** (camera frame + AI module running on QNX). If *no-go by lunch* → Linux-on-Pi fallback **decided now**, not at hour 20. In parallel: app shell from the mock (C), backend + Mongo skeleton (D). |
| **Day 1 PM** | Edge: face → parametric sprite params on-device; wire the **hardware mute + LED**. Backend: event ingest + upsert people. App: character scene renders from *real* events. **Milestone: meet someone → they appear as a character.** |
| **Day 2 AM** | Integrate speech (B): enrolled who-said-what → day log; build the **Day-view timeline** with dialogue playback; Gemini/Backboard daily recap. App: people log + person info. |
| **Day 2 PM** | Presage on the *phone* (emotion → sprite mood), *if* pursuing it. Polish: Undertale dialogue, garden calendar, empty state, transitions. Seed fallback data so the demo never depends on live capture. |
| **Final** (last 3–4h) | **Freeze features.** Rehearse the 2-min demo 3×. Record a backup video. Write & submit the Devpost to every track you legitimately hit. |

---

## 3. The demo we protect (MVP hero-flow) + cut-lines

**Hero flow (build backward from this):** a judge walks up and talks to the wearer →
within ~3s they appear on the Pi as a **Stardew character** (attributes read on-device) →
their words attach to *their* character (enrolled voice) → it lands in **"Today"** with an
Undertale-style recap and a one-line Gemini summary → toggle the **hardware mute** and
recording visibly stops. **The vision runs on the Pi.**

**Cut-lines, in the order you sacrifice them if time runs short:**
1. Presage emotion → first to go.
2. Month/year garden rollups → static mock.
3. Live audio auto-binding → fall back to "person in frame = speaker" or tap-to-assign.
4. Cross-day face re-ID → session-scoped.

**Never cut:** the on-device face detect + the hardware mute (that pair *is* the QNX prize).

---

## 4. Risk register

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| **QNX viability is binary** | 🔴 Critical | De-risk *before* the event (flash + 1 test inference). Day-1 go/no-go. Linux fallback saves the *demo* but forfeits the $1000 — so make QNX work early. Confirm with a mentor that "our model on their runtime" satisfies the oss.qnx.com rule. | A |
| **Cross-device audio↔video sync** | 🔴 Critical | Put a **USB mic on the Pi** (one clock) instead of phone audio — dissolves the sync problem. If you keep phone audio, make **tap-to-assign** the real demo and treat auto-binding as a stretch. | A+B |
| **Presage vs. privacy spine** | 🟠 High | "Raw faces never leave the Pi" carries your privacy *and* QNX story; Presage needs face frames + can't run on QNX. Run it on the phone only, or **drop it** rather than undermine the core. | B/C |
| **Thin-AI perception** | 🟠 High | Face-attribute detection alone reads as pedestrian. Lean the "creative AI" story on real-time + privacy-by-locality + the enrolled who-said-what. | A+B |
| **Scope creep** | 🟠 High | 6+ screens is too much. Build the 2 hero screens (character scene + day-view), mock the rest. Honor the cut-lines. | All |
| **Demo depends on live capture** | 🟡 Med | Seed a canned "today" so the app demos even if capture wobbles on stage. Record a backup video. | C+D |

---

## 5. Prize-alignment checklist

| Track | What it needs / how we hit it | Owner |
|---|---|---|
| **QNX ($1000)** | On-device face + attribute inference via an oss.qnx.com module; **hardware mute** = cannot-fail/real-time; runs on the Pi, not cloud. *Primary — protect it.* | A |
| **Presage** | Contactless emotion of your conversation partner (phone) → sprite mood. Optional/last. | B/C |
| **Gemini** | Natural-language daily recap + "who did I meet / what did we talk about" Q&A. | D |
| **Backboard** | Multi-model orchestration for character bios + recaps. | D |
| **MongoDB** | Store the character roster, event log, day/month aggregates. | D |

*Only one of Best Hardware / Environmental / Beginner — this is a clear **Best Hardware**
candidate too. Submit to every track you legitimately satisfy; each is judged
independently.*

---

## 6. Proposed stack (lock this in review)

- **Edge:** Pi 5 + QNX SDP 8.0 (QSTI image); ONNX Runtime / OpenCV from oss.qnx.com;
  SCRFD/BlazeFace + MobileFaceNet (face); GPIO mute switch + LED; USB mic (recommended).
- **Speech:** faster-whisper (base) + ECAPA enrollment (already built).
- **Backend:** FastAPI + MongoDB Atlas; MQTT/WebSocket event stream Pi→server; Gemini +
  Backboard for recaps.
- **App:** the SavePoint front-end (single-page, cozy pixel, Undertale dialogue) as a PWA
  (web + phone, one codebase).
- **Sprites:** parametric assembly from attributes (deterministic — same person, same
  sprite), *not* gen-art.

---

## 7. Open decisions to settle in review

1. **USB mic on the Pi, or keep audio on the phone?** (Biggest architecture fork — I
   recommend the Pi mic.)
2. **Presage: in or out?** (Secondary prize vs. risk to the privacy narrative.)
3. **Auto-binding vs. tap-to-assign** as the primary who-said-what for the demo.
4. **Confirm owners** for A/B/C/D and who owns the end-to-end integration (D).
5. **Which 2 screens are the hero screens** (proposed: character scene + day-view).
6. **Map the phases** onto the actual HT6 start time / hack-window length.

---

> **The one thing that decides this project:** get *a* model doing inference on QNX early
> (Day-1 morning, ideally before the event). Everything else — app, speech, recaps —
> you've largely got. The prize and the story both hinge on "it runs on the Pi," so
> front-load that and protect the on-device-face + hardware-mute pair above all else.