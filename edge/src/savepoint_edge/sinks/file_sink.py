"""Appends one JSON line per event to a file (newline-delimited JSON).
Useful for capturing a session to replay into the server later, or for
tests/scripts that want to inspect what a run produced."""

from __future__ import annotations

from savepoint_edge.event import try_serialize_edge_event
from savepoint_edge.types import EdgeEvent


class FileSink:
    def __init__(self, path: str) -> None:
        self._path = path

    def publish(self, event: EdgeEvent) -> bool:
        line = try_serialize_edge_event(event)
        if line is None:
            return False
        try:
            with open(self._path, "a") as f:
                f.write(line)
                f.write("\n")
            return True
        except OSError:
            return False
