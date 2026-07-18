"""Pluggable LLM client for recap/bio generation (DESIGN §11, SAV-33).

Recaps are written by an LLM over an OpenAI-compatible *chat completions* API.
The backend is a config switch (:attr:`Settings.recap_backend`): Alex's
self-hosted **Gemma** endpoint is the default and only wired backend today, while
Gemini / Backboard / FreeSolo (SAV-51/52) drop in later without touching any call
site — every backend implements the same :class:`LLMClient` protocol.

The self-hosted Gemma endpoint has one non-obvious requirement: the request body
must carry ``chat_template_kwargs {"enable_thinking": false}`` or the model
returns empty content (see ``core/config.py``). :class:`GemmaClient` always sends
it.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx

from savepoint_server.core.config import Settings, get_settings


class LLMClient(Protocol):
    """A minimal chat-completion backend used to write recaps and bios.

    Any OpenAI-compatible provider can satisfy this; the recap service depends
    only on this protocol, never on a concrete client.
    """

    async def complete(self, system: str, user: str, max_tokens: int, temperature: float) -> str:
        """Return the assistant's reply for a ``system`` + ``user`` prompt pair."""
        ...


class GemmaClient:
    """:class:`LLMClient` for the self-hosted Gemma OpenAI-compatible endpoint.

    POSTs to ``{base_url}/chat/completions`` with optional ``Bearer`` auth and the
    mandatory ``chat_template_kwargs {"enable_thinking": false}`` (without which the
    endpoint returns empty content). Uses an async ``httpx`` client so it never
    blocks the event loop.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None = None,
        model: str = "gemma",
        timeout: float = 60.0,
    ) -> None:
        # Trim a trailing slash so "{base}/chat/completions" is always well-formed.
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def complete(self, system: str, user: str, max_tokens: int, temperature: float) -> str:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            # REQUIRED by the self-hosted Gemma endpoint, else content comes back
            # empty (see core/config.py).
            "chat_template_kwargs": {"enable_thinking": False},
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
        return str(data["choices"][0]["message"]["content"])


def get_llm_client(settings: Settings | None = None) -> LLMClient:
    """Build the configured recap LLM client (``recap_backend``, default ``gemma``).

    Only ``gemma`` is implemented today; the other OpenAI-compatible backends are
    accepted config values but raise a clear :class:`NotImplementedError` until
    SAV-51/52 wire them in.
    """
    settings = settings or get_settings()
    backend = settings.recap_backend
    if backend == "gemma":
        return GemmaClient(
            base_url=settings.gemma_base_url,
            api_key=settings.gemma_api_key,
            model=settings.gemma_model,
        )
    raise NotImplementedError(
        f"recap_backend={backend!r} is not wired yet — only 'gemma' is implemented. "
        "Gemini / Backboard / FreeSolo land in SAV-51/52; they are OpenAI-compatible, "
        "so add a client here and select it via SAVEPOINT_RECAP_BACKEND."
    )
