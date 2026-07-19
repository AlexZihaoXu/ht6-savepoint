"""``wearer_voice`` collection model: the enrolled wearer's speaker voiceprint.

A **singleton** document — there is exactly one wearer per deployment, so
:class:`~savepoint_server.db.repositories.WearerVoiceRepository` always reads and
writes it under the literal ``_id`` ``"you"``. ``POST /voice/enroll``
(``api/voice.py``) creates/overwrites it from a sample recording; once present,
``services/voice.py``'s ``match_voice_to_you`` uses it to auto-label the wearer's
own diarized speech as ``"you"`` on future transcriptions.
"""

from __future__ import annotations

from datetime import datetime

from savepoint_server.models.base import MongoModel


class WearerVoice(MongoModel):
    """The wearer's enrolled voice embedding, used for speaker auto-matching."""

    # 256-d L2-normalized speaker embedding from pyannote/wespeaker-voxceleb-
    # resnet34-LM (see services/voice.py's VoiceEnroller) — the same model
    # align.py already loads internally for its per-speaker voiceprints.
    embedding: list[float]
    enrolled_at: datetime
