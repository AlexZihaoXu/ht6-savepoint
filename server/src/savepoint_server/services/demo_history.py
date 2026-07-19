"""Hardcoded demo history: an in-code cast + ~week of past days for live demos.

Purely in-process — NEVER touches Mongo (contrast with app/scripts/seed_demo.py,
which seeds the same kind of content by writing real documents; this module exists
specifically for the case where that's undesirable, e.g. a demo running against the
live database). Every date here is a "days ago" OFFSET from whenever this module is
actually asked, not an absolute date, so the history always reads as "the recent
past" no matter which real day the demo happens to run on.

Read API call sites (api/read.py) use this ONLY to fill a genuine gap: a date with
no real Day/Event/Person in Mongo. The moment real data exists for a date (the Pi
has been running long enough to log it for real), that real data wins outright and
this module is never consulted for that date — see each read.py call site's
"real first, demo fallback" ordering.

Person local_ids are prefixed "demo-" specifically so they can never collide with a
real edge-assigned local_id (edge/identity_gallery.py mints "edge-<hash>", the
combined-ingest path mints "face-<hex>") or the wearer's own "you" label.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from savepoint_server.models import Day, DaySummary, Event, EventType, Person, Recap
from savepoint_server.models.day import compute_plant_stage
from savepoint_server.models.person import AvatarParams
from savepoint_server.models.recap import RecapScope

# --------------------------------------------------------------------------- #
# Cast — same roster/vocabulary as app/scripts/seed_demo.py, so a live demo and
# that script's seeded-into-Mongo version read as the same people if both are
# ever used side by side.
# --------------------------------------------------------------------------- #

_PEOPLE: dict[str, tuple[str, AvatarParams, str]] = {
    # key -> (display name, avatar params, notes)
    "mia": (
        "Mia",
        AvatarParams(skin_tone="fair", hair_color="red", hair_style="long", shirt_color="teal"),
        "Loves gardening — brought me basil seedlings.",
    ),
    "noah": (
        "Noah",
        AvatarParams(
            skin_tone="tan",
            hair_color="black",
            hair_style="curly",
            glasses=True,
            shirt_color="blue",
        ),
        "Robotics club — the arm finally tracks faces.",
    ),
    "amara": (
        "Amara",
        AvatarParams(
            skin_tone="deep", hair_color="black", hair_style="ponytail", shirt_color="orange"
        ),
        "Runs the Saturday farmers-market stand.",
    ),
    "kenji": (
        "Kenji",
        AvatarParams(
            skin_tone="porcelain",
            hair_color="dark-brown",
            hair_style="short",
            glasses=True,
            hat="cap",
            shirt_color="red",
        ),
        "Coffee friend — window seat at Cafe Oro, 8am sharp.",
    ),
    "sofia": (
        "Sofia",
        AvatarParams(
            skin_tone="brown", hair_color="auburn", hair_style="medium", shirt_color="yellow"
        ),
        "New neighbor in 4B — has a corgi named Bun.",
    ),
    "leo": (
        "Leo",
        AvatarParams(
            skin_tone="fair",
            hair_color="blonde",
            hair_style="buzz",
            hat="beanie",
            shirt_color="indigo",
        ),
        "Guitarist at the open mic; lent me a capo.",
    ),
    "priya": (
        "Priya",
        AvatarParams(
            skin_tone="tan",
            hair_color="black",
            hair_style="long",
            glasses=True,
            shirt_color="violet",
        ),
        "Stats study partner — midterm on Tuesday.",
    ),
}


def _local_id(key: str) -> str:
    return f"demo-{key}"


# One entry per (hour, minute, person_key_or_"you", type, text, place). "you" is
# the wearer's own line — never resolved to a Person (matches how read.py already
# skips any person_id that isn't a real Person, e.g. raw "Speaker N" labels).
_EventTemplate = tuple[int, int, str, EventType, str | None, str | None]

# Keyed by days-ago (1 = yesterday .. 7 = a week ago). A full week, each day with
# real events, so drilling into any of the past 7 days never opens empty.
_TIMELINE: dict[int, list[_EventTemplate]] = {
    1: [
        (9, 15, "kenji", EventType.SEEN, None, "Cafe Oro"),
        (13, 40, "priya", EventType.SPOKE, "Chapter six is brutal — split it with me?", None),
        (21, 0, "leo", EventType.SPOKE, "Wrote a bridge for that song. Listen later?", "The Attic"),
        (21, 2, "you", EventType.SPOKE, "Send it over — I'll review it like a PR.", None),
    ],
    2: [
        (
            12,
            0,
            "amara",
            EventType.SPOKE,
            "Peach season's ending — last crate, take two.",
            "Farmers market",
        ),
        (12, 2, "you", EventType.SPOKE, "You always save me the good ones.", None),
        (
            19,
            30,
            "leo",
            EventType.SPOKE,
            "New song tonight. It's about a garden, kind of.",
            "The Attic",
        ),
        (19, 32, "sofia", EventType.SPOKE, "Bun and I are front row. He howls the chorus.", None),
        (21, 0, "you", EventType.SPOKE, "Best encore yet — even the howling.", None),
    ],
    3: [
        (9, 0, "mia", EventType.SEEN, None, "Community garden"),
        (9, 5, "mia", EventType.SPOKE, "Your basil survived the heat. I'm impressed.", None),
    ],
    4: [
        (13, 10, "leo", EventType.SPOKE, "Amp died mid-song. Acoustic set it is.", "The Attic"),
        (13, 12, "you", EventType.SPOKE, "Honestly? It sounded better that way.", None),
        (18, 45, "sofia", EventType.SPOKE, "Sunset on the roof — bring everyone.", "Rooftop"),
        (18, 50, "amara", EventType.SPOKE, "I brought the leftover peaches.", None),
    ],
    5: [
        (11, 0, "priya", EventType.SPOKE, "Practice midterm. Library. Bring snacks.", "Library"),
        (11, 2, "you", EventType.SPOKE, "Bringing Kenji's pastries. We can't fail now.", None),
        (
            15,
            30,
            "noah",
            EventType.SPOKE,
            "The arm picked up a screwdriver today. On purpose!",
            None,
        ),
    ],
    6: [
        (
            18,
            10,
            "sofia",
            EventType.SPOKE,
            "Hi! We just moved into 4B — I'm Sofia, this is Bun.",
            "Courtyard",
        ),
        (18, 12, "you", EventType.SPOKE, "Welcome! Bun can dig up my garden anytime. Once.", None),
    ],
    7: [
        (10, 20, "mia", EventType.SPOKE, "Porch coffee? The basil sprouted!", "Porch"),
        (10, 24, "you", EventType.SPOKE, "Be there in five. Don't water mine, I'll do it.", None),
        (15, 0, "priya", EventType.SPOKE, "I made flashcards. You're not ready.", None),
    ],
}

_RECAPS: dict[int, str] = {
    1: "Coffee with Kenji, chapters with Priya, and a new bridge for Leo's song.",
    2: "Peaches, an encore, and Bun howling along to the chorus from the front row.",
    3: "A quiet one — just the garden, and basil that made it through the heat.",
    4: "A broken amp turned acoustic, then a rooftop sunset with the last of the peaches.",
    5: "Library snacks, a stubborn textbook chapter, and a robot arm with new manners.",
    6: "Met the new neighbors in 4B — Sofia, and Bun, who has opinions about tulips.",
    7: "A slow porch morning, basil sprouts, and flashcards I wasn't ready for.",
}

_MIN_DAYS_AGO = min(_TIMELINE)
_MAX_DAYS_AGO = max(_TIMELINE)


def _today() -> date:
    return datetime.now(UTC).date()


def _days_ago_for(day_date: date) -> int | None:
    """Offset of ``day_date`` from today, or ``None`` outside the demo window
    (including today/the future — demo history never covers "today")."""
    offset = (_today() - day_date).days
    return offset if _MIN_DAYS_AGO <= offset <= _MAX_DAYS_AGO else None


def person(local_id: str) -> Person | None:
    """The demo Person for ``local_id``, or ``None`` if it isn't one of ours
    (e.g. a real edge-assigned id, or the wearer's own "you")."""
    if not local_id.startswith("demo-"):
        return None
    key = local_id.removeprefix("demo-")
    entry = _PEOPLE.get(key)
    if entry is None:
        return None
    name, avatar, notes = entry
    seen_days = sorted(
        {days_ago for days_ago, evs in _TIMELINE.items() for _, _, k, *_ in evs if k == key}
    )
    if not seen_days:
        return None
    today = _today()
    result = Person(
        local_id=local_id,
        name=name,
        avatar_params=avatar,
        tags=["demo"],
        notes=notes,
        first_seen=datetime.combine(
            today - timedelta(days=max(seen_days)), datetime.min.time(), tzinfo=UTC
        ),
        last_seen=datetime.combine(
            today - timedelta(days=min(seen_days)), datetime.min.time(), tzinfo=UTC
        ),
    )
    # Mirrors PeopleRepository._make_id (real people's `id` == `local_id`) so
    # demo people look identical in shape to ones that came from Mongo.
    result.id = local_id
    return result


def people() -> list[Person]:
    """Every demo Person who appears somewhere in the timeline."""
    result = [person(_local_id(key)) for key in _PEOPLE]
    return [p for p in result if p is not None]


def events_for_day(day_date: date) -> list[Event]:
    """Demo events for ``day_date``, or ``[]`` outside the demo window."""
    days_ago = _days_ago_for(day_date)
    if days_ago is None:
        return []
    day_id = day_date.isoformat()
    events = []
    for i, (hh, mm, who, etype, text, place) in enumerate(_TIMELINE[days_ago]):
        event = Event(
            ts=datetime.combine(day_date, datetime.min.time(), tzinfo=UTC).replace(
                hour=hh, minute=mm
            ),
            person_id=(_local_id(who) if who != "you" else "you"),
            type=etype,
            text=text,
            place=place,
            day_id=day_id,
        )
        event.id = f"demo-{day_id}-{i:02d}"
        events.append(event)
    return events


def events_for_person(local_id: str) -> list[Event]:
    """Every demo event referencing ``local_id``, newest first (matches
    EventsRepository.list_for_person's ordering)."""
    if person(local_id) is None:
        return []
    today = _today()
    events = [
        event
        for days_ago in _TIMELINE
        for event in events_for_day(today - timedelta(days=days_ago))
        if event.person_id == local_id
    ]
    return sorted(events, key=lambda e: e.ts, reverse=True)


def events_in_month(month: str) -> list[Event]:
    """Every demo event whose day falls within ``month`` (``"YYYY-MM"``)."""
    today = _today()
    return [
        event
        for days_ago in _TIMELINE
        if (today - timedelta(days=days_ago)).isoformat().startswith(month)
        for event in events_for_day(today - timedelta(days=days_ago))
    ]


def day_tile(day_date: date) -> Day | None:
    """The demo :class:`Day` tile for ``day_date`` (mood + plant stage derived
    from that day's own events, same formula as the real ingest flow), or
    ``None`` outside the demo window."""
    events = events_for_day(day_date)
    if not events:
        return None
    n_people = len({e.person_id for e in events if e.person_id != "you"})
    stage = compute_plant_stage(events=len(events), people=n_people)
    result = Day(
        date=day_date,
        plant_stage=stage,
        summary=DaySummary(people=n_people, events=len(events)),
    )
    result.id = day_date.isoformat()
    return result


def recap_for_day(day_date: date) -> Recap | None:
    days_ago = _days_ago_for(day_date)
    narrative = _RECAPS.get(days_ago) if days_ago is not None else None
    if narrative is None:
        return None
    result = Recap(date=day_date, scope=RecapScope.DAY, narrative=narrative)
    result.id = f"demo-{day_date.isoformat()}:day"
    return result


def day_tiles() -> list[Day]:
    """Every demo Day tile in the window (at most one per entry in _TIMELINE)."""
    today = _today()
    tiles = (day_tile(today - timedelta(days=d)) for d in _TIMELINE)
    return [tile for tile in tiles if tile is not None]
