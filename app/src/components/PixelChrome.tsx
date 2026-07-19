/**
 * Chrome for the immersive pixel screens (plaza / garden / day scene):
 * a wooden header with the bracketed Savepoint logotype + hamburger menu,
 * and the mockup's bottom bar — [ Today ] [ journal ] [ people ].
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PiList,
  PiMoonStars,
  PiNotePencil,
  PiSun,
  PiUserList,
} from "react-icons/pi";
import { Icon } from "./Icon";
import { getCurrentTheme, toggleTheme, type ThemeMode } from "@/lib/theme";

export function PixelHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(() => getCurrentTheme());

  return (
    <header className="wood-bar relative z-40 flex h-14 flex-none items-center justify-between px-3">
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

      <button
        type="button"
        aria-label="Menu"
        aria-expanded={menuOpen}
        className="touch-target flex items-center justify-center px-1"
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Icon icon={PiList} size={26} />
      </button>

      {menuOpen && (
        <div className="pixel-bubble absolute top-full right-2 z-50 mt-1 flex w-44 flex-col p-1 text-sm">
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-2.5 text-left font-medium"
            onClick={() => setMode(toggleTheme())}
          >
            <Icon icon={mode === "dark" ? PiSun : PiMoonStars} />
            {mode === "dark" ? "Day time" : "Night time"}
          </button>
          <Link
            to="/people"
            className="px-3 py-2.5 font-medium"
            onClick={() => setMenuOpen(false)}
          >
            People list
          </Link>
          <Link
            to="/customize"
            className="px-3 py-2.5 font-medium"
            onClick={() => setMenuOpen(false)}
          >
            Your character
          </Link>
        </div>
      )}
    </header>
  );
}

export function PixelBottomNav() {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="Primary"
      className="pixel-bar z-40 flex flex-none items-stretch gap-2 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        className="pixel-btn pixel-btn-primary touch-target flex-1 px-4 py-2.5"
        onClick={() => navigate("/scene/today")}
      >
        <span className="font-pixel text-[13px]">Today</span>
      </button>
      <button
        type="button"
        aria-label="Journal — the garden of days"
        className="pixel-btn touch-target flex w-14 items-center justify-center"
        onClick={() => navigate("/plaza?view=garden")}
      >
        <Icon icon={PiNotePencil} size={22} />
      </button>
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
