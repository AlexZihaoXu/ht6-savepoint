"""EdgeEvent -> wire JSON.

Uses stdlib json + dataclasses.asdict — no hand-rolled writer needed; the
fixed, small event shape doesn't warrant a third-party JSON library.
"""

from __future__ import annotations

import json
from dataclasses import asdict

from savepoint_edge.types import EdgeEvent


def serialize_edge_event(event: EdgeEvent) -> str:
    """Serializes to the wire JSON documented in types.py's EdgeEvent
    docstring and README.md. `allow_nan=False` makes a non-finite float
    anywhere in the payload (e.g. a NaN embedding component from a
    misbehaving model) raise ValueError here — caught by the caller's sink
    — instead of silently emitting the non-standard `NaN`/`Infinity` tokens
    Python's json module allows by default, which downstream JSON parsers
    (including the server's) would reject or mishandle.
    """
    return json.dumps(asdict(event), allow_nan=False, separators=(",", ":"))


def try_serialize_edge_event(event: EdgeEvent) -> str | None:
    """Like serialize_edge_event, but returns None instead of raising when
    the event contains a non-finite float. Every EventSink implementation
    must use this (not serialize_edge_event directly) so a bad payload
    fails that one publish() call — returning False — instead of raising
    out of the sink and crashing the capture loop (see hal.py's EventSink
    contract).
    """
    try:
        return serialize_edge_event(event)
    except ValueError:
        return None
