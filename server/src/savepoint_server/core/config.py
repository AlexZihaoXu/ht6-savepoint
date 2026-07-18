"""Application configuration via ``pydantic-settings``.

Values load from environment variables (prefix ``SAVEPOINT_``) or a ``.env`` file
in the ``server/`` directory. Secrets (API keys) are never hard-coded here — set
them in the environment.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached process-wide settings instance."""
    return Settings()
