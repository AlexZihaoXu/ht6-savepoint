"""Idempotent demo-data seeder for the SavePoint plaza/garden/day-scene prototype.

Inserts clearly-labeled demo docs (ids prefixed ``demo-``, tag ``demo``) directly
into Mongo (db ``savepoint``) so the redesigned UI has a lively plaza, a July
garden, and a full day timeline for 2026-07-18. Safe to re-run: every write is a
replace_one(upsert=True) keyed on a stable _id.
"""

from datetime import datetime, timezone

from pymongo import MongoClient

DB = MongoClient("mongodb://127.0.0.1:27017").savepoint
TODAY = "2026-07-18"


def ts(day: str, hh: int, mm: int, ss: int = 0) -> datetime:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hh, mm, ss, tzinfo=timezone.utc)


# ---- people ---------------------------------------------------------------
def person(local_id, name, skin, hairc, hairs, glasses, hat, shirt, notes,
           first_seen, last_seen, favorite=False):
    return {
        "_id": local_id,
        "local_id": local_id,
        "name": name,
        "avatar_params": {
            "skin_tone": skin,
            "hair_color": hairc,
            "hair_style": hairs,
            "glasses": glasses,
            "hat": hat,
            "shirt_color": shirt,
        },
        "voice_embedding": None,
        "tags": ["demo"],
        "favorite": favorite,
        "first_seen": first_seen,
        "last_seen": last_seen,
        "notes": notes,
    }


PEOPLE = [
    person("demo-mia", "Mia", "fair", "red", "long", False, None, "teal",
           "Loves gardening — brought me basil seedlings.",
           ts("2026-07-02", 10, 0), ts(TODAY, 21, 32), favorite=True),
    person("demo-noah", "Noah", "tan", "black", "curly", True, None, "blue",
           "Robotics club — the arm finally tracks faces.",
           ts("2026-07-05", 14, 0), ts(TODAY, 14, 3)),
    person("demo-amara", "Amara", "deep", "black", "ponytail", False, None, "orange",
           "Runs the Saturday farmers-market stand.",
           ts("2026-07-04", 9, 30), ts(TODAY, 21, 30)),
    person("demo-kenji", "Kenji", "porcelain", "dark-brown", "short", True, "cap", "red",
           "Coffee friend — window seat at Cafe Oro, 8am sharp.",
           ts("2026-07-01", 8, 0), ts(TODAY, 12, 5)),
    person("demo-sofia", "Sofia", "brown", "auburn", "medium", False, None, "yellow",
           "New neighbor in 4B — has a corgi named Bun.",
           ts("2026-07-09", 18, 0), ts(TODAY, 16, 31)),
    person("demo-leo", "Leo", "fair", "blonde", "buzz", False, "beanie", "indigo",
           "Guitarist at the open mic; lent me a capo.",
           ts("2026-07-11", 20, 0), ts("2026-07-17", 21, 0)),
    person("demo-priya", "Priya", "tan", "black", "long", True, None, "violet",
           "Stats study partner — midterm on Tuesday.",
           ts("2026-07-06", 13, 0), ts(TODAY, 22, 30)),
]

for p in PEOPLE:
    DB.people.replace_one({"_id": p["_id"]}, p, upsert=True)

# ---- events (2026-07-18 = the demo day, plus a few on the 17th) -----------
def spoke(day, hh, mm, who, text, place=None):
    return {"person_id": who, "type": "spoke", "text": text, "emotion": None,
            "place": place, "day_id": day, "ts": ts(day, hh, mm),
            "start": None, "end": None, "overlap": False}


def seen(day, hh, mm, who, place=None):
    return {"person_id": who, "type": "seen", "text": None, "emotion": None,
            "place": place, "day_id": day, "ts": ts(day, hh, mm),
            "start": None, "end": None, "overlap": False}


