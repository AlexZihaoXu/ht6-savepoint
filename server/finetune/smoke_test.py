"""Throwaway smoke test for the deployed savepoint-recap SFT adapter.

Feeds the same busy/quiet/empty day scenarios discussed in the fine-tune plan
through the deployed Flash adapter and checks the response parses into the
real Recap shape (narrative: str, highlights: list[str]).
"""

import json
import time

from openai import OpenAI

# Inlined from environment.py to avoid requiring the freesolo SDK locally.
SYSTEM_PROMPT = """You are the narrator for SavePoint, a cozy Stardew-Valley-style \
memory game. You are given one day's interaction events as JSON: each event is a \
person who was seen or something they said, with an optional emotion and place.

Write a short, warm, second-person narrative recap of the day (2-4 sentences) plus \
2-4 short highlight bullets. If the event list is empty, write a gentle one-line \
narrative noting today was quiet with no logged moments, and use an empty \
highlights list.

Respond with ONLY a JSON object, no other text, matching exactly:
{"narrative": "<string>", "highlights": ["<string>", ...]}"""

RUN_ID = "flash-1784385924-84f2f8d7"
BASE_URL = "https://clado-ai--freesolo-lora-serving.modal.run/v1"

with open("../.env") as f:
    api_key = next(
        line.split("=", 1)[1].strip()
        for line in f
        if line.startswith("SAVEPOINT_FREESOLO_API_KEY=")
    )

client = OpenAI(base_url=BASE_URL, api_key=api_key)

SAMPLES = {
    "busy_day": {
        "date": "2026-07-18",
        "events": [
            {"person": "Maya", "type": "spoke", "text": "Morning! Ready for the demo?", "emotion": "excited", "place": "Kitchen"},
            {"person": "Alex", "type": "seen", "text": None, "emotion": "focused", "place": "Kitchen"},
            {"person": "Maya", "type": "spoke", "text": "The judges loved the mute switch bit.", "emotion": "relieved", "place": "Convention Hall"},
            {"person": "Priya", "type": "spoke", "text": "Coffee run before round two?", "emotion": "tired", "place": "Convention Hall"},
            {"person": "Alex", "type": "spoke", "text": "Let's fix the CI first.", "emotion": "focused", "place": "Convention Hall"},
            {"person": "Priya", "type": "seen", "text": None, "emotion": "happy", "place": "Cafe"},
        ],
    },
    "quiet_day": {
        "date": "2026-07-19",
        "events": [
            {"person": "Jordan", "type": "spoke", "text": "Hey, long time no see!", "emotion": "happy", "place": "Grocery Store"},
        ],
    },
    "empty_day": {"date": "2026-07-20", "events": []},
    # Held-out — NOT in dataset/train.jsonl. New person, new place, new phrasing,
    # to check generalization rather than memorization (train loss hit ~0.0017,
    # a red flag for overfitting an 18-row set with no eval split).
    "novel_day_1": {
        "date": "2026-08-02",
        "events": [
            {"person": "Nadia", "type": "spoke", "text": "I just got back from my trip, so much to tell you!", "emotion": "thrilled", "place": "Airport"},
            {"person": "Nadia", "type": "spoke", "text": "Can we grab dinner this weekend?", "emotion": "hopeful", "place": "Airport"},
            {"person": "Wes", "type": "seen", "text": None, "emotion": "curious", "place": "Baggage Claim"},
        ],
    },
    "novel_day_2": {
        "date": "2026-08-03",
        "events": [
            {"person": "Owen", "type": "spoke", "text": "The printer jammed again, third time this week.", "emotion": "exasperated", "place": "Copy Room"},
        ],
    },
}

for name, payload in SAMPLES.items():
    start = time.time()
    resp = client.chat.completions.create(
        model=RUN_ID,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        max_tokens=300,
    )
    elapsed = time.time() - start
    raw = resp.choices[0].message.content

    print(f"\n=== {name} ({elapsed:.2f}s) ===")
    print("raw:", raw)
    try:
        parsed = json.loads(raw)
        ok = (
            isinstance(parsed.get("narrative"), str)
            and isinstance(parsed.get("highlights"), list)
        )
        print("parses cleanly into Recap shape:", ok)
    except json.JSONDecodeError as e:
        print("FAILED TO PARSE AS JSON:", e)

    print(
        "usage:",
        resp.usage.prompt_tokens,
        "prompt /",
        resp.usage.completion_tokens,
        "completion",
    )
