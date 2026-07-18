# PixelLab sprite pipeline (SAV-61)

How SavePoint turns a person into an animated pixel-art character, end to end — from the
camera/ingest that first sees them, through AI generation, to the walking sprite in the plaza.

**One-line:** each person → a small AI-generated sprite sheet (4 facing directions + a side
walk cycle), cached on disk, referenced by a JSON manifest on the `Person`, and rendered in the
app with direction-driven animation. Deterministic per person, generated once, cheap to serve.

---

## 1. The shape of a sprite (the contract)

When a person has a generated sprite, their `Person.sprite` field holds a **manifest**:

```json
{
  "tile":   { "w": 92, "h": 92 },
  "static": { "south": "south.png", "east": "east.png", "west": "west.png", "north": "north.png" },
  "walk":   { "east": ["walk_east_0.png", "...", "walk_east_8.png"] }
}
```

- Filenames are **relative**. The full URL is `${API_BASE}/sprites/{local_id}/{filename}`.
- `sprite` is `null` until generated → the app falls back to the deterministic `ParametricSprite`.
- Every PNG is 92×92 RGBA, transparent background, GBA/DS-era pixel art.
- Directions: `south` = facing the camera (front), `east` = facing right (side), `west` = left,
  `north` = back. The walk cycle is generated for **east** (right-facing); left is the mirror.

This manifest is the seam between backend and frontend — nothing else crosses.

---

## 2. When generation happens

Two entry points, same core (`generate_person_sprite`):

- **Automatic (fire-and-forget hook).** When ingest creates a **brand-new** `Person` (a new face
  on `/ingest` or `/ingest/video`), an async background task generates their sprite. It is:
  - **config-gated + OFF by default** (`SAVEPOINT_PIXELLAB_ENABLED=false`) — with no key it never
    touches PixelLab, so ingest is byte-identical to before;
  - **fire-and-forget** — it schedules a task and returns immediately; a slow or failing PixelLab
    can never block, slow, or fail the ingest request (all exceptions are swallowed, `sprite`
    stays `null`);
  - **once-only** — re-seeing an existing person does not re-generate;
  - **concurrency-bounded** — a semaphore caps how many run at once so one busy `/ingest/video`
    batch can't fan out into N simultaneous (paid, slow) jobs.
- **Manual (`scripts/gen_sprites.py`).** How the demo people were sprited. Runs the same core
  against the live Mongo, with a `--limit` budget guard (each person = 3 generations; it stops
  *before* exceeding the cap and prints the running balance). This is what we use for the demo —
  the automatic hook stays off so it can't burn the (small) credit budget on random live ingests.

---

## 3. Backend generation flow (`server/src/savepoint_server/services/pixellab.py`)

```
Person.avatar_params (6 axes: skin_tone, hair_color, hair_style, glasses, hat, shirt_color)
        │
        ▼  build_character_description()  — deterministic prompt: the 6 axes + a fixed
        │                                    cozy GBA/DS style spec (chibi, 1px outline, …)
        ▼
   PixelLab  POST /v2/create-character-with-4-directions   (1 generation, ~40-90s)
        │      → a reusable character_id + 4 RGBA images {south,east,west,north}
        ▼
   PixelLab  POST /v2/animate-character  {directions:["east"], action:"walking"}   (2 generations)
        │      → a background job → ~9 RGBA walk frames (the side-facing walk cycle)
        ▼
   save every image as a PNG under  {sprites_dir}/{local_id}/   (south.png … walk_east_8.png)
        │
        ▼
   return a SpriteManifest → persisted onto Person.sprite in Mongo
```

- **Cost = 3 generations per person** (1 base + 2 for the walk). 92×92 output.
- Both PixelLab calls are async jobs: POST → poll `GET /v2/background-jobs/{id}` until `completed`
  (bounded by a poll timeout so it can never hang forever) → decode the `rgba_bytes` images.
- **API gotcha (learned the hard way):** the walk direction is set with a `directions` **list**
  (`["east"]`), *not* a `direction` field — the endpoint 422s on `direction`, and custom mode
  defaults to south-only otherwise.

---

## 4. Serving the PNGs

`main.py` mounts the sprite cache as static files:

```
GET /sprites/{local_id}/{filename}   →   the PNG   (200 image/png, or 404 if missing)
```

The read API (`/people`, `/people/{id}`) returns the `sprite` manifest inline, so the app gets
the manifest + the file URLs from the same responses it already fetches.

---

## 5. Frontend rendering (`app/src/lib/pixel-sprite.tsx`)

`PixelSprite` renders a person's sprite and animates it by **wander state**:

- **Idle (not moving)** → show `static.south` (faces forward), matching "standing still faces
  forwards".
- **Moving** → cycle the `walk.east[...]` frames at ~8 fps (frames advance only while moving, so
  the walk stops with the character).
- **Facing left** → the same east frames, horizontally mirrored (`transform: scaleX(-1)`).
- **No sprite yet / any image load error** → fall back to the deterministic `ParametricSprite`
  with the same params, so a person without a sheet (or mid-generation) always still shows.

In the **plaza** this is driven off the existing wander simulation (`wander.ts`): each wanderer's
`facing` (±1) and moving state (speed / gait) feed the sprite. On the People / Person / Past
screens the sprite is shown static (front-facing).

---

## 6. Files & ops

| Concern | Location |
| --- | --- |
| Generation core + client + hook | `server/src/savepoint_server/services/pixellab.py` |
| Manual generator (budget-guarded) | `server/scripts/gen_sprites.py` |
| `Person.sprite` field | `server/src/savepoint_server/models/person.py` |
| Static mount | `server/src/savepoint_server/main.py` (`/sprites`) |
| Config | `core/config.py` — `SAVEPOINT_PIXELLAB_API_KEY`, `SAVEPOINT_PIXELLAB_ENABLED` (default false), `SAVEPOINT_SPRITES_DIR` (default `<repo>/server/.sprites`) |
| Frontend component | `app/src/lib/pixel-sprite.tsx` + `sprite-sheet.ts` |
| Frontend URL builder / type | `app/src/lib/api.ts` (`spriteUrl`, `SpriteManifest`) |

**Generate sprites for the demo people:**

```bash
cd server
SAVEPOINT_PIXELLAB_API_KEY=… SAVEPOINT_SPRITES_DIR=./.sprites \
  uv run python scripts/gen_sprites.py --all --limit 24    # everyone missing a sprite
# or specific people, regenerating existing:
SAVEPOINT_PIXELLAB_API_KEY=… uv run python scripts/gen_sprites.py demo-mia demo-noah --force
```

The PNGs live under `{SAVEPOINT_SPRITES_DIR}/{local_id}/` (persistent, gitignored). The running
backend serves them at `/sprites/...` and the app renders them automatically once the manifest
lands on the person.

---

## 7. Safety notes

- The auto-hook **cannot break ingest** (fire-and-forget, total try/except, semaphore-bounded).
- `local_id` (which can come from an untrusted `/ingest/video` payload) is **validated + confined
  to the sprites dir before any write** — no path traversal, and validated before spending a
  (paid) generation.
- Malformed PixelLab responses raise a typed error, never an opaque crash.
- For the demo the **auto-hook stays OFF** — we pre-generate the known cast with `gen_sprites.py`
  so live ingests during the demo don't spend credits.
