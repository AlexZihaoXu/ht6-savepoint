"""Tests for get_llm_client's backend dispatch (SAV-33, SAV-51/52).

Construction-only: no network call is ever made, just that each ``recap_backend``
value builds the right client wired to the right settings.
"""

from __future__ import annotations

import pytest

from savepoint_server.core.config import Settings
from savepoint_server.services.llm import FreesoloClient, GemmaClient, get_llm_client


def test_get_llm_client_gemma_wires_gemma_settings() -> None:
    settings = Settings(
        recap_backend="gemma",
        gemma_base_url="https://gemma.example.test/v1",
        gemma_api_key="gemma-key",
        gemma_model="gemma-4-12B-it",
    )

    client = get_llm_client(settings)

    assert isinstance(client, GemmaClient)
    assert client._base_url == "https://gemma.example.test/v1"
    assert client._api_key == "gemma-key"
    assert client._model == "gemma-4-12B-it"


def test_get_llm_client_freesolo_wires_freesolo_settings() -> None:
    settings = Settings(
        recap_backend="freesolo",
        freesolo_base_url="https://clado-ai--freesolo-lora-serving.modal.run/v1",
        freesolo_api_key="fslo-key",
        freesolo_model="flash-1784385924-84f2f8d7",
    )

    client = get_llm_client(settings)

    assert isinstance(client, FreesoloClient)
    assert client._base_url == "https://clado-ai--freesolo-lora-serving.modal.run/v1"
    assert client._api_key == "fslo-key"
    assert client._model == "flash-1784385924-84f2f8d7"


@pytest.mark.parametrize("backend", ["gemini", "backboard"])
def test_get_llm_client_unwired_backend_raises(backend: str) -> None:
    settings = Settings(recap_backend=backend)  # type: ignore[arg-type]

    with pytest.raises(NotImplementedError, match=backend):
        get_llm_client(settings)
