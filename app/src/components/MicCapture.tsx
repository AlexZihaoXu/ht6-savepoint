/**
 * Floating "record a moment" FAB — the app's primary action, so it's the
 * biggest, most prominent control in the plaza. It used to record inline
 * (SAV-40); the dedicated /record screen — live separated-speech preview +
 * save — now owns capture, so this button just takes you there. A microphone
 * glyph, since this starts an audio recording, not a photo/video capture.
 */

import { useNavigate } from "react-router-dom";
import { PiMicrophone } from "react-icons/pi";
import { Icon } from "./Icon";

export function MicCapture() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      aria-label="Record a moment"
      className="pixel-btn pixel-btn-primary flex h-16 w-16 items-center justify-center"
      onClick={(e) => {
        // Stray taps shouldn't also close plaza speech bubbles behind the FAB.
        e.stopPropagation();
        navigate("/record");
      }}
    >
      <Icon icon={PiMicrophone} size={32} />
    </button>
  );
}
