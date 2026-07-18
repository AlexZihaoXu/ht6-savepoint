"""POSTs each event's JSON to an HTTP endpoint.

There is no `/events` (or similar) ingest route on server/ yet (only
`/health` exists as of this writing) — this sink is ready for whenever one
lands. Point `endpoint` at it then.

Every call is bounded by `timeout=`, and every failure mode is caught and
turned into a `return False`, never a propagated exception or an indefinite
block — a sink hiccup must never crash or freeze the capture loop, since
this runs synchronously in the same loop that polls the mute switch.
"""

from __future__ import annotations

import urllib.error
import urllib.request

from savepoint_edge.event import try_serialize_edge_event
from savepoint_edge.types import EdgeEvent

_DEFAULT_TIMEOUT_S = 3.0


class HttpSink:
    """Note: `timeout_s` bounds the connect/send/recv phase once a socket
    exists, but NOT the DNS lookup `urlopen` performs first — a hung
    resolver can block well past `timeout_s` for a hostname endpoint.
    Point this at an IP literal (this repo's existing convention for
    reaching dev services, e.g. a tailnet IP — see docs/DEV.md) to keep the
    bound meaningful; there's no cheap fix for hostname endpoints here.
    """

    def __init__(self, endpoint: str, timeout_s: float = _DEFAULT_TIMEOUT_S) -> None:
        self._endpoint = endpoint
        self._timeout_s = timeout_s

    def publish(self, event: EdgeEvent) -> bool:
        # Everything — including serialization — lives inside this try
        # block on purpose: a ValueError from a non-finite float (see
        # event.py) must fail this one publish() call, not escape and crash
        # the capture loop, same as any network failure below.
        try:
            line = try_serialize_edge_event(event)
            if line is None:
                return False
            request = urllib.request.Request(
                self._endpoint,
                data=line.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
                return 200 <= response.status < 300
        except (urllib.error.URLError, OSError, TimeoutError, ValueError):
            # Broad on purpose: a sink failure must never crash or block the
            # capture loop. urlopen() raises URLError/HTTPError (a URLError
            # subclass) for connection and non-2xx-via-error-status cases,
            # plain OSError for lower-level socket failures, and
            # TimeoutError on the `timeout=` bound above — main.py just
            # logs a failed publish() and moves on.
            return False
