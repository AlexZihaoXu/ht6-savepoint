# edge/ — Pi 5 capture (Raspberry Pi OS)

On-device camera capture → face detection → deterministic sprite params →
event emission, plus the hardware mute switch + LED. Runs on a Raspberry Pi
5 under normal Raspberry Pi OS (standard Linux kernel) — see PLAN.md's "v6"
changelog and DESIGN.md §5 for the team decision to drop QNX in favor of
this.

**Status:** the pipeline is fully scaffolded and builds/runs today in a
**sim mode** (no hardware needed — see Quickstart below). The **linux
backend** (real camera/GPIO/inference) is written against real, standard,
well-documented Raspberry Pi APIs but has never run on actual hardware,
because none was available while writing it — see "What's verified vs.
not" below.

## Quickstart — sim mode (works right now, no Pi needed)

```bash
cd edge
uv sync
uv run savepoint-edge          # prints one JSON event/line to stdout
```

Synthetic "people" cycle through on a ~500ms tick — this proves the
capture → detect → sprite-params → event pipeline end-to-end without any
camera, model, or GPIO. Try the mute switch (file-based in sim mode):

```bash
touch .sim_mute     # capture stops, LED line goes "off"
rm .sim_mute         # capture resumes
```

Pick where events go with `SAVEPOINT_EDGE_SINK`:

```bash
SAVEPOINT_EDGE_SINK=stdout uv run savepoint-edge                      # default
SAVEPOINT_EDGE_SINK=file:session.ndjson uv run savepoint-edge         # newline-delimited JSON file
SAVEPOINT_EDGE_SINK=http://100.x.x.x:8000/ingest/video uv run savepoint-edge  # POST events to the server (list[EdgeEvent])
```

Run the tests and linter:

```bash
uv run pytest
uv run ruff check .
```

CI (`.github/workflows/ci-edge.yml`) runs exactly these commands on every
push/PR touching `edge/**`. It needs no Pi-specific setup at all — sim mode
and the tests have zero hardware dependencies (see "Dependencies" below).

## Quickstart — real hardware (once the Pi is flashed)

This has **not** been run against real hardware — see "What's verified vs.
not" below before trusting it blindly, but the APIs used are standard,
current, first-party Raspberry Pi tooling, not experimental ports.

### Setup on the Pi

`picamera2` and `gpiozero` ship through **apt**, not pip — a plain
`pip install picamera2` in an isolated venv fails on the missing
`libcamera` bindings underneath it. The fix is to create the venv against
system Python with `--system-site-packages` so it inherits the apt-
installed packages:

```bash
sudo apt update
sudo apt install -y python3-picamera2 python3-libcamera python3-gpiozero

cd edge
uv venv --python /usr/bin/python3 --system-site-packages
uv sync
uv run python -c "from picamera2 import Picamera2; print(Picamera2.global_camera_info())"
```

