"""Optional, non-blocking transcript cleanup on the audio-ingest path (SAV-56/58).

The decoupled audio stream lands raw diarized turns (``Speaker N: text``) exactly
as the ASR produced them. This module offers an **opt-in** pass that asks an LLM to
fix obvious speech-recognition errors, punctuation, and casing in each turn's *text
only* — never touching the speaker labels, the number of turns, the order, or the
timing.

The cleanup runs through an **ordered chain of engines** (SAV-58): each engine is a
minimal text-in / text-out :class:`TranscriptRefineClient`. :func:`refine_segments`
tries them in order and the **first structurally valid** result wins; an engine that
throws (network error, 429, timeout) or returns something that doesn't match the
input advances to the next engine. Two engines exist today:

* :class:`GeminiRefiner` — Google's Gemini ``generateContent`` REST API. It is
  quota'd, so on 429/error we fall back to…
* :class:`GemmaRefiner` — the self-hosted Gemma chat endpoint (no quota), wrapping
  the very same :class:`~savepoint_server.services.llm.GemmaClient` used for recaps.

The overriding rule (jiucheng's spec): this must **never block or 500 ingest**.
Every engine call is fully guarded — on *any* failure across *all* engines,
:func:`refine_segments` returns the **input segments unchanged** and never raises.
When ``transcript_refine`` is ``"none"`` (the default) or no engine is configured,
:func:`get_transcript_refiner` returns ``None`` and ingest is byte-identical to
today — no LLM call is ever made.

Unlike the recap LLM clients (``services/llm.py``), Gemini is **not**
OpenAI-compatible: it POSTs to ``…/models/{model}:generateContent`` with an
``x-goog-api-key`` header and a ``{"contents": [{"parts": [{"text": …}]}]}`` body,
and the reply is read from ``candidates[0].content.parts[0].text``. Gemma reuses the
OpenAI-compatible :class:`GemmaClient`, so its HTTP call is never reimplemented here.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Protocol

import httpx

from savepoint_server.core.config import Settings, get_settings
from savepoint_server.services.llm import GemmaClient, LLMClient

if TYPE_CHECKING:
    # Only needed for annotations; imported under TYPE_CHECKING so this module never
    # imports services.ingest at runtime (which imports us) — no circular import.
    from savepoint_server.services.ingest import AudioSegment

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# The known-nonfunctional Gemma default (see core/config.py: :8000 collides with the
# API's own port and won't serve chats). A Gemma refine engine is only built when the
# operator has pointed SAVEPOINT_GEMMA_BASE_URL at a REAL host — i.e. away from this
# placeholder — so the "gemini" fallback doesn't waste an ingest hitting a dead port.
_GEMMA_PLACEHOLDER_BASE_URL: str = str(Settings.model_fields["gemma_base_url"].default)

# Keep any single refine engine on a short leash so a slow/hung backend can never
# stall ingest for long: the whole cleanup is best-effort and bounded by this timeout.
_REFINE_TIMEOUT_SECONDS = 8.0

_REFINE_INSTRUCTIONS = (
    "You are a transcript cleanup assistant. Below is a diarized conversation as a "
    "JSON array of turns; each turn has a fixed integer index, a speaker label, and "
    "the raw automatic-speech-recognition text. For each turn, fix only obvious ASR "
    "mistakes, punctuation, and capitalization in the text. Do NOT translate, "
    "summarize, paraphrase, add words that were not spoken, merge or split turns, "
    "reorder turns, add or remove turns, or change any speaker label. Preserve the "
    "meaning exactly. Return ONLY a JSON array with exactly one object per input "
    'turn, in the same order, each shaped {"index": <same integer>, "speaker": '
    '<unchanged label>, "text": <cleaned text>}. Output nothing but that JSON array.'
)

# A short system message for OpenAI-compatible chat engines (Gemma). The full
# per-turn instructions ride in the user prompt (`_build_refine_prompt`); this just
# reinforces the JSON-only, no-invention contract.
_REFINE_SYSTEM = (
    "You are a precise transcript-cleanup assistant. Follow the user's instructions "
    "exactly and output only the requested JSON array — no prose, no code fences."
)


class TranscriptRefineClient(Protocol):
    """A minimal text-in / text-out **engine** used to clean a transcript.

    The refiner service depends only on this protocol, never on a concrete engine,
    so tests inject a fake and no network is touched in CI. :func:`refine_segments`
    chains several of these (e.g. Gemini then Gemma) and uses the first that returns
    a structurally valid reply.
    """

    async def generate(self, prompt: str) -> str:
        """Return the model's raw text reply for ``prompt`` (may raise on failure)."""
        ...


