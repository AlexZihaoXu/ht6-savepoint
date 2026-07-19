import { useEffect } from "react";

// Shared, ref-counted body scroll-lock. Multiple overlays can be open at once
// (e.g. the People pop-up with a Person profile stacked on top, or a
// /people/:id deep-link that mounts both in the same commit). If each managed
// `body.style.overflow` independently they'd race — a nested modal captures the
// already-"hidden" value as the "original" and leaves scroll stuck locked after
// close. A single counter fixes that: capture the real original when the first
// lock engages, and only restore it once the last lock releases.
let lockCount = 0;
let savedOverflow = "";

/** Lock `document.body` scroll while the calling component is mounted. */
export function useBodyScrollLock(): void {
  useEffect(() => {
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
      }
    };
  }, []);
}
