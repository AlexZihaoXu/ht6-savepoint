"""Application configuration via ``pydantic-settings``.

Values load from environment variables (prefix ``SAVEPOINT_``) or a ``.env`` file
in the ``server/`` directory. Secrets (API keys) are never hard-coded here — set
them in the environment.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_sprites_dir() -> str:
    """Return the default persistent sprite-cache dir: ``<repo>/server/.sprites``.

    This file lives at ``server/src/savepoint_server/core/config.py``, so the
    ``server/`` root is four parents up. Kept as a factory (not a literal) so the
    path resolves correctly regardless of the process CWD, and stays overridable via
    ``SAVEPOINT_SPRITES_DIR``.
    """
    return str(Path(__file__).resolve().parents[3] / ".sprites")


class Settings(BaseSettings):
    """Runtime configuration for the SavePoint server."""

    model_config = SettingsConfigDict(
        env_prefix="SAVEPOINT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Service ---
    app_name: str = "SavePoint Server"
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    # --- MongoDB (DESIGN §9 data store) ---
    mongo_uri: str = "mongodb://127.0.0.1:27017"
    mongo_db: str = "savepoint"

    # --- LLM recap/bio backends (DESIGN §11) ---
    # Self-hosted Gemma OpenAI-compatible endpoint (Alex's box). When calling it,
    # pass chat_template_kwargs {"enable_thinking": false} or content comes back empty.
    # NOTE: this default is a placeholder — point SAVEPOINT_GEMMA_BASE_URL at a REAL LLM
    # host (the default :8000 collides with the API's own port and won't serve chats). If
    # it's unreachable the recap endpoint degrades gracefully to a canned recap, not a 500.
    gemma_base_url: str = "http://127.0.0.1:8000/v1"
    # Bearer token for the Gemma endpoint (env SAVEPOINT_GEMMA_API_KEY); None = no auth.
    gemma_api_key: str | None = None
    # Model name sent in the chat.completions payload. The self-hosted vLLM/llama.cpp
    # endpoint serves under an exact id (e.g. "gemma-4-12B-it-Q4_K_M.gguf"); override
    # via SAVEPOINT_GEMMA_MODEL to match whatever `--served-model-name` it exposes.
    gemma_model: str = "gemma"
    gemini_api_key: str | None = None
    # Model id for Gemini's generateContent REST API (used by transcript_refine below).
    gemini_model: str = "gemini-2.0-flash"
    backboard_api_key: str | None = None
    # FreeSolo Flash fine-tuned adapter (see server/finetune/): a small model SFT-trained
    # specifically on SavePoint's day-events -> recap task via the FreeSolo Flash
    # platform (Hack the 6ix prize track). OpenAI-compatible; unlike Gemma it needs no
    # chat_template_kwargs. base_url/model are tied to a specific `flash deploy` run —
    # see server/finetune/smoke_test.py and `flash deployments --json` if redeployed.
    freesolo_base_url: str = "https://clado-ai--freesolo-lora-serving.modal.run/v1"
    freesolo_api_key: str | None = None
    freesolo_model: str = "flash-1784385924-84f2f8d7"
    # Which backend get_llm_client builds for recaps/bios. "gemma" (self-hosted,
    # default) is the only one wired today; gemini/backboard land in SAV-51/52 and
    # any OpenAI-compatible endpoint swaps in here.
    recap_backend: Literal["gemma", "gemini", "backboard", "freesolo"] = "gemma"

    # --- Transcript refinement (SAV-56/58) ---
    # OPTIONAL, non-blocking LLM cleanup of diarized transcript text on the
    # audio-ingest path via an ordered engine chain (first valid result wins). "none"
    # (default) makes NO LLM call and leaves ingest byte-identical to today. In every
    # mode the cleanup is best-effort and can NEVER block or 500 ingest — any failure/
    # timeout/mismatch across ALL engines falls back to the raw transcript (see
    # services/transcript_refine.py). Modes:
    #   "none"   -> no refinement (default).
    #   "gemini" -> Gemini first (needs gemini_api_key), then Gemma as a quota-free
    #               fallback when a real gemma_base_url is set. If neither is
    #               configured, refinement is disabled.
    #   "gemma"  -> Gemma only (needs a real gemma_base_url, i.e. moved off the
    #               placeholder default). No quota, so no Gemini key required.
    transcript_refine: Literal["none", "gemini", "gemma"] = "none"

    # --- PixelLab AI sprite generation (SAV-61) ---
    # An external AI pixel-art service (https://api.pixellab.ai) that turns a
    # person's avatar_params into a per-person sprite sheet (4 directions + an east
    # walk animation), cached under ``sprites_dir`` and served from ``/sprites``.
    # DEFAULT OFF: with no key and ``pixellab_enabled=False`` the ingest paths never
    # construct a client and behavior is byte-identical to today. Real generation
    # costs credits and is run by hand (scripts/gen_sprites.py), never in CI/tests.
    pixellab_api_key: str | None = None
    pixellab_enabled: bool = False
    # Persistent, gitignored dir (server/.sprites) where generated PNGs live and are
    # mounted at ``/sprites/{local_id}/{file}``. Override with SAVEPOINT_SPRITES_DIR.
    sprites_dir: str = Field(default_factory=_default_sprites_dir)

    # --- Person identity matching (video ingest) ---
    # Cross-session nearest-embedding fallback (DESIGN §9: "match by nearest
    # face embedding, else new localId"). edge/identity_gallery.py's
    # IdentityGallery is deliberately session-scoped/in-memory — a track that
    # expires and reforms (e.g. a brief occlusion) mints a genuinely fresh
    # local_id even for the same physical person who never left. Without this
    # fallback, /ingest/video upserted strictly by exact local_id match, so
    # every such re-mint created a brand-new duplicate Person. Same embedding
    # space as the edge's own matching (w600k_mbf ArcFace, 512-d,
    # L2-normalized) — see identity_gallery.py's own citation for why 0.30.
    person_match_similarity_threshold: float = 0.30

    # --- Demo history (services/demo_history.py) ---
    # DEFAULT OFF, same idiom as pixellab_enabled above: with this False the read
    # API's demo-fallback branches are never even consulted and behavior is
    # byte-identical to before this existed — a fresh/empty DB (every CI run,
    # every teammate's first `uv run pytest`) must NOT grow a cast of fake people
    # just because Mongo has nothing yet. Flip to True only for an actual demo
    # run, where it hardcodes an in-code ~week of past days/people (never written
    # to Mongo — see that module) so the garden/day-view/people screens have
    # something to show beyond whatever the camera captured today.
    demo_history_enabled: bool = False

    # --- Speech pipeline (SAV-32) ---
    # Which transcriber the speech service uses. "stub" (default) is CI-safe and
    # needs no torch; "real" shells out to jiucheng's vendored pipeline.
    transcriber: Literal["stub", "real"] = "stub"
    # RealTranscriber only — where the heavy pipeline + its two venvs live
    # (OUTSIDE the repo). Never touched by the default stub or in CI.
    speech_pipeline_dir: str = "/home/agent/two-speaker-demo"
    # Interpreters for each stage; default to the venvs under speech_pipeline_dir.
    speech_diarize_python: str | None = None  # default: <dir>/.venv/bin/python
    speech_align_python: str | None = None  # default: <dir>/.venv-stream/bin/python
    speech_whisper_model: str = "small.en"
    # Hugging Face token for the gated pyannote models (RealTranscriber only).
    hf_token: str | None = None
    # ffmpeg binary RealTranscriber normalizes uploads through before handing
    # them to either pipeline stage (browser recordings arrive as WebM/Opus,
    # not WAV) — plain "ffmpeg" resolves via PATH; override for a
    # machine-specific build the system ffmpeg can't otherwise provide.
    speech_ffmpeg_path: str = "ffmpeg"

    # --- Timeline alignment: bind an utterance to a seen Person (DESIGN §4) ---
    # How close (seconds) a SPOKE utterance and a camera SEEN sighting need to
    # be to count as "you were looking at them when they said that" —
    # services/ingest.py's auto_match_speakers_to_seen_people. Same idea as
    # (but a separate, independently-tunable knob from) the plaza's live
    # "who am I facing right now" window on the frontend.
    speaker_seen_match_window_s: float = 60.0

    # --- Wearer voice enrollment (SAV-?) ---
    # Cosine-similarity threshold for auto-matching a diarized "Speaker N" label
    # to the enrolled wearer voiceprint (services/voice.py's match_voice_to_you).
    # NOTE: a starting point, not empirically tuned — voice-embedding similarity
    # distributions for short phone-mic clips against the wespeaker-voxceleb-
    # resnet34-LM embedding aren't validated on this deployment yet. Revisit once
    # real enrollment + diarization samples are in hand.
    voice_match_threshold: float = 0.45


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached process-wide settings instance."""
    return Settings()
