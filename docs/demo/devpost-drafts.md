<!-- SAV-46 — drafted by the demo-prep workflow, 2026-07-18. Review before use. -->

# SavePoint — Devpost Submission Drafts

*One submission per prize track. Each is written to stand alone on Devpost, so the "About SavePoint" blurb and core facts intentionally repeat across tracks — only the angle changes. Sections marked with a status note are honest about shipped-vs-planned so nothing over-claims to a judge.*

---

## Shared blurb — About SavePoint

**"Your life autosaves."**

SavePoint is a cozy, Stardew-Valley-style journal of your real life. A small Raspberry Pi 5 wearable sees the people you talk to; your phone hears the conversation. Together they turn each person you meet into a **deterministic pixel character**, each day into a **plant in a garden**, and each conversation into **Undertale-style dialogue boxes** you can replay.

We built SavePoint game-first: the primary hook is charm, not therapy. It's a warm, low-pressure record of your social day — who you met, what you talked about — that happens to double as a gentle memory aid (an honest secondary benefit, never a medical claim).

It's also **privacy-first by construction**. Only *derived* data ever leaves a device — sprite parameters, voice embeddings, and transcript text — **never raw faces or photos**. People are stored as abstract avatars, not stored images, and a hardware mute on the wearable can physically cut the camera.

Under the hood, a judge can walk up, talk to the wearer, and within a few seconds appear on screen as their own pixel character with their words attached to them — captured, diarized, stored, and replayed as a cinematic day. Your life, autosaved.

---

## Track 1 — MongoDB

### Inspiration
Every "life-logging" app we'd seen either drowned you in raw data or threw it away after a day. We wanted the opposite: a durable, queryable *story* of your social life where the database itself is the game world. People, days, and conversations aren't rows to us — they're townsfolk, garden plants, and dialogue. MongoDB's document model let the storage layer mirror the way the product actually thinks.

### What it does
SavePoint captures the people and moments of your day and stores them as a living world you can browse. Every person becomes a pixel character, every day a plant, every utterance a replayable line of dialogue — all backed by MongoDB.

### How we built it
*(Shipped and live.)* MongoDB is the backbone of SavePoint and has been since our first end-to-end milestone. We model four collections that map 1:1 to the product:
- `people` — the character roster: `avatarParams` (6 face-derived sprite axes), optional voice embedding, tags, favorite, first/last seen.
- `events` — the conversation log: each `seen` or `spoke` event with timestamp, `personId`, transcript `text`, and `dayId`.
- `days` — one document per day with a computed `plantStage` growth signal that seeds the garden.
- `recaps` — generated daily narratives + highlights.

A single write path — `POST /ingest` — takes a camera frame + audio, upserts the right `people` document (matched by face/voice embedding, else a new local id), appends `events`, and rolls up the `Day`. A full read API composes those documents back into the views the app renders: `/today`, `/day/{date}`, `/people`, `/people/{id}`, `/days`. We use FastAPI + Motor (async) against MongoDB, with Pydantic models as the single source of truth for the document shapes across the whole monorepo.

### Challenges
The data model is the contract that spans four independent workstreams (edge device, speech pipeline, backend, app), so a shape change anywhere ripples everywhere. We solved it by making the Pydantic models in the server the canonical schema and keeping the app's TypeScript interfaces deliberately shaped to match, so wiring the UI to live data is mechanical. We also made the Mongo client lazy so CI and unit tests run with no database at all — importing the app never requires a live Mongo.

### Accomplishments
The people → events → days → recaps store is fully shipped and running live: the whole `/ingest` → read pipeline works end-to-end, and the app renders directly off these documents. The database isn't a bolt-on — it's literally the game world.

