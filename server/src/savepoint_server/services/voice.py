"""Wearer voice enrollment + speaker auto-matching (SAV-?).

Like :mod:`services.speech`, this module keeps its own imports light and reaches
the heavy speech runtime by **subprocess only**: :class:`VoiceEnroller` shells out
to ``voiceprint.py`` in jiucheng's vendored ``two-speaker-demo`` pipeline (the
same ``.venv-stream`` virtualenv ``align.py`` already runs in) to extract a
256-d L2-normalized speaker embedding from a clean sample of the wearer
speaking, via ``pyannote/wespeaker-voxceleb-resnet34-LM``. That embedding is
stored as the singleton :class:`~savepoint_server.models.wearer_voice.WearerVoice`
document (``POST /voice/enroll``).

Once enrolled, :func:`match_voice_to_you` is the auto-labeling step: given a
freshly diarized :class:`Transcript` and the :class:`Transcriber` that produced
it, if that transcriber is a :class:`~savepoint_server.services.speech.RealTranscriber`
and it captured per-speaker voiceprints for this call (``last_voiceprints`` —
align.py's previously-discarded voiceprints, now exposed in its own JSON
output), the best-matching raw ``Speaker N`` label is rewritten to the literal
speaker ``"you"`` when its cosine similarity to the enrolled wearer embedding
clears the configured threshold. This never runs for the CI-safe
:class:`~savepoint_server.services.speech.StubTranscriber` (no voiceprints to
compare), so the default dev/test path is completely unaffected.
"""

from __future__ import annotations

import json
import math
import subprocess
import tempfile
from pathlib import Path

from savepoint_server.core.config import Settings, get_settings
from savepoint_server.db.repositories import Repositories
from savepoint_server.models import Transcript
from savepoint_server.services.speech import (
    RealTranscriber,
    SpeechPipelineError,
    Transcriber,
    _sniff_audio_extension,
    normalize_audio_to_wav,
)

# Re-exported under a voice-specific name for callers that don't want to know
# this is the same subprocess-pipeline-stage-failed error speech.py raises —
# both VoiceEnroller and RealTranscriber shell out into the same pipeline venvs,
# so this avoids a duplicate, near-identical exception type.
VoiceEnrollmentError = SpeechPipelineError