EVENTS_TODAY = [
    spoke(TODAY, 8, 0, "demo-kenji", "Morning! The usual? I saved you the window seat.", "Cafe Oro"),
    spoke(TODAY, 8, 2, "you", "You know me too well. How was the hike?"),
    spoke(TODAY, 8, 4, "demo-kenji", "Muddy. Worth it. I'll send you the trail."),
    seen(TODAY, 10, 0, "demo-noah", "Robotics lab"),
    spoke(TODAY, 10, 2, "demo-noah", "The arm finally tracks faces — want to see?"),
    spoke(TODAY, 10, 3, "you", "No way. Show me before the demo!"),
    spoke(TODAY, 12, 30, "demo-sofia", "Bun dug up your tulips… I'm so sorry!", "Courtyard"),
    spoke(TODAY, 12, 31, "you", "Ha! Tell Bun it's a collab, not a crime."),
    spoke(TODAY, 17, 30, "demo-amara", "Last basil bunch — take it, it's yours.", "Farmers market"),
    spoke(TODAY, 17, 32, "demo-mia", "Plant it tonight and it'll root by Sunday."),
    spoke(TODAY, 20, 15, "demo-leo", "Open mic ran long — you missed my encore.", "The Attic"),
    spoke(TODAY, 20, 16, "you", "Next week I'm front row, promise."),
    spoke(TODAY, 22, 28, "demo-priya", "Quiz me once more on confidence intervals?", "Library steps"),
    spoke(TODAY, 22, 30, "you", "One more round, then sleep. Deal."),
]

EVENTS_17 = [
    seen("2026-07-17", 9, 15, "demo-kenji", "Cafe Oro"),
    spoke("2026-07-17", 13, 40, "demo-priya", "Chapter six is brutal — split it with me?"),
    spoke("2026-07-17", 21, 0, "demo-leo", "Wrote a bridge for that song. Listen later?", "The Attic"),
    spoke("2026-07-17", 21, 2, "you", "Send it over — I'll review it like a PR."),
]