(Pattern confirmed against [pydevtools.com's uv+picamera2 guide](https://pydevtools.com/handbook/how-to/how-to-use-picamera2-and-gpio-with-uv-on-raspberry-pi/).)

`onnxruntime` (used by the face detector) is a normal pip dependency
already in `pyproject.toml` — `uv sync` installs it, no apt step needed.

**Pi 5 GPIO note:** the classic `RPi.GPIO` library does **not** work on Pi
5 — the new "RP1" southbridge chip moved the GPIO registers off the SoC,
and `RPi.GPIO` accesses them directly via `/dev/mem`, which no longer
reaches them. `gpiozero` (what this repo uses) auto-selects a working
backend and is the current officially-recommended library.

### Running

```bash
SAVEPOINT_EDGE_BACKEND=linux uv run savepoint-edge
```

Before this produces working face detections you still need to:

1. **Get a face-detection model onto the device** and point
   `SAVEPOINT_EDGE_FACE_MODEL` at it — an `.onnx` file (DESIGN.md §13 names
   SCRFD/BlazeFace + MobileFaceNet; none ships with this repo — source and
   export one yourself). `LinuxFaceDetector`'s constructor genuinely loads
   whatever model you point it at via ONNX Runtime — that part is real and
   testable today, even on a laptop with no Pi at all:
   ```bash
   uv run python -c "
   from savepoint_edge.backends.linux.linux_face_detector import LinuxFaceDetector
   LinuxFaceDetector('/path/to/your/model.onnx')
   print('loaded OK')
   "
   ```
2. **Implement `LinuxFaceDetector.detect()`** — it currently raises
   `NotImplementedError` on purpose. SCRFD/BlazeFace's exact output tensor
   layout (anchor decoding, NMS, embedding extraction) depends on how you
   export the specific model, so writing speculative pre/post-processing
   against an unknown export would silently produce garbage detections —
   worse than clearly flagging it as unimplemented. See the module's
   docstring.
3. **Confirm GPIO pin wiring** — `LinuxMuteSwitch` defaults to button=17,
   LED=27; these are guesses, not confirmed against real wiring.
4. **Verify the camera's channel order** — picamera2's `"RGB888"` format
   has a long-standing, widely-reported quirk where the actual byte order
   in the returned array is BGR, not RGB (this has changed across
   picamera2/libcamera versions). Point the camera at something solidly
   red and check before trusting downstream color assumptions.

## What's verified vs. not

| Component | Status |
| --- | --- |
| Sim mode (camera/mute/detector/sinks/loop) | **Runs today**, tested end-to-end (stdout, file, and HTTP sinks; mute toggling) |
| `sprite_params.py` / `event.py` | **Runs today**, unit-tested (determinism, NaN/Inf handling, JSON schema) |
| `LinuxFaceDetector.__init__` (ONNX Runtime session load) | **Verified** — actually loads a real `.onnx` file in a standalone test; see git history for the check |
| `LinuxFaceDetector.detect()` | **Not implemented** — raises on purpose, see above |
| `LinuxCamera` (picamera2) | Written against picamera2's standard, documented `capture_array()` API — **not run on hardware** |
| `LinuxMuteSwitch` (gpiozero) | Written against gpiozero's standard, documented `Button`/`LED` API — **not run on hardware** |

## Architecture

```
Camera ──► Frame ──► FaceDetector ──► DetectedFace[] ──► sprite_params ──► EdgeEvent ──► EventSink
                                            │
MuteSwitch (polled every tick, gates the whole loop + drives the LED)
```

Every arrow is a `typing.Protocol` in `src/savepoint_edge/hal.py`. `main.py`
is written entirely against these interfaces and never changes between sim
and real hardware — only which backend gets selected changes, via
`SAVEPOINT_EDGE_BACKEND` (`sim` default, or `linux`). Backend modules are
imported lazily inside `main.py`'s `_build_backend()`, specifically so sim
mode and the test suite never require picamera2/gpiozero/onnxruntime to be
installed.

```
edge/
  pyproject.toml                 # uv; onnxruntime is a real pip dep, picamera2/gpiozero are NOT (see Setup)
  src/savepoint_edge/
    types.py                     # Frame, DetectedFace, AvatarParams, EdgeEvent — backend-agnostic
    hal.py                       # Camera / MuteSwitch / FaceDetector / EventSink protocols
    sprite_params.py             # deterministic embedding -> AvatarParams + local_id
    event.py                     # EdgeEvent -> wire JSON (stdlib json + dataclasses.asdict)
    main.py                      # the capture loop; only place that picks sim vs. linux
    sinks/                       # stdout / file / http — all backend-agnostic
    backends/sim/                 # no hardware — synthetic camera, file-based mute, mock faces
    backends/linux/                # real picamera2 / gpiozero / onnxruntime — see "What's verified" above
  tests/                          # pytest; sim/core only, zero hardware deps
```

### Wire format vs. the server data model

`EdgeEvent` (what `serialize_edge_event` produces) is **not** the same
shape as `server/src/savepoint_server/models/event.py::Event` — don't
confuse them. DESIGN.md §9 describes the flow as "Pi emits an event →
server upserts `people` (match by nearest face/voice embedding, else new
`localId`) → append `events`." That means the wire payload edge ships is
closer to a raw detection than a finished DB row:

- `local_id` — a coarse, session-scoped identity heuristic computed
  on-device (hash of the quantized embedding — see `sprite_params.py`'s
  docstring for why this is *not* real face re-identification), matching
  the `local_id` field already on `server`'s `Person` model.
- `avatar_params` — matches `Person.avatar_params` (`AvatarParams`) field
  for field. `tests/test_event.py::test_field_names_match_server_avatar_params`
  cross-checks this against server's actual model when server's deps are
  importable in the test environment (skips otherwise — edge/ has no
  dependency on server/, see that test's docstring).
- `face_embedding` — now accepted server-side: `Person.face_embedding`
  and the `POST /ingest/video` body (`list[EdgeEvent]`) both carry it (PR
  #19), stored for DESIGN.md's "match by nearest face embedding" flow.

The server ingest endpoint exists: **`POST /ingest/video`** accepts a JSON
array of EdgeEvents (`list[EdgeEvent]`) — `HttpSink` posts each event as a
one-element array to it. Point `SAVEPOINT_EDGE_SINK` at
`http://<server>:8000/ingest/video` (see `.env.example`).

### Why hand-rolled hashing but stdlib JSON/HTTP

`sprite_params.py` hand-rolls FNV-1a instead of Python's builtin `hash()`:
builtin `hash()` is randomized per-process for str/bytes (`PYTHONHASHSEED`),
which would break "same person → same sprite" across process restarts, not
just within one run. Everything else (`event.py`, `sinks/http_sink.py`)
uses the stdlib (`json`, `urllib.request`) — the event shape is small and
fixed, so a third-party dependency isn't worth it.

`sinks/http_sink.py` bounds every network call with an explicit `timeout=`
and catches every failure mode into `return False`, never a propagated
exception or an indefinite block: a sink hiccup must never crash or freeze
the capture loop, since `publish()` runs synchronously in the same loop
that polls the mute switch (verified — see `test_event.py` and the manual
black-hole-listener check in this repo's history).