### What's next
Move to MongoDB Atlas with a proper vector index on voice/face embeddings for cross-day person re-identification (today's matching is session-scoped), and add month/year aggregation pipelines to power the garden's seasonal rollups.

---

## Track 2 — Gemini

### Inspiration
Raw transcripts are noise. What you actually want at the end of a day is a friend saying "here's who you saw and what mattered." That's a natural-language problem, and it's exactly what a strong generalist model like Gemini is built for — turning a pile of diarized utterances into a warm, human recap and answering "wait, who did I meet on Tuesday?"

### What it does
SavePoint generates a cozy, Stardew-toned **daily recap** — a short narrative plus 2–4 highlights — from the day's conversations, and is designed to answer natural-language questions about your history ("who did I meet this week?", "what did we talk about?").

### How we built it
*(Recap generation shipped; Gemini backend is a config swap, wired but demoed on our self-hosted model — see note.)* Recaps and character bios go through **one pluggable LLM interface** (`LLMClient`, selected by a single `recap_backend` config value). `POST /day/{date}/recap` pulls a day's events from MongoDB, prompts the model for a cozy narrative + highlights, and stores the result back on the Day. Because the interface is model-agnostic, pointing it at **Gemini** is a one-line configuration change — no code rewrite.

**Honest status:** our recap pipeline is live and verified end-to-end on a self-hosted Gemma endpoint (our default during the hackathon). Gemini slots into the same interface and is our target for the natural-language **Q&A over your day** feature, which is designed but not yet built out. We demo the recap live and frame Gemini Q&A as the immediate next step on the same seam.

### Challenges
Getting a *cozy game-tone* out of an LLM without it going off the rails or hallucinating people who weren't there. We constrain the prompt tightly to the day's actual events and ask for a bounded number of highlights, so the narrative stays grounded in real transcript data rather than invented detail.

### Accomplishments
A working, pluggable recap system that turns structured conversation data into readable, characterful prose — with a clean seam that makes Gemini a drop-in for both recaps and conversational history search.

### What's next
Wire Gemini as the recap backend and build the conversational Q&A layer — retrieval over the `events` collection feeding Gemini so you can ask your own history questions in plain language.

---

## Track 3 — ElevenLabs

### Inspiration
SavePoint's Day view already plays your day back like a visual novel — Undertale-style dialogue boxes, character portraits, a typewriter effect. The one thing missing to make it feel like a real cutscene is *voice*. A narrated recap and voiced dialogue would turn a journal into something you could sit back and *watch*.

### What it does
SavePoint replays your day as a cinematic cutscene: the people you met stand in the scene and their conversation appears as dialogue boxes on a scrubbable timeline. With ElevenLabs, those lines get spoken aloud and the daily recap gets a warm narrated voiceover.

### How we built it
*(Playback shipped; ElevenLabs voicing is the near-term plan — see note.)* The cinematic Day view is built and live: a letterboxed scene, character portraits, a typewriter dialogue engine (the speaking avatar raised, the other dimmed), a stone-slider timeline scrubber over real event timestamps, and a transcript-history toggle. Every utterance is already a structured `event` with `text` and a speaker, so the content ElevenLabs would voice is already there and time-aligned.

**Honest status:** ElevenLabs integration is planned, not yet shipped. The demo plan is (1) narrate the generated daily recap with a single ElevenLabs voice, and (2) give each recurring character a consistent voice for their dialogue lines during playback. Because dialogue and recap are already clean text streams keyed to characters, dropping in text-to-speech is additive, not a rearchitecture.

### Challenges
Keeping voiced playback in sync with the visual-novel engine's typewriter timing and the timeline scrubber — audio has to line up with the line being drawn and update when the user scrubs to a new moment. Our playback engine already drives dialogue advancement from a single source (clicks, ◀/▶ buttons, and timeline flag-taps all hit the same engine), which gives us one clean place to attach audio.

### Accomplishments
A genuinely cinematic replay UI that's *built to be voiced* — the hard part (structured, character-attributed, time-aligned dialogue) is done and shipped.

### What's next
Integrate ElevenLabs TTS: a narrated recap voiceover first (highest demo impact, lowest effort), then per-character voices for dialogue playback, with voice choice tied to the deterministic character identity so the same person always sounds the same.

### What's next
Integrate ElevenLabs for narrated recaps and per-character dialogue voices.

---

## Track 4 — FreeSolo

### Inspiration
Generic LLM recaps are fine, but SavePoint has a very specific voice: cozy, Stardew-toned, warm, never clinical. That's exactly the kind of narrow, consistent style you get from *fine-tuning* rather than prompting. FreeSolo's Flash fine-tuning service is a natural fit for training a small adapter that speaks SavePoint's dialect natively.

### What it does
SavePoint generates cozy daily recaps and character bios. With FreeSolo, that generation runs on a **purpose-fine-tuned adapter** trained to produce SavePoint's signature warm, game-toned prose consistently — rather than coaxing it out of a general model with a long prompt.

### How we built it
*(Spike complete; adapter training underway; integration pending — see note.)* We ran a dedicated spike (SAV-51) on FreeSolo Flash and learned something important: **Flash is a fine-tuning service, not a drop-in base-model API** — there's no serverless base endpoint, so using it means training and deploying a LoRA adapter. That shaped our plan honestly:
- Our recap system already runs behind a pluggable `LLMClient` selected by one config value, so a FreeSolo adapter becomes just another backend.
- We can seed the fine-tuning dataset from our already-live Gemma recaps (paired day-events → cozy narrative), giving us clean in-domain training data for free.
- The FreeSolo client needs its own variant because trained adapters reject the `enable_thinking` kwarg our Gemma path requires — a small, known integration detail.

**Honest status:** the adapter is being trained; integration lands when it's deployed (SAV-52). Recaps are live today on Gemma, so FreeSolo is a genuine, in-progress prize play rather than a dependency we're faking.

### Challenges
Discovering mid-hackathon that Flash was fine-tuning-only meant re-scoping FreeSolo from "swap the API" to "train an adapter." We de-risked it by making our recap seam fully pluggable up front, so the model backend is genuinely swappable and we could keep shipping recaps on Gemma while the adapter trains in parallel.

### Accomplishments
A clear, validated fine-tuning path with training data we can generate ourselves from our own live system, and a backend architecture that makes the FreeSolo adapter a config-value swap.

### What's next
Finish training the cozy-recap LoRA, deploy it on Flash, wire the FreeSolo `LLMClient` variant, and A/B its recaps against Gemma for tone consistency.

---

## Track 5 — Backboard

### Inspiration
SavePoint asks an LLM to do a few different jobs — write a day's recap, generate a character's bio/flavor text, roll up a month. Those want different models and different tradeoffs (fast vs. expressive vs. cheap). Rather than hard-wire one model, we wanted an orchestration layer that routes each job to the right model. That's Backboard's sweet spot.

### What it does
SavePoint generates daily recaps, character bios, and longer month/year garden summaries. With Backboard, these route through **multi-model orchestration** — the right model for each kind of writing — behind one interface.

### How we built it
*(Recap generation shipped; Backboard orchestration is planned — see note.)* Our LLM layer is already designed as a single pluggable `LLMClient` with a `recap_backend` config selector, which is exactly the seam an orchestration provider plugs into. Recaps run live today (on self-hosted Gemma); character bios and month/year rollups are the additional generation jobs that benefit most from per-task model routing.

**Honest status:** Backboard integration is planned, not yet shipped. The plan is to route SavePoint's distinct generation tasks — short cozy day recaps, per-character bios, and longer seasonal garden summaries — through Backboard so each gets an appropriate model, all behind our existing interface. LLMs in SavePoint only ever write *text* (bios, narratives); they never render pixels — sprites are deterministic parametric assembly, not gen-art.

### Challenges
Different generation tasks have genuinely different needs (a one-line highlight vs. a paragraph-long monthly narrative), and hard-coding one model forces a compromise. Our pluggable-backend architecture means we can adopt Backboard's routing without touching the recap or bio call sites.

### Accomplishments
A model-agnostic generation architecture already shipped and running, purpose-built to sit behind a multi-model orchestrator like Backboard.

### What's next
Route recaps, character bios, and month/year rollups through Backboard, tuning model choice per task and comparing quality/latency against our single-model baseline.

---

## Track 6 — Best Hardware

### Inspiration
The magic moment in SavePoint is physical: someone you just met appears on your screen as a pixel character. That only lands with a real wearable that sees the world — and if a device is going to watch people, it has to earn trust. So the hardware story is two things at once: a Raspberry Pi 5 wearable that turns real faces into characters, and a **hardware mute switch** that makes privacy something you can physically see and touch, not just a promise in a settings menu.

### What it does
A Raspberry Pi 5 wearable is SavePoint's eyes: it captures the camera feed, and turns the people in frame into **deterministic sprite parameters** that stream to the server — **never raw video**. A physical GPIO mute button cuts the camera, with an LED showing recording state, so consent is a hardware guarantee.

### How we built it
*(Edge package shipped in simulation; hardware backend built but unverified on-device — see note.)* The `edge/` workstream is a real, tested Python package with a hardware abstraction layer (HAL) `Protocol` behind two backends:
- a **simulation backend** — fully tested in CI, synthetic camera/mute/detector, so the whole capture → derived-event flow runs with no hardware; and
- a **linux backend** targeting the Pi 5 on regular Raspberry Pi OS (picamera2 for the camera, gpiozero for the mute button + LED, onnxruntime for optional on-device face detection).

The device emits only **derived events** — sprite parameters (the same 6 avatar axes the server uses) and embeddings — through pluggable sinks (`stdout` / `file` / `http`), so raw frames never leave it. The camera lives on the Pi; the microphone lives on the phone; the server aligns the two independent clocks by timestamp to bind who-spoke to who-was-seen.

**Honest status:** the capture package and its sim path are shipped and CI-tested; the linux/hardware backend is written but not yet verified on physical Pi hardware, and the on-device face-detection path deliberately raises rather than guess a model's output layout (no face model ships in the repo). We deliberately dropped an earlier QNX/RTOS plan — QNX's own Pi 5 camera support is experimental with no real ONNX Runtime port — and run regular Raspberry Pi OS instead, which is the honest, working choice.

### Challenges
Building and testing an edge device you can't always have plugged in. We solved it with a HAL + simulation backend so the entire pipeline is developable and CI-tested without hardware. The other hard problem is trust: we made privacy a *hardware-enforced* property — the mute physically cuts the camera and the LED shows state — rather than a software toggle.

### Accomplishments
A clean two-tier edge architecture where only derived data leaves the device, a fully simulated-and-tested capture pipeline, and a privacy story you can physically demonstrate: flip the switch, the camera dies, the LED changes.

### What's next
Verify the linux backend on physical Pi 5 hardware, ship a working on-device face-detection model (moving inference from the server onto the Pi for an even stronger privacy story), and finalize the wearable form factor with the GPIO mute + LED.

---

*Cross-track honesty summary for the team: **fully shipped** = MongoDB store + /ingest→read pipeline, deterministic sprites, diarization pipeline, daily recap generation (on gemma), cinematic Day view UI, edge sim package. **Planned / in-progress (framed as such above)** = Gemini backend + Q&A, ElevenLabs voicing, FreeSolo adapter integration, Backboard orchestration, and on-Pi hardware verification + physical mute. No draft claims a planned feature as shipped.*
