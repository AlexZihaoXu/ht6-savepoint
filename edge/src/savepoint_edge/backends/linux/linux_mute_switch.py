"""Real GPIO mute button + LED via gpiozero.

Pi 5 changed its GPIO chip (the new "RP1" southbridge), which broke the
classic RPi.GPIO library outright — it accesses processor registers
directly via /dev/mem, and on the Pi 5 those registers live on RP1, not the
SoC. gpiozero auto-selects a working backend (lgpio on Pi 5) and is the
current officially-recommended library, so it's what this is built against.

UNVERIFIED — never run against real hardware in this scaffold. Confidence
is fairly high (gpiozero's Button/LED API is small, stable, and
well-documented), but pin numbers below are guesses — confirm against your
actual wiring. gpiozero itself will raise a clear error at construction if
the pins/backend aren't accessible (e.g. wrong permissions, no pin factory
available), which is a reasonable fail-fast in place of forcing one here.

Toggle-on-press: one press mutes, the next unmutes. DESIGN.md doesn't
specify press-vs-hold semantics — change _toggle's wiring if a different
UX is wanted.
"""

from __future__ import annotations

try:
    from gpiozero import LED, Button
except ImportError as exc:  # pragma: no cover - exercised only on real hardware
    raise ImportError(
        "gpiozero is not importable. It ships via apt, not pip — see "
        "edge/README.md's 'Setup on the Pi' for the "
        "`apt install python3-gpiozero` + `uv venv --system-site-packages` steps."
    ) from exc

_DEFAULT_BUTTON_PIN = 17
_DEFAULT_LED_PIN = 27


class LinuxMuteSwitch:
    def __init__(
        self, button_pin: int = _DEFAULT_BUTTON_PIN, led_pin: int = _DEFAULT_LED_PIN
    ) -> None:
        self._muted = False
        self._led = LED(led_pin)
        try:
            self._button = Button(button_pin, pull_up=True, bounce_time=0.05)
        except Exception:
            # If the LED pin was already claimed above but the button pin
            # then fails (bad wiring, pin in use, etc.), release the LED
            # rather than leaking it — the caller only ever sees this
            # constructor either fully succeed or fully clean up.
            self._led.close()
            raise
        self._button.when_pressed = self._toggle

    def _toggle(self) -> None:
        self._muted = not self._muted

    def is_muted(self) -> bool:
        return self._muted

    def set_recording_led(self, on: bool) -> None:
        if on:
            self._led.on()
        else:
            self._led.off()

    def close(self) -> None:
        self._button.close()
        self._led.close()
