"""Recap generation service (placeholder).

Will call the Gemma / Gemini / Backboard backends (DESIGN §11) to turn a day's
events into a narrative ``Recap``. Not yet implemented — scaffolding only.
"""

from __future__ import annotations

from datetime import date

from savepoint_server.models import Recap, RecapScope


async def generate_recap(day: date, scope: RecapScope = RecapScope.DAY) -> Recap:
    """Generate a narrative recap for the given day/scope.

    Placeholder: raises until the LLM backends are wired in.
    """
    raise NotImplementedError("recap generation is not implemented yet")
