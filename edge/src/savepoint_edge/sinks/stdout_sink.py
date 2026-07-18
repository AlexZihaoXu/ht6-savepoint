"""Writes one JSON line per event to stdout. The default sink — zero setup,
good for `savepoint-edge | tee session.ndjson` during local testing."""

from __future__ import annotations

from savepoint_edge.event import try_serialize_edge_event
from savepoint_edge.types import EdgeEvent


class StdoutSink:
    def publish(self, event: EdgeEvent) -> bool:
        line = try_serialize_edge_event(event)
        if line is None:
            return False
        print(line, flush=True)
        return True
