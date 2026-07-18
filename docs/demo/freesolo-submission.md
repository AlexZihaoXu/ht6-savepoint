<!-- SAV-53 — drafted by the demo-prep workflow, 2026-07-18. Review before use. -->

# SavePoint × FreeSolo — Prize Track Submission

**Hack the 6ix 2026 · Linear SAV-53 · Track: FreeSolo**

*"Your life autosaves."* SavePoint turns the people you talk to into cozy pixel villagers and replays your day back as a Stardew-style garden. One piece of that experience is the **daily recap** — the little journal entry that narrates your day. We fine-tuned a **FreeSolo Flash LoRA adapter** to write those recaps, and shipped it as a live, pluggable backend behind our recap service.

---

## The use case: a narrow structured → narrative task

Every night SavePoint has to turn a day's raw interaction log into two things a game UI can render:

- a **narrative** — 2–4 warm, second-person sentences, and
- **highlights** — 2–4 short bullet strings.

The input is fully structured. It's a JSON list of events, each a person who was *seen* or *spoke*, with optional emotion and place:

```json
{"date": "2026-07-14", "events": [
  {"person": "Maya",  "type": "spoke", "text": "Ready for the demo?", "emotion": "excited",  "place": "Kitchen"},
  {"person": "Priya", "type": "spoke", "text": "Coffee run before round two?", "emotion": "tired", "place": "Convention Hall"}
]}
```

The output is a fixed shape our parser consumes:

```json
{"narrative": "Today was a whirlwind...", "highlights": ["Ran the demo with Maya", "Coffee run with Priya"]}
```

This is exactly the kind of task a **small fine-tuned model beats a big generic LLM on**, and why FreeSolo Flash fits:

- **Format is non-negotiable.** A generic model needs prompt gymnastics (and still occasionally wraps JSON in prose or markdown fences) to hit `{"narrative": str, "highlights": [str]}`. A model SFT'd on hundreds of examples of *this exact shape* just emits it — which means our recap parser almost never has to fall back.
- **Tone is a brand, not a preference.** "Cozy Stardew-Valley journal narrator, second-person, gentle, never clinical" is a specific voice. Fine-tuning bakes it in instead of spending context tokens re-describing it on every call.
- **Latency and cost matter at day-end scale.** This runs per user, per day. A 4B adapter on FreeSolo's managed serving is dramatically cheaper and faster to run than a 12B+ generic endpoint, and there's no infra for us to babysit.

Our self-hosted **Gemma-4-12B** baseline is a good writer — arguably *more* lyrical — but it's the wrong tool for a high-volume, format-strict, on-brand task. FreeSolo let us trade a little flourish for a lot of reliability, speed, and cost.

---

## Training setup

Tooling lives in [`server/finetune/`](server/finetune/) (`environment.py`, `dataset/train.jsonl`, `configs/`, `TRAINING.md`).

| | |
|---|---|
| **Base model** | `Qwen/Qwen3.5-4B` |
| **Algorithm** | SFT (LoRA, rank 32) via FreeSolo Flash managed training |
| **Environment** | `RecapEnv(EnvironmentSingleTurn)` — day-events JSON → recap JSON |
| **Dataset** | 47 curated `{input, output}` pairs (busy / quiet / empty days) |
| **Schedule** | 8 epochs, batch size 8 (~48 optimizer steps) |
| **Serving** | `flash deploy` → OpenAI-compatible endpoint (Modal) |

The **environment's reward** is a graded validity ladder (used for our GRPO-ready scaffold and as an honest correctness signal):

```
invalid JSON            → 0.0   (metric: valid_json=0)
valid JSON, wrong shape → 0.3   (partial credit)
valid JSON + right shape→ 1.0   (metrics: valid_json=1, correct_shape=1)
```

**The most important thing we learned was to distrust a clean loss curve.** An earlier run (60 steps on just 18 rows) drove training loss to ~0.0017 / ~99.97% token accuracy — and on *held-out* days it confidently fabricated people and places that never happened. Classic memorization. We fixed it the honest way the FreeSolo `TRAINING.md` playbook prescribes: **more data, fewer passes** (18 → 47 rows, tighter epoch budget) so the model has to learn the input→output *mapping* instead of memorizing fixed strings, and we validate on inputs it never trained on.

---

## Results & comparison (live-validated)

The deployed adapter is wired into the running server and probed by [`server/finetune/smoke_test.py`](server/finetune/smoke_test.py) across five scenarios — **busy day, quiet day, empty day, and two held-out "novel" days** (new people, new places, new phrasing not in the training set, to test generalization rather than recall).

- **Coherent, grounded recaps.** On held-out days it narrates the actual people and moments it was given, in the right cozy voice, without inventing events.
- **Clean structured extraction.** Output parses straight into our `Recap` shape (`narrative: str`, `highlights: list[str]`) — the format the model was trained on holds up on unseen inputs.
- **~6.4s end-to-end** on the managed serving endpoint, with no `chat_template_kwargs` or other coaxing required.

**vs. the Gemma-4-12B baseline:** Gemma tends to write *more lyrical* prose; the FreeSolo adapter is tighter, more on-format, faster, and cheaper — the right trade for a per-user, per-day journal feature. Both are wired behind the *same* interface, so we can pick per deployment.

---

## How it drops in: one config value

The recap service depends only on an `LLMClient` protocol (`complete(system, user, max_tokens, temperature) -> str`). FreeSolo is just another implementation, `FreesoloClient`, alongside `GemmaClient` — both OpenAI-compatible chat-completions calls. Switching the whole app's recap engine is **one environment variable**:

```bash
SAVEPOINT_RECAP_BACKEND=freesolo   # gemma (default) | freesolo
```

`base_url`, `api_key`, and the deployed run-id (`freesolo_model`) are env-configured, so a redeploy is a config change, never a code change. No call site in the recap service knows or cares which backend answered. That same seam is where Gemini / Backboard slot in later.

---

## The judge pitch

> SavePoint has one narrow, high-volume job — turn a day's structured event log into a cozy, correctly-formatted journal entry, for every user, every night. That's the textbook case where a small fine-tuned model wins. We used **FreeSolo Flash** to SFT a Qwen3.5-4B LoRA adapter on that exact task, hit a real overfitting wall and climbed back out the disciplined way (more data, fewer epochs, held-out validation), deployed it to a managed OpenAI-compatible endpoint, and wired it behind our pluggable `LLMClient` so it's live with a **one-line config flip** — faster, cheaper, and more reliably on-format and on-brand than our 12B general-purpose baseline.

---

## Honest scope — demo'd vs. future

**Demo'd today:** SFT adapter trained on Flash, deployed live, wired into the server as `recap_backend="freesolo"`, and validated on 5 scenarios including 2 held-out days (coherent, grounded, parseable, ~6.4s).

**Not yet, and we won't claim it:**
- Evaluation is **qualitative**, on a small probe set. There's no large held-out eval split or quantitative A/B score against Gemma yet — the comparison is a reasoned, observed one, not a benchmark number.
- The dataset is small (47 curated rows). It's enough to demonstrate the mapping and the tone; it is not a production corpus.

**Next (scaffolding already in place):** the environment's graded reward is built for a **GRPO warm-start from the SFT adapter** to optimize past pure format compliance; grow and diversify the dataset with real event logs; and stand up a quantitative eval harness for a defensible SFT-vs-baseline comparison.

*Repo: `github.com/AlexZihaoXu/ht6-savepoint` · training tooling in `server/finetune/` · backend wiring in `server/src/savepoint_server/services/llm.py`.*