EVENTS_PAST = {
    # Every seeded day has real events, so "view day" never opens empty.
    # Casts respect each person's first_seen date.
    "2026-07-01": [
        spoke("2026-07-01", 8, 5, "demo-kenji", "New here? This window seat is the good one.", "Cafe Oro"),
        spoke("2026-07-01", 8, 7, "you", "Sold. I'm Kenji-window-seat person now."),
    ],
    "2026-07-02": [
        spoke("2026-07-02", 10, 0, "demo-mia", "Careful — you almost stepped on my seedlings!", "Community garden"),
        spoke("2026-07-02", 10, 2, "you", "Sorry! Wait, are those basil? Teach me."),
        spoke("2026-07-02", 10, 5, "demo-mia", "Deal. First lesson: water less than you think."),
        seen("2026-07-02", 18, 30, "demo-kenji", "Cafe Oro"),
    ],
    "2026-07-03": [
        spoke("2026-07-03", 9, 0, "demo-kenji", "Rain check on the hike? Trail's flooded.", "Cafe Oro"),
    ],
    "2026-07-05": [
        spoke("2026-07-05", 14, 0, "demo-noah", "You're the one Mia mentioned! Come see the lab.", "Robotics lab"),
        spoke("2026-07-05", 14, 3, "you", "If nothing in there can pinch me, sure."),
        spoke("2026-07-05", 14, 5, "demo-noah", "No promises. The claw has opinions."),
        spoke("2026-07-05", 16, 20, "demo-amara", "Market's closing — mangoes, half price!", "Farmers market"),
        spoke("2026-07-05", 18, 0, "demo-mia", "Did Noah show you the claw? It waved at me once."),
    ],
    "2026-07-06": [
        spoke("2026-07-06", 13, 0, "demo-priya", "Is this seat taken? Also, do you get eigenvalues?", "Library"),
        spoke("2026-07-06", 13, 2, "you", "Barely. Let's be confused together."),
        spoke("2026-07-06", 13, 5, "demo-priya", "A study alliance. I like it."),
    ],
    "2026-07-09": [
        spoke("2026-07-09", 18, 10, "demo-sofia", "Hi! We just moved into 4B — I'm Sofia, this is Bun.", "Courtyard"),
        spoke("2026-07-09", 18, 12, "you", "Welcome! Bun can dig up my garden anytime. Once."),
    ],
    "2026-07-13": [
        spoke("2026-07-13", 11, 0, "demo-priya", "Practice midterm. Library. Bring snacks.", "Library"),
        spoke("2026-07-13", 11, 2, "you", "Bringing Kenji's pastries. We can't fail now."),
        spoke("2026-07-13", 15, 30, "demo-noah", "The arm picked up a screwdriver today. On purpose!"),
    ],
    "2026-07-15": [
        seen("2026-07-15", 9, 0, "demo-mia", "Community garden"),
        spoke("2026-07-15", 9, 5, "demo-mia", "Your basil survived the heat. I'm impressed."),
    ],
    "2026-07-16": [
        spoke("2026-07-16", 12, 0, "demo-amara", "Peach season's ending — last crate, take two.", "Farmers market"),
        spoke("2026-07-16", 12, 2, "you", "You always save me the good ones."),
        spoke("2026-07-16", 19, 30, "demo-leo", "New song tonight. It's about a garden, kind of.", "The Attic"),
        spoke("2026-07-16", 19, 32, "demo-sofia", "Bun and I are front row. He howls the chorus."),
        spoke("2026-07-16", 21, 0, "you", "Best encore yet — even the howling."),
    ],
    "2026-07-08": [
        spoke("2026-07-08", 9, 30, "demo-amara", "Fresh peaches today — first of the season!", "Farmers market"),
        spoke("2026-07-08", 9, 32, "you", "Save me two. No, four."),
        spoke("2026-07-08", 11, 15, "demo-noah", "Come by the lab, the new arm arrived."),
        spoke("2026-07-08", 16, 40, "demo-mia", "Your tomatoes are ahead of mine. Unfair."),
        spoke("2026-07-08", 19, 5, "demo-kenji", "Trivia night rematch. We were robbed last week.", "Cafe Oro"),
    ],
    "2026-07-11": [
        spoke("2026-07-11", 10, 20, "demo-mia", "Porch coffee? The basil sprouted!", "Porch"),
        spoke("2026-07-11", 10, 24, "you", "Be there in five. Don't water mine, I'll do it."),
        spoke("2026-07-11", 15, 0, "demo-priya", "I made flashcards. You're not ready."),
    ],
    "2026-07-14": [
        spoke("2026-07-14", 13, 10, "demo-leo", "Amp died mid-song. Acoustic set it is.", "The Attic"),
        spoke("2026-07-14", 13, 12, "you", "Honestly? It sounded better that way."),
        spoke("2026-07-14", 18, 45, "demo-sofia", "Sunset on the roof — bring everyone.", "Rooftop"),
        spoke("2026-07-14", 18, 50, "demo-amara", "I brought the leftover peaches."),
    ],
}

for i, e in enumerate(EVENTS_TODAY):
    e["_id"] = f"demo-{TODAY}-{i:02d}"
    DB.events.replace_one({"_id": e["_id"]}, e, upsert=True)
for i, e in enumerate(EVENTS_17):
    e["_id"] = f"demo-2026-07-17-{i:02d}"
    DB.events.replace_one({"_id": e["_id"]}, e, upsert=True)
for day_iso, evs in EVENTS_PAST.items():
    for i, e in enumerate(evs):
        e["_id"] = f"demo-{day_iso}-{i:02d}"
        DB.events.replace_one({"_id": e["_id"]}, e, upsert=True)

