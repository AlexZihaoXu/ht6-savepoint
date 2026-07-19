/**
 * Floating "record a moment" mic FAB. It used to record inline (SAV-40);
 * the dedicated /record screen — live separated-speech preview + save — now
 * owns capture, so this button just takes you there. Same footprint as the
 * whistle button in the floating-controls stack.
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
      className="pixel-btn flex h-12 w-14 items-center justify-center"
      onClick={(e) => {
        // Stray taps shouldn't also close plaza speech bubbles behind the FAB.
        e.stopPropagation();
        navigate("/record");
      }}
    >
      <Icon icon={PiMicrophone} size={26} />
    </button>
  );
}