class GeminiRefiner:
    """:class:`TranscriptRefineClient` for Google's Gemini ``generateContent`` REST API.

    POSTs to ``{base}/{model}:generateContent`` with an ``x-goog-api-key`` header and
    a ``{"contents": [{"parts": [{"text": prompt}]}]}`` body, reading the reply from
    ``candidates[0].content.parts[0].text``. A short timeout keeps a slow Gemini from
    ever stalling ingest; any non-200 raises (caught by :func:`refine_segments`, which
    then advances to the next engine in the chain). Low temperature keeps the cleanup
    faithful rather than creative, and a JSON response mime-type nudges the model
    toward a clean, parseable array.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gemini-2.0-flash",
        timeout: float = _REFINE_TIMEOUT_SECONDS,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def generate(self, prompt: str) -> str:
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._api_key}
        payload: dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }
        url = f"{_GEMINI_BASE_URL}/{self._model}:generateContent"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data["candidates"][0]["content"]["parts"][0]["text"])


class GemmaRefiner:
    """:class:`TranscriptRefineClient` backed by the self-hosted Gemma chat endpoint.

    This is the quota-free **fallback** for :class:`GeminiRefiner`: when Gemini 429s
    or errors, the chain drops to Gemma. It does NOT reimplement the Gemma HTTP call —
    it wraps the same OpenAI-compatible :class:`~savepoint_server.services.llm.GemmaClient`
    used for recaps (which always sends the mandatory ``chat_template_kwargs
    {"enable_thinking": false}``). :meth:`generate` turns the single refine prompt into
    a ``system`` + ``user`` chat completion and returns the raw content for the shared
    parse/validate path. Low temperature keeps the cleanup faithful; the token budget
    is sized to the input so long transcripts aren't truncated.
    """

    def __init__(self, client: LLMClient, *, temperature: float = 0.2) -> None:
        self._client = client
        self._temperature = temperature

    async def generate(self, prompt: str) -> str:
        # The reply is ~the size of the input turns; budget generously but bounded so a
        # long transcript isn't clipped and a runaway generation can't balloon.
        max_tokens = min(4096, max(512, len(prompt) // 3))
        return await self._client.complete(
            system=_REFINE_SYSTEM,
            user=prompt,
            max_tokens=max_tokens,
            temperature=self._temperature,
        )


def _build_refine_prompt(segments: list[AudioSegment]) -> str:
    """Render the turns as an indexed JSON array for the cleanup prompt."""
    turns = [
        {"index": i, "speaker": seg.speaker, "text": seg.text} for i, seg in enumerate(segments)
    ]
    return f"{_REFINE_INSTRUCTIONS}\n\nInput turns:\n{json.dumps(turns, ensure_ascii=False)}"


def _strip_code_fences(text: str) -> str:
    """Drop a leading ```/```json fence and its closing ``` if the text is fenced."""
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _extract_json_array(raw: str) -> list[Any] | None:
    """Best-effort pull of a JSON array out of ``raw`` (fences / surrounding prose).

    Tries a direct parse, a fence-stripped parse, and the substring between the first
    ``[`` and last ``]``. Returns the first value that parses to a list, else ``None``.
    """
    text = raw.strip()
    candidates = [text, _strip_code_fences(text)]
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, list):
            return parsed
    return None


async def _refine_with_engine(
    segments: list[AudioSegment], engine: TranscriptRefineClient
) -> list[AudioSegment] | None:
    """Run ONE engine and return cleaned segments, or ``None`` if it can't be trusted.

    Builds the cleanup prompt, asks ``engine`` to fix ASR/punctuation/casing per turn,
    and validates that the reply structurally matches the input — same number of
    turns, in order, with unchanged speaker labels and a non-empty cleaned string for
    each. On a match, returns NEW segments carrying only the cleaned ``text`` (start,
    end, and speaker copied verbatim). On **any** problem — the engine raising
    (network/timeout/429), an unparseable or mismatched reply, an empty cleaned turn —
    it returns ``None`` so :func:`refine_segments` can advance to the next engine. This
    helper never raises.
    """
    try:
        raw = await engine.generate(_build_refine_prompt(segments))
        cleaned = _extract_json_array(raw)
        if cleaned is None or len(cleaned) != len(segments):
            return None
        refined: list[AudioSegment] = []
        for original, item in zip(segments, cleaned, strict=True):
            if not isinstance(item, dict):
                return None
            speaker = item.get("speaker")
            text = item.get("text")
            # Structural guard: the speaker label must be untouched and the cleaned
            # text a non-empty string. Any deviation -> distrust this engine's whole
            # reply (return None) so a rogue engine can never drop or corrupt a turn.
            if speaker != original.speaker or not isinstance(text, str) or not text.strip():
                return None
            refined.append(original.model_copy(update={"text": text}))
        return refined
    except Exception:
        # Never let a transcript-cleanup failure surface; the chain tries the next engine.
        return None


async def refine_segments(
    segments: list[AudioSegment], *, engines: list[TranscriptRefineClient]
) -> list[AudioSegment]:
    """Return ``segments`` with cleaned text, or the input unchanged if every engine fails.

    Tries each engine in ``engines`` in order (e.g. Gemini, then the quota-free Gemma
    fallback) and returns the FIRST structurally valid cleanup — same turn count and
    order, unchanged speaker labels, non-empty cleaned text per turn. An engine that
    throws or returns an invalid/mismatched reply is skipped and the next is tried. If
    every engine fails (or ``engines`` is empty / ``segments`` is empty), the INPUT
    segments are returned unchanged. This function **never raises**; the audio-ingest
    path relies on that to stay non-blocking.
    """
    if not segments or not engines:
        return segments
    try:
        for engine in engines:
            refined = await _refine_with_engine(segments, engine)
            if refined is not None:
                return refined
    except Exception:
        # _refine_with_engine already swallows engine errors; this is a final backstop
        # so refine_segments can never raise onto the ingest path.
        return segments
    return segments


def _gemma_configured(settings: Settings) -> bool:
    """True when a REAL Gemma endpoint is configured (base_url moved off the placeholder).

    The default ``gemma_base_url`` points at the API's own port and can't serve chats
    (see core/config.py), so we treat "someone set a real host" as the signal that the
    Gemma refine engine is usable. An API key is optional — the recap Gemma path allows
    tokenless endpoints too.
    """
    return bool(settings.gemma_base_url) and settings.gemma_base_url != _GEMMA_PLACEHOLDER_BASE_URL


def _build_gemma_refiner(settings: Settings) -> GemmaRefiner:
    """Wrap a short-timeout :class:`GemmaClient` as a Gemma refine engine."""
    return GemmaRefiner(
        GemmaClient(
            base_url=settings.gemma_base_url,
            api_key=settings.gemma_api_key,
            model=settings.gemma_model,
            timeout=_REFINE_TIMEOUT_SECONDS,
        )
    )


def get_transcript_refiner(
    settings: Settings | None = None,
) -> list[TranscriptRefineClient] | None:
    """Build the configured transcript-refine engine chain, or ``None`` when off.

    Returns ``None`` — meaning ingest keeps the raw transcript, making no LLM call —
    when ``transcript_refine`` is ``"none"`` (default) or nothing is configured. The
    ordered chain (first success wins, later engines are fallbacks) is:

    * ``"none"``   -> ``None``.
    * ``"gemini"`` -> ``[Gemini (if gemini_api_key), Gemma (if a real gemma host)]`` —
      Gemini preferred, Gemma the quota-free fallback. Neither configured -> ``None``.
    * ``"gemma"``  -> ``[Gemma (if a real gemma host)]`` — Gemma only. Not configured
      -> ``None``.
    """
    settings = settings or get_settings()
    mode = settings.transcript_refine
    if mode == "none":
        return None

    engines: list[TranscriptRefineClient] = []
    if mode == "gemini" and settings.gemini_api_key:
        engines.append(GeminiRefiner(api_key=settings.gemini_api_key, model=settings.gemini_model))
    # Gemma is the fallback for "gemini" and the sole engine for "gemma".
    if mode in ("gemini", "gemma") and _gemma_configured(settings):
        engines.append(_build_gemma_refiner(settings))

    return engines or None
