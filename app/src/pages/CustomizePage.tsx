/**
 * Character customizer (diamondpixals) — pick a head, a body and legs from
 * the modular parts sheet and watch the assembled character live. Saving
 * makes it the wearer's own "You" avatar: the day-view stage renders it in
 * place of the parametric stand-in (localStorage `savepoint.avatar`).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PiArrowCounterClockwise,
  PiCaretLeft,
  PiCaretRight,
  PiCheckBold,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelHeader } from "@/components/PixelChrome";
import { CustomAvatar, PartThumb } from "@/lib/custom-avatar";
import {
  clearAvatar,
  DEFAULT_PARTS,
  loadAvatar,
  PART_COUNTS,
  saveAvatar,
  SLOTS,
  stepPart,
  type CharacterParts,
  type Slot,
} from "@/lib/customizer";

const SLOT_LABELS: Record<Slot, string> = {
  head: "Head",
  body: "Body",
  legs: "Legs",
};

export function CustomizePage() {
  const navigate = useNavigate();
  const [parts, setParts] = useState<CharacterParts>(
    () => loadAvatar() ?? DEFAULT_PARTS,
  );

  const save = () => {
    saveAvatar(parts);
    // Back to wherever the customizer was opened; /people if cold-opened.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/people");
  };

  const reset = () => {
    clearAvatar();
    setParts(DEFAULT_PARTS);
  };

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <PixelHeader />

      {/* sub-header: what this screen is + where the character shows up */}
      <div className="flex-none border-b-2 border-[var(--pixel-bar-border)] bg-[var(--pixel-bar-bg)] px-4 py-2">
        <h1 id="customize-heading" className="font-pixel text-[13px]">
          Your character
        </h1>
        <p className="mt-1 truncate text-xs text-[var(--muted)]">
          Pick a head, body and legs — this is you in your day scenes.
        </p>
      </div>

      {/* live preview + per-slot steppers, always visible while picking */}
      <div className="pixel-panel mx-3 mt-3 flex-none">
        <div className="flex items-center justify-center gap-6 px-2 py-1">
          <div className="flex flex-col items-center">
            <CustomAvatar parts={parts} scale={3} />
            <span className="pixel-name font-pixel mt-1 text-[8px]">[You]</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {SLOTS.map((slot) => (
              <SlotStepper
                key={slot}
                slot={slot}
                index={parts[slot]}
                onStep={(d) => setParts((p) => stepPart(p, slot, d))}
              />
            ))}
          </div>
        </div>
      </div>

      {/* part grids — the actual atlas art as tap-to-pick thumbnails */}
      <section
        aria-labelledby="customize-heading"
        className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3"
      >
        {SLOTS.map((slot) => (
          <div key={slot}>
            <h2 className="font-pixel sticky top-0 z-10 -mx-3 border-y border-[var(--separator)] bg-[var(--surface-secondary)] px-4 py-1.5 text-[9px] text-[var(--muted)]">
              {SLOT_LABELS[slot].toUpperCase()}
            </h2>
            <div className="grid grid-cols-4 justify-items-center gap-2 py-2">
              {Array.from({ length: PART_COUNTS[slot] }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${SLOT_LABELS[slot]} ${i + 1}`}
                  aria-pressed={parts[slot] === i}
                  onClick={() => setParts((p) => ({ ...p, [slot]: i }))}
                  className={`relative flex w-full items-center justify-center border-2 py-1 transition-colors ${
                    parts[slot] === i
                      ? "border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent)_14%,transparent)]"
                      : "border-[var(--separator)] active:bg-[var(--surface-tertiary)]"
                  }`}
                >
                  <PartThumb slot={slot} index={i} scale={3} />
                  {parts[slot] === i && (
                    <span
                      aria-hidden
                      className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center bg-[var(--accent)] text-white"
                    >
                      <Icon icon={PiCheckBold} size={11} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* save bar */}
      <div className="pixel-bar z-40 flex flex-none items-stretch gap-2 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          className="pixel-btn pixel-btn-primary touch-target flex-1 px-4 py-2.5"
          onClick={save}
        >
          <span className="font-pixel text-[12px]">Save character</span>
        </button>
        <button
          type="button"
          aria-label="Reset to the default character"
          className="pixel-btn touch-target flex w-14 items-center justify-center"
          onClick={reset}
        >
          <Icon icon={PiArrowCounterClockwise} size={20} />
        </button>
      </div>
    </div>
  );
}

/** ‹ n/count › stepper for one slot — wraps at the ends. */
function SlotStepper({
  slot,
  index,
  onStep,
}: {
  slot: Slot;
  index: number;
  onStep: (delta: number) => void;
}) {
  return (
    <div>
      <p className="font-pixel text-[8px] opacity-70">
        {SLOT_LABELS[slot].toUpperCase()}
      </p>
      <div className="mt-0.5 flex items-center gap-1">
        <button
          type="button"
          aria-label={`Previous ${SLOT_LABELS[slot].toLowerCase()}`}
          className="pixel-btn flex h-8 w-8 items-center justify-center"
          onClick={() => onStep(-1)}
        >
          <Icon icon={PiCaretLeft} size={14} />
        </button>
        <span className="font-pixel w-11 text-center text-[9px]">
          {index + 1}/{PART_COUNTS[slot]}
        </span>
        <button
          type="button"
          aria-label={`Next ${SLOT_LABELS[slot].toLowerCase()}`}
          className="pixel-btn flex h-8 w-8 items-center justify-center"
          onClick={() => onStep(1)}
        >
          <Icon icon={PiCaretRight} size={14} />
        </button>
      </div>
    </div>
  );
}
