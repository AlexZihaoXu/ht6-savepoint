"""Speech service: audio -> diarized transcript -> Events in Mongo (SAV-32).

This module deliberately keeps its *module-level* imports light — only the
standard library and Pydantic models. The heavy speech runtime (torch, pyannote,
faster-whisper, speechbrain) lives in jiucheng's vendored pipeline and its own
virtualenvs **outside** this repo; the :class:`RealTranscriber` reaches it by
**subprocess**, never by importing it. That is what lets this module (and the
``/speech/transcribe`` endpoint) import and run in CI with no torch installed.

Two transcribers implement the :class:`Transcriber` interface:

* :class:`StubTranscriber` — the **default**. Returns a canned, tc1-derived
  transcript loaded from a small JSON fixture packaged with the server. No audio
  processing, no downloads, no torch: safe for dev and CI, and enough to exercise
  the whole transcript -> events -> Mongo path end to end.
* :class:`RealTranscriber` — shells out to the real pipeline:
  ``.venv/bin/python diarize.py`` (pyannote Community-1 diarization) then
  ``.venv-stream/bin/python align.py`` (SepFormer overlap-split + faster-whisper),
  parsing align's ``turns`` JSON into a :class:`Transcript`. Selected only when
  ``SAVEPOINT_TRANSCRIBER=real``; never imported/run in tests.

Which one runs is chosen by config (:func:`get_transcriber`).
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import UTC, date, datetime, timedelta
from importlib import resources
from pathlib import Path
from typing import Protocol

from savepoint_server.core.config import Settings, get_settings
from savepoint_server.db.repositories import Repositories
from savepoint_server.models import Event, EventType, Transcript, TranscriptSegment

# Audio can be given as a filesystem path or as raw bytes (e.g. an upload body).
AudioInput = str | Path | bytes


def normalize_audio_to_wav(src: Path, dst: Path, *, ffmpeg_path: str = "ffmpeg") -> None:
    """Transcode ``src`` to a clean 16kHz mono WAV via ffmpeg.

    Shared by :class:`RealTranscriber` (both pipeline stages need it: diarize.py's
    torchcodec-based reader can decode WebM/Opus but the container doesn't
    reliably expose a duration, and align.py's old torchaudio (soundfile
    backend) can't read WebM/Opus at all) and ``services.voice.VoiceEnroller``
    (voiceprint.py has the same soundfile-backend limitation). Normalizing once
    up front sidesteps both — a free function (not a method) so both modules can
    import it without either owning the other.
    """
    result = subprocess.run(
        [ffmpeg_path, "-y", "-i", str(src), "-ar", "16000", "-ac", "1", str(dst)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SpeechPipelineError(
            f"ffmpeg audio normalization failed (exit {result.returncode}): "
            f"{result.stderr.strip()}"
        )


def _sniff_audio_extension(data: bytes) -> str:
    """Guess a filesystem extension from an audio blob's magic bytes.

    Covers what actually shows up here: WAV (curl/file uploads) and WebM
    (the browser's ``MediaRecorder``, which is Opus-in-WebM by default in
    Chromium). Falls back to ``.wav`` for anything unrecognized.
    """
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ".wav"
    if data[:4] == b"\x1a\x45\xdf\xa3":  # EBML header (WebM/Matroska)
        return ".webm"
    if data[:4] == b"OggS":
        return ".ogg"
    if data[4:8] == b"ftyp":  # MP4/M4A family
        return ".m4a"
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return ".mp3"
    return ".wav"


class Transcriber(Protocol):
    """Turns an audio recording into an ordered diarized :class:`Transcript`."""

    def transcribe(self, audio: AudioInput) -> Transcript:
        """Return the ``Speaker N: text`` transcript for ``audio``."""
        ...


# --------------------------------------------------------------------------- #
# Stub transcriber (default, CI-safe)
# --------------------------------------------------------------------------- #

# Packaged fixture shipped with the server so the default transcriber works even
# when installed (no dependency on the tests/ tree). Derived from the pipeline's
# tc1 ground truth; server/tests/fixtures/tc1_stub.json holds an identical copy
# used as the tests' expected reference.
_STUB_FIXTURE = "stub_transcript.json"


def _load_stub_transcript() -> Transcript:
    """Load the canned transcript from the packaged JSON fixture."""
    raw = (
        resources.files("savepoint_server.services")
        .joinpath(f"fixtures/{_STUB_FIXTURE}")
        .read_text(encoding="utf-8")
    )
    return Transcript.model_validate(json.loads(raw))


class StubTranscriber:
    """Return a fixed, tc1-derived transcript regardless of the input audio.

    This is the default transcriber: it needs no torch, no model downloads and no
    real audio, so the full transcript -> events -> Mongo flow is exercisable in
    dev and CI. The ``audio`` argument is accepted for interface parity and
    ignored.
    """

    def __init__(self, transcript: Transcript | None = None) -> None:
        self._transcript = transcript if transcript is not None else _load_stub_transcript()

    def transcribe(self, audio: AudioInput) -> Transcript:
        # Return a copy so callers can't mutate the shared canned transcript.
        return self._transcript.model_copy(deep=True)


# --------------------------------------------------------------------------- #
# Real transcriber (subprocess into jiucheng's pipeline; not run in CI)
# --------------------------------------------------------------------------- #


class SpeechPipelineError(RuntimeError):
    """Raised when a RealTranscriber subprocess stage fails."""


class RealTranscriber:
    """Run the real speech pipeline out-of-process and parse its transcript.

    Two subprocess stages, each in its own virtualenv under ``pipeline_dir``
    (jiucheng's ``two-speaker-demo``):

    1. ``diarize.py <audio> -o diarization.json`` with ``.venv`` (pyannote
       Community-1). Needs ``HF_TOKEN`` in the environment for the gated model.
    2. ``align.py <audio> --diar diarization.json --out transcript.json`` with
       ``.venv-stream`` (SepFormer overlap separation + faster-whisper, CPU),
       which writes ``{"audio": ..., "turns": [...]}`` — the same
       ``start/end/speaker/text/overlap`` shape as :class:`TranscriptSegment`.

    No torch/pyannote/whisper is imported in this process; everything heavy stays
    behind the subprocess boundary, so importing this module is always cheap and
    CI never pulls the speech runtime. Instantiated only when
    ``SAVEPOINT_TRANSCRIBER=real``.
    """

    def __init__(
        self,
        *,
        pipeline_dir: str | Path,
        diarize_python: str | Path,
        align_python: str | Path,
        hf_token: str | None,
        whisper_model: str = "small.en",
        ffmpeg_path: str = "ffmpeg",
    ) -> None:
        self._pipeline_dir = Path(pipeline_dir)
        self._diarize_python = str(diarize_python)
        self._align_python = str(align_python)
        self._hf_token = hf_token
        self._whisper_model = whisper_model
        self._ffmpeg_path = ffmpeg_path
        # Per-speaker-label voiceprints from align.py's last transcribe() call
        # (``{"Speaker 1": [...256 floats...], ...}``), if any — set inside
        # transcribe() below. Consumed by services.voice.match_voice_to_you to
        # auto-label the wearer's own speech. A fresh RealTranscriber is
        # constructed per request (get_transcriber() is not cached), so this
        # instance state never leaks across requests.
        self.last_voiceprints: dict[str, list[float]] = {}

    def transcribe(self, audio: AudioInput) -> Transcript:
        with tempfile.TemporaryDirectory(prefix="savepoint-speech-") as tmp:
            tmp_dir = Path(tmp)
            raw_path = self._resolve_audio(audio, tmp_dir)
            audio_path = tmp_dir / "input.wav"
            self._normalize_to_wav(raw_path, audio_path)
            diar_json = tmp_dir / "diarization.json"
            transcript_json = tmp_dir / "transcript.json"

            self._run_diarize(audio_path, diar_json)
            self._run_align(audio_path, diar_json, transcript_json)

            data = json.loads(transcript_json.read_text(encoding="utf-8"))
            self.last_voiceprints = data.get("voiceprints", {})
            turns = data.get("turns", [])
            return Transcript(
                segments=[
                    TranscriptSegment(
                        speaker=str(t["speaker"]),
                        text=str(t["text"]),
                        start=float(t["start"]),
                        end=float(t["end"]),
                        overlap=bool(t.get("overlap", False)),
                    )
                    for t in turns
                ]
            )

    def _resolve_audio(self, audio: AudioInput, tmp_dir: Path) -> Path:
        """Return a filesystem path for ``audio``, writing bytes to a temp file.

        The extension is sniffed from the audio's magic bytes rather than
        assumed to be WAV, purely so ffmpeg's own format probing (see
        ``_normalize_to_wav``) has a correct hint — the browser's
        ``MediaRecorder`` (the app's mic capture) hands back WebM/Opus bytes,
        not WAV.
        """
        if isinstance(audio, bytes):
            path = tmp_dir / f"raw{_sniff_audio_extension(audio)}"
            path.write_bytes(audio)
            return path
        return Path(audio)

    def _normalize_to_wav(self, src: Path, dst: Path) -> None:
        """Transcode ``src`` to a clean 16kHz mono WAV via ffmpeg.

        Both pipeline stages need this: diarize.py's torchcodec-based reader
        can decode WebM/Opus but the container doesn't reliably expose a
        duration (breaks deep inside pyannote's audio I/O), and align.py's
        old torchaudio (soundfile backend) can't read WebM/Opus at all.
        Normalizing once up front sidesteps both. Delegates to the shared
        :func:`normalize_audio_to_wav` free function (also used by
        ``services.voice.VoiceEnroller``).
        """
        normalize_audio_to_wav(src, dst, ffmpeg_path=self._ffmpeg_path)

    def _env(self) -> dict[str, str]:
        import os

        token = self._hf_token or os.environ.get("HF_TOKEN")
        if not token:
            raise SpeechPipelineError(
                "RealTranscriber needs a Hugging Face token (set SAVEPOINT_HF_TOKEN "
                "or HF_TOKEN) for the gated pyannote diarization model."
            )
        return {**os.environ, "HF_TOKEN": token}

    def _run_diarize(self, audio_path: Path, out_json: Path) -> None:
        # Explicit --device cpu: diarize.py's "auto" (its default) would pick
        # MPS on Apple Silicon, which is unvalidated for pyannote's ops here —
        # CPU is what's actually been confirmed working.
        self._run(
            [
                self._diarize_python,
                "diarize.py",
                str(audio_path),
                "-o",
                str(out_json),
                "--device",
                "cpu",
            ],
            stage="diarize",
        )

    def _run_align(self, audio_path: Path, diar_json: Path, out_json: Path) -> None:
        self._run(
            [
                self._align_python,
                "align.py",
                str(audio_path),
                "--diar",
                str(diar_json),
                "--model",
                self._whisper_model,
                "--out",
                str(out_json),
            ],
            stage="align",
        )

    def _run(self, cmd: list[str], *, stage: str) -> None:
        result = subprocess.run(
            cmd,
            cwd=self._pipeline_dir,
            env=self._env(),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SpeechPipelineError(
                f"speech pipeline stage '{stage}' failed "
                f"(exit {result.returncode}): {result.stderr.strip()}"
            )


# --------------------------------------------------------------------------- #
# Selection + storage
# --------------------------------------------------------------------------- #


def get_transcriber(settings: Settings | None = None) -> Transcriber:
    """Build the configured transcriber (``stub`` by default, ``real`` on opt-in).

    ``RealTranscriber`` is only constructed when explicitly selected, so the
    default path never references the (absent-in-CI) pipeline venvs.
    """
    settings = settings or get_settings()
    if settings.transcriber == "real":
        diarize_python = settings.speech_diarize_python or str(
            Path(settings.speech_pipeline_dir) / ".venv" / "bin" / "python"
        )
        align_python = settings.speech_align_python or str(
            Path(settings.speech_pipeline_dir) / ".venv-stream" / "bin" / "python"
        )
        return RealTranscriber(
            pipeline_dir=settings.speech_pipeline_dir,
            diarize_python=diarize_python,
            align_python=align_python,
            hf_token=settings.hf_token,
            whisper_model=settings.speech_whisper_model,
            ffmpeg_path=settings.speech_ffmpeg_path,
        )
    return StubTranscriber()


def _segment_ts(day_id: str, start: float) -> datetime:
    """Timestamp a segment: midnight (UTC) of ``day_id`` + its start offset.

    Anchoring on the day and adding the in-recording offset keeps events ordered
    the same way the transcript is, so day feeds read back in spoken order.
    """
    day = date.fromisoformat(day_id)
    base = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return base + timedelta(seconds=start)


def event_from_segment(segment: TranscriptSegment, *, day_id: str) -> Event:
    """Map one :class:`TranscriptSegment` onto a SPOKE :class:`Event`.

    The raw ``Speaker N`` label is kept as ``person_id`` — resolving a diarization
    label to a real person is a later ticket.
    """
    return Event(
        ts=_segment_ts(day_id, segment.start),
        person_id=segment.speaker,
        type=EventType.SPOKE,
        text=segment.text,
        day_id=day_id,
        start=segment.start,
        end=segment.end,
        overlap=segment.overlap,
    )


def transcript_from_events(events: list[Event]) -> Transcript:
    """Rebuild a :class:`Transcript` from stored SPOKE events (lossless)."""
    return Transcript(
        segments=[
            TranscriptSegment(
                speaker=e.person_id,
                text=e.text or "",
                start=e.start or 0.0,
                end=e.end or 0.0,
                overlap=e.overlap,
            )
            for e in events
        ]
    )


async def transcribe_and_store(
    audio: AudioInput,
    *,
    day_id: str,
    repos: Repositories,
    transcriber: Transcriber | None = None,
) -> list[Event]:
    """Transcribe ``audio`` and persist each segment as an Event in Mongo.

    Runs the configured transcriber (stub by default), auto-labels the wearer's
    own speech as ``"you"`` if a voiceprint is enrolled and matches
    (:func:`~savepoint_server.services.voice.match_voice_to_you`), maps every
    :class:`TranscriptSegment` to a SPOKE :class:`Event` under ``day_id``, inserts
    them via :class:`EventsRepository`, and returns the stored events (with ids) in
    transcript order.
    """
    # Deferred import: services.voice imports RealTranscriber from this module,
    # so a top-level import here would be circular.
    from savepoint_server.services.voice import match_voice_to_you

    transcriber = transcriber or get_transcriber()
    transcript = transcriber.transcribe(audio)
    settings = get_settings()
    transcript = await match_voice_to_you(
        transcript, transcriber, repos, settings.voice_match_threshold
    )
    stored: list[Event] = []
    for segment in transcript.segments:
        event = await repos.events.insert(event_from_segment(segment, day_id=day_id))
        stored.append(event)
    return stored