# Re-time the 3 real pipeline events (clustered at 00:00Z) into the morning so
# the day timeline reads naturally. Offsets from 09:12 preserve their order.
for ev in DB.events.find({"day_id": TODAY, "person_id": {"$regex": "^Speaker"}}):
    offset = float(ev.get("start") or 0.0)
    new_ts = ts(TODAY, 9, 12).replace(second=0)
    new_ts = new_ts.replace(minute=12 + int(offset // 60), second=int(offset % 60))
    DB.events.update_one({"_id": ev["_id"]}, {"$set": {"ts": new_ts}})

# ---- days (July 2026 garden) ---------------------------------------------
# Every day doc's summary + plant stage are recomputed from the events that
# actually exist, and the people tally counts REAL characters only — the
# wearer ("you") and unresolved diarizer labels ("Speaker N") are excluded,
# so the day bubble never claims more people than the plaza shows.
DAY_MOODS = {
    "2026-07-01": "#a3c46a",
    "2026-07-02": "#8bc34a",
    "2026-07-03": "#a3c46a",
    "2026-07-05": "#7ac74f",
    "2026-07-06": "#8bc34a",
    "2026-07-08": "#63b34e",
    "2026-07-09": "#a3c46a",
    "2026-07-11": "#7ac74f",
    "2026-07-13": "#8bc34a",
    "2026-07-14": "#63b34e",
    "2026-07-15": "#a3c46a",
    "2026-07-16": "#7ac74f",
    "2026-07-17": "#8bc34a",
    TODAY: "#63b34e",
}


def day_tally(date):
    n_events = DB.events.count_documents({"day_id": date})
    n_people = len([
        p for p in DB.events.distinct("person_id", {"day_id": date})
        if p != "you" and not p.startswith("Speaker")
    ])
    score = n_events + 2 * max(n_people - 1, 0)
    stage = next(
        s for s, t in ((4, 10), (3, 6), (2, 3), (1, 1), (0, 0)) if score >= t
    )
    return n_events, n_people, stage


for date, mood in DAY_MOODS.items():
    n_events, n_people, day_stage = day_tally(date)
    if n_events == 0:
        continue  # never emit a day doc without events behind it
    DB.days.update_one(
        {"_id": date},
        {"$set": {"date": date, "mood_color": mood, "plant_stage": day_stage,
                  "summary": {"people": n_people, "events": n_events}},
         "$setOnInsert": {"journal_notes": None}},
        upsert=True,
    )

n_events, n_people, stage = day_tally(TODAY)

# ---- recaps ---------------------------------------------------------------
# Today normally has a real gemma recap; seed a fallback ONLY if missing so
# the garden peek is never blank (and a real recap is never clobbered).
if DB.recaps.find_one({"_id": f"{TODAY}:day"}) is None:
    DB.recaps.insert_one({
        "_id": f"{TODAY}:day", "date": TODAY, "scope": "day",
        "narrative": ("A full loop of the neighbourhood — coffee with Kenji, "
                      "robots with Noah, basil from Amara, and one last quiz "
                      "on the library steps."),
        "highlights": [],
    })

RECAPS = [
    ("2026-07-08", "A bright, crowded day — the market, the lab, and five familiar faces before sundown."),
    ("2026-07-11", "A slow morning that turned into a long porch talk; the garden got watered twice."),
    ("2026-07-14", "Four friends, one broken amp, and a sunset that made everyone stop talking."),
    ("2026-07-17", "Coffee with Kenji, chapters with Priya, and a new bridge for Leo's song."),
]
for date, narrative in RECAPS:
    rid = f"{date}:day"
    DB.recaps.replace_one(
        {"_id": rid},
        {"_id": rid, "date": date, "scope": "day", "narrative": narrative,
         "highlights": []},
        upsert=True,
    )

print(f"seeded: {DB.people.count_documents({})} people, "
      f"{DB.days.count_documents({})} days, "
      f"{DB.events.count_documents({})} events, "
      f"{DB.recaps.count_documents({})} recaps; "
      f"today stage={stage} people={n_people} events={n_events}")
