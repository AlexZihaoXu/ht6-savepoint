"""No real GPIO in sim mode: mute state is driven by whether a marker file
exists, so the mute switch is testable from a shell without hardware:

    touch  $SAVEPOINT_EDGE_SIM_MUTE_FILE   # mute
    rm     $SAVEPOINT_EDGE_SIM_MUTE_FILE   # unmute

Defaults to <cwd>/.sim_mute if the env var isn't set. The "LED" is just a
stderr line — see set_recording_led."""

from __future__ import annotations

import os
import sys


class SimMuteSwitch:
    def __init__(self) -> None:
        self._marker_path = os.environ.get("SAVEPOINT_EDGE_SIM_MUTE_FILE", ".sim_mute")
        self._led_on = False

    def is_muted(self) -> bool:
        return os.path.exists(self._marker_path)

    def set_recording_led(self, on: bool) -> None:
        if on == self._led_on:
            return
        self._led_on = on
        print(f"[sim] recording LED: {'ON' if on else 'off'}", file=sys.stderr)
