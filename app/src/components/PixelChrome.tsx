/**
 * Chrome for the immersive pixel screens (plaza / garden / day scene):
 * a wooden header with the bracketed Savepoint logotype (the logo doubles as
 * the "home" button — it links back to the plaza), plus a slim People bar for
 * the list screens. The old hamburger menu + [ Today ][ journal ] controls
 * were removed per design.
 */

import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { PiUserList } from "react-icons/pi";
import { Icon } from "./Icon";

export function PixelHeader() {
  return (
    <header className="wood-bar relative z-40 flex h-14 flex-none items-center px-3">
      <Link
        to="/plaza"
        aria-label="Savepoint — plaza"
        className="relative flex items-center justify-center px-2.5 py-2"
      >
        {/* corner brackets, per the mockup logotype — pinned to the box
            corners so the logotype sits dead-center between them */}
        <span
          aria-hidden
          className="absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#f7ecd7]"
        />
        <span
          aria-hidden
          className="absolute right-0 bottom-0 h-2.5 w-2.5 border-r-2 border-b-2 border-[#f7ecd7]"
        />
        {/* 1px optical lift — Press Start 2P carries its descender space
            below the baseline, which reads as sitting low in the frame */}
        <span className="font-pixel -translate-y-[1px] text-[15px] leading-none">
          Savepoint
        </span>
      </Link>
    </header>
  );
}

export function PixelBottomNav() {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="Primary"
      className="pixel-bar z-40 flex flex-none items-stretch justify-end gap-2 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        aria-label="People"
        className="pixel-btn touch-target flex w-14 items-center justify-center"
        onClick={() => navigate("/people")}
      >
        <Icon icon={PiUserList} size={22} />
      </button>
    </nav>
  );
}
