<!-- SAV-45 — drafted by the demo-prep workflow, 2026-07-18. Review before use. -->

# SavePoint — Live Demo Script & Rehearsal Plan

*"Your life autosaves."* · Hack the 6ix 2026 · SAV-45

---

## 1. The 30-second one-liner pitch

> "This is **SavePoint** — your life autosaves. You wear a little Raspberry Pi camera, your phone listens, and every person you actually talk to during the day turns into a **pixel character** in a cozy Stardew-style world. Each day becomes a **plant in a garden**, and every conversation replays as a cinematic, Undertale-style cutscene — with a narrated recap of who you met and what you talked about. It's a game first, a gentle memory-aid second, and it's **privacy-first by construction**: only derived data — sprite parameters, embeddings, transcript text — ever leaves a device. Your face is never stored. We read your face; we don't paint it."

Say it while the plaza is already on screen with characters wandering — the visual sells the "game" framing before you explain the pipeline.

---

## 2. The 2–3 minute hero-flow walkthrough (exact click path)

**Setup before you speak:** app open on the **Character Plaza**, phone/laptop mirrored to the projector, live tunnel confirmed rendering (see rehearsal checklist). Use the **seeded demo data** — do *not* run a live ingest on stage (see §4).

| # | Action (click path) | What to SAY |
|---|---|---|
| 1 | **Open on the Character Plaza** — characters idle-wandering, doing light activities, interacting. | "This is everyone I've met. Each one is a **deterministic pixel character** built from six face-derived axes — skin tone, hair, glasses, hat, shirt. Same person always makes the same sprite, so your recurring people become recognizable townsfolk." |
| 2 | **Let them wander a beat**, then tap the **whistle** control → they line up. | "It's a living town, not a contact list — but I can whistle everyone into a line when I want to actually find someone." |
| 3 | **Tap a character.** A contextual notification surfaces ("haven't seen them in a while 👋" / a resurfaced memorable line) → profile opens. | "Tapping someone resurfaces a real moment — a line they actually said, or a nudge that it's been a while. Then it opens their profile." |
| 4 | **On the profile:** large avatar, notes, recent-interactions log. | "Here's their character, when I last saw them, and every day we crossed paths — each row jumps straight into that day." |
| 5 | **Swipe right to the Calendar Garden** — grid of plant tiles, one per day, today highlighted. | "Swipe over and the whole world is one space — this is my **garden**. Every day is a plant; the plant grows from how much actually happened that day. Today's lit up." |
| 6 | **Tap a day (a plant).** The **cinematic Day View** opens — letterbox bars, characters present standing in the scene, dialogue box. | "Tapping a day plays it back like a cutscene. The people who were there are in the scene, and every line of conversation shows up as a Stardew dialogue box tied to whoever said it." |
| 7 | **Advance the dialogue** — click to type out a couple of lines (typewriter, speaking avatar raised, the other dimmed). | "This is the **who-said-what**. Our speech pipeline diarizes the audio — pyannote separates speakers, SepFormer splits overlaps, faster-whisper transcribes — so each utterance attaches to the right character." |
| 8 | **Drag the bottom timeline scrubber** (e.g. 8:00 AM → 10:30 PM). Characters present + the active line update to that moment. | "The stone slider scrubs the whole day by real timestamps — the people present and the live line update to that moment. This is where the two capture streams meet: the **Pi camera and the phone mic are aligned server-side by timestamp**." |
| 9 | **Tap the top-right transcript toggle** → raw diarized event list. | "And if you want the receipts, the full diarized transcript is one tap away." |
| 10 | **Show the recap** (day-view recap / narrative + highlights). | "Finally, the day writes itself up — a cozy, Stardew-toned **recap** with a few highlights: who I met, what mattered. That's generated live on our self-hosted **gemma** model, with a **fine-tuned FreeSolo Flash adapter** for the cozy voice. Your life, autosaved." |

**Timing:** beats 1–4 ≈ 45s, 5–6 ≈ 30s, 7–9 ≈ 45s, 10 ≈ 20s. Land under 3 minutes; if running long, compress beats 2 and 9.

---

## 3. One-line prize hooks (drop naturally, don't list them)