class VoiceEnroller:
    """Extract a wearer speaker embedding from a sample recording.

    Mirrors :class:`~savepoint_server.services.speech.RealTranscriber`'s shape and
    subprocess pattern: normalize the raw upload to a clean WAV via ffmpeg
    (reusing speech.py's :func:`~savepoint_server.services.speech.normalize_audio_to_wav`
    and :func:`~savepoint_server.services.speech._sniff_audio_extension`), then
    run ``voiceprint.py`` in the pipeline's ``.venv-stream`` interpreter. No
    torch/pyannote/speechbrain is imported in this process.
    """

    def __init__(
        self,
        *,
        align_python: str | Path,
        pipeline_dir: str | Path,
        hf_token: str | None,
        ffmpeg_path: str = "ffmpeg",
    ) -> None:
        self._align_python = str(align_python)
        self._pipeline_dir = Path(pipeline_dir)
        self._hf_token = hf_token
        self._ffmpeg_path = ffmpeg_path

    def enroll(self, audio: bytes) -> list[float]:
        """Return a 256-d L2-normalized speaker embedding for ``audio``.

        Raises :class:`VoiceEnrollmentError` (with the subprocess's stderr) on
        any failure — including a too-short/unusable sample, which makes
        ``voiceprint.py`` itself exit non-zero with a clear message.
        """
        with tempfile.TemporaryDirectory(prefix="savepoint-voiceprint-") as tmp:
            tmp_dir = Path(tmp)
            raw_path = tmp_dir / f"raw{_sniff_audio_extension(audio)}"
            raw_path.write_bytes(audio)
            wav_path = tmp_dir / "sample.wav"
            normalize_audio_to_wav(raw_path, wav_path, ffmpeg_path=self._ffmpeg_path)

            out_json = tmp_dir / "voiceprint.json"
            self._run(wav_path, out_json)

            data = json.loads(out_json.read_text(encoding="utf-8"))
            embedding = data.get("embedding")
            if not isinstance(embedding, list) or not embedding:
                raise VoiceEnrollmentError(
                    "voiceprint.py produced no usable embedding for this sample."
                )
            return [float(x) for x in embedding]

    def _env(self) -> dict[str, str]:
        import os

        token = self._hf_token or os.environ.get("HF_TOKEN")
        if not token:
            raise VoiceEnrollmentError(
                "VoiceEnroller needs a Hugging Face token (set SAVEPOINT_HF_TOKEN "
                "or HF_TOKEN) for the gated wespeaker embedding model."
            )
        return {**os.environ, "HF_TOKEN": token}

    def _run(self, wav_path: Path, out_json: Path) -> None:
        result = subprocess.run(
            [self._align_python, "voiceprint.py", str(wav_path), "--out", str(out_json)],
            cwd=self._pipeline_dir,
            env=self._env(),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise VoiceEnrollmentError(
                f"voiceprint extraction failed (exit {result.returncode}): "
                f"{result.stderr.strip()}"
            )


def get_voice_enroller(settings: Settings | None = None) -> VoiceEnroller:
    """Build a :class:`VoiceEnroller` from config.

    Mirrors :func:`~savepoint_server.services.speech.get_transcriber`'s shape:
    reuses ``speech_pipeline_dir``/``speech_align_python``/``hf_token``/
    ``speech_ffmpeg_path`` — ``voiceprint.py`` runs in the same ``.venv-stream``
    venv as ``align.py``, so no separate settings are needed.
    """
    settings = settings or get_settings()
    align_python = settings.speech_align_python or str(
        Path(settings.speech_pipeline_dir) / ".venv-stream" / "bin" / "python"
    )
    return VoiceEnroller(
        align_python=align_python,
        pipeline_dir=settings.speech_pipeline_dir,
        hf_token=settings.hf_token,
        ffmpeg_path=settings.speech_ffmpeg_path,
    )


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors; ``0.0`` if either is a zero vector."""
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    return dot / (norm_a * norm_b)


async def match_voice_to_you(
    transcript: Transcript,
    transcriber: Transcriber,
    repos: Repositories,
    threshold: float,
) -> Transcript:
    """Auto-label the wearer's own diarized speech as ``"you"``, if it matches.

    A cheap no-op (returns ``transcript`` unchanged, same object) unless ALL of:

    * ``transcriber`` is a :class:`~savepoint_server.services.speech.RealTranscriber`
      that captured per-speaker voiceprints for this call
      (``transcriber.last_voiceprints``);
    * a wearer voiceprint has been enrolled (``repos.wearer_voice.get("you")``);
    * the best-matching raw speaker label's cosine similarity to the enrolled
      embedding is ``>= threshold``.

    When it matches, returns a **new** :class:`Transcript` with every segment
    carrying that one raw label rewritten to ``"you"`` — every other segment/
    label is left untouched, and at most one raw label is ever relabeled.
    """
    if not isinstance(transcriber, RealTranscriber) or not transcriber.last_voiceprints:
        return transcript

    wearer = await repos.wearer_voice.get("you")
    if wearer is None:
        return transcript

    best_label: str | None = None
    best_score = float("-inf")
    for label, voiceprint in transcriber.last_voiceprints.items():
        score = cosine_similarity(wearer.embedding, voiceprint)
        if score > best_score:
            best_score = score
            best_label = label

    if best_label is None or best_score < threshold:
        return transcript

    return Transcript(
        segments=[
            segment.model_copy(update={"speaker": "you"})
            if segment.speaker == best_label
            else segment
            for segment in transcript.segments
        ]
    )
