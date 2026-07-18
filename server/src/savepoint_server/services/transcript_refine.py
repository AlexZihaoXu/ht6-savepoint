"""Optional, non-blocking transcript cleanup on the audio-ingest path (SAV-56).

The decoupled audio stream lands raw diarized turns (``Speaker N: text``) exactly
as the ASR produced them. This module offers an **opt-in** pass that asks Google's
Gemini to fix obvious speech-recognition errors, punctuation, and casing in each
turn's *text only* — never touching the speaker labels, the number of turns, the
order, or the timing.

The overriding rule (jiucheng's spec): this must **never block or 500 ingest**.
Everything here is best-effort and fully guarded — :func:`refine_segments` wraps the
whole prompt → call → parse → validate flow in a broad ``try``/``except`` and, on
*any* failure (network error, timeout, non-200, malformed reply, or an output that
doesn't structurally match the input), returns the **input segments unchanged**. It
never raises. When ``transcript_refine`` is ``"none"`` (the default) or no Gemini
key is configured, :func:`get_transcript_refiner` returns ``None`` and ingest is
byte-identical to today — no Gemini call is ever made.

Unlike the recap LLM clients (``services/llm.py``), Gemini is **not**
OpenAI-compatible: it POSTs to ``…/models/{model}:generateContent`` with an
``x-goog-api-key`` header and a ``{"contents": [{"parts": [{"text": …}]}]}`` body,
and the reply is read from ``candidates[0].content.parts[0].text``.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Protocol

import httpx

from savepoint_server.core.config import Settings, get_settings

if TYPE_CHECKING:
    # Only needed for annotations; imported under TYPE_CHECKING so this module never
    # imports services.ingest at runtime (which imports us) — no circular import.
    from savepoint_server.services.ingest import AudioSegment

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

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


class TranscriptRefineClient(Protocol):
    """A minimal text-in / text-out client used to clean a transcript.

    The refiner service depends only on this protocol, never on a concrete client,
    so tests inject a fake and no network is touched in CI.
    """

    async def generate(self, prompt: str) -> str:
        """Return the model's raw text reply for ``prompt`` (may raise on failure)."""
        ...


class GeminiRefiner:
    """:class:`TranscriptRefineClient` for Google's Gemini ``generateContent`` REST API.

    POSTs to ``{base}/{model}:generateContent`` with an ``x-goog-api-key`` header and
    a ``{"contents": [{"parts": [{"text": prompt}]}]}`` body, reading the reply from
    ``candidates[0].content.parts[0].text``. A short timeout keeps a slow Gemini from
    ever stalling ingest; any non-200 raises (caught upstream by :func:`refine_segments`).
    Low temperature keeps the cleanup faithful rather than creative, and a JSON
    response mime-type nudges the model toward a clean, parseable array.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gemini-2.0-flash",
        timeout: float = 8.0,
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


async def refine_segments(
    segments: list[AudioSegment], *, client: TranscriptRefineClient
) -> list[AudioSegment]:
    """Return ``segments`` with cleaned text, or the input unchanged on any problem.

    Builds a cleanup prompt, asks ``client`` to fix ASR/punctuation/casing per turn,
    and validates that the reply structurally matches the input — same number of
    turns, in order, with unchanged speaker labels and a non-empty cleaned string for
    each. On a match, returns NEW segments carrying only the cleaned ``text`` (start,
    end, and speaker are copied verbatim). On **any** failure — network/timeout/non-200
    error, unparseable or mismatched reply, an empty cleaned turn — it returns the
    INPUT segments unchanged. This function never raises; the audio-ingest path relies
    on that to stay non-blocking.
    """
    if not segments:
        return segments
    try:
        raw = await client.generate(_build_refine_prompt(segments))
        cleaned = _extract_json_array(raw)
        if cleaned is None or len(cleaned) != len(segments):
            return segments
        refined: list[AudioSegment] = []
        for original, item in zip(segments, cleaned, strict=True):
            if not isinstance(item, dict):
                return segments
            speaker = item.get("speaker")
            text = item.get("text")
            # Structural guard: the speaker label must be untouched and the cleaned
            # text a non-empty string. Any deviation -> fall back to the raw batch so
            # a rogue reply can never drop or corrupt a turn.
            if speaker != original.speaker or not isinstance(text, str) or not text.strip():
                return segments
            refined.append(original.model_copy(update={"text": text}))
        return refined
    except Exception:
        # Never let a transcript-cleanup failure surface on the ingest path.
        return segments


def get_transcript_refiner(settings: Settings | None = None) -> TranscriptRefineClient | None:
    """Build the configured transcript refiner, or ``None`` when refinement is off.

    Returns ``None`` — meaning ingest keeps the raw transcript, making no Gemini call —
    when ``transcript_refine`` is ``"none"`` (default) or no ``gemini_api_key`` is
    configured. Only ``"gemini"`` with a key present yields a :class:`GeminiRefiner`.
    """
    settings = settings or get_settings()
    if settings.transcript_refine == "gemini" and settings.gemini_api_key:
        return GeminiRefiner(api_key=settings.gemini_api_key, model=settings.gemini_model)
    return None