- **MongoDB** — "Every person, event, day, and recap lives in **MongoDB** — it's the backbone the whole plaza and garden read from."
- **Gemini** — "The recap layer also does conversational Q&A over your day with **Gemini** — 'who did I meet, what did we talk about?'"
- **FreeSolo** — "The cozy recap voice is a **fine-tuned adapter on FreeSolo's Flash** — not a prompt, an actual trained model for our tone."
- **Backboard** — "Character bios and longer month recaps route through **Backboard's** multi-model orchestration."
- **ElevenLabs** — "And the dialogue playback can be **voiced with ElevenLabs** — the cutscene literally talks."
- **Best Hardware** — "It all starts on a **Raspberry Pi 5** wearable — camera capture, optional on-device inference, and a **hardware mute switch with an LED** that physically cuts the camera. Privacy you can see."

---

## 4. Backup plan (if live capture / tunnel wobbles)

**Rule #1 — never do a live `/ingest` on stage.** Blind diarization produces anonymous `Speaker N` labels; the Speaker→Person binding is a known open seam (DESIGN §6). A live capture risks lines attaching to the wrong character on the projector. The demo runs entirely on **seeded demo data** that already looks perfect.

- **Tunnel dies / link won't render:** fall back to the app running **locally** (`app` dev server on `0.0.0.0:5173`, or a `vite preview` build) pointed at the **local backend** on `127.0.0.1:8000` — no public tunnel needed on stage. Have this already open in a second browser tab.
- **Backend hiccups:** the app renders from **seeded read-API responses** (`/today`, `/people`, `/days`, `/day/{date}`); the whole hero flow is browsable without any live write path.
- **Recap endpoint slow / LLM unreachable:** the day's recap is **pre-generated and stored on the Day** before the demo (see checklist) — you're *displaying* a saved recap, not generating one live. If asked, mention it regenerates via `POST /day/{date}/recap`.
- **Total network failure:** play the **pre-recorded backup video** of the full flow. Keep it on the presenting laptop locally, not in the cloud.
- **Hardware flourish is optional:** if the Pi mute-switch demo misbehaves, drop it silently — it's the first cut-line (PLAN §3) and the core loop doesn't depend on it.

---

## 5. Rehearsal checklist

**T-minus ~30 min (services & data):**
- [ ] Relaunch **mongod** (`127.0.0.1:27017`) and confirm the seeded people/days/events are present.
- [ ] Relaunch the **backend** bound to `0.0.0.0:8000` (`--reload`), restart its **cloudflared** tunnel, grab the fresh `*.trycloudflare.com` URL from the log.
- [ ] Relaunch the **app** dev server on `0.0.0.0:5173` (or build a `vite preview`); confirm `allowedHosts` covers `.trycloudflare.com` (full restart, not just an edit — known Vite gotcha).
- [ ] **Open the live link on the actual presenting device** and confirm the plaza renders end-to-end (not just localhost).
- [ ] **Seed today's recap:** run `POST /day/{date}/recap` for the demo day(s) so a narrative + highlights are stored and display instantly — no live LLM call on stage.
- [ ] Confirm the **local fallback** (app on 5173 → backend on 127.0.0.1:8000) works with the tunnel turned off.

**Content & flow:**
- [ ] Verify the seeded day has: multiple people present, several diarized dialogue lines, a scrubbable time range, and a stored recap with highlights.
- [ ] **Run the full hero flow 3× end-to-end** — plaza → whistle → tap character → profile → swipe garden → tap day → dialogue → scrub timeline → transcript → recap. Time each run; land the click path under 3 min.
- [ ] Rehearse the **spoken beat at each step** (§2) out loud, not just the clicks.
- [ ] Rehearse dropping the hardware flourish cleanly if it's not ready.

**Safety net:**
- [ ] **Record a backup video** of a clean full run; store it **locally** on the presenting laptop.
- [ ] Take fresh **screenshots** of the plaza + a day view (light and dark) as static fallbacks.
- [ ] Charge/mirror the presenting device; test the projector resolution (mobile-first portrait layout — confirm it doesn't crop).
- [ ] Assign roles: one person drives the app, one narrates, one owns the Pi/hardware beat.
- [ ] Have the **Devpost submission list** ready — one entry per legitimately-hit track (FreeSolo, Backboard, ElevenLabs, MongoDB, Gemini, Best Hardware).

**Golden rule:** on stage, the app shows **seeded data** and a **pre-generated recap**. Live capture is a story you *tell*, not a risk you *run*.
