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
        className="relative px-2 py-1"
      >
        {/* corner brackets, per the mockup logotype */}
        <span
          aria-hidden
          className="absolute -top-0.5 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[#fff6e6]"
        />
        <span
          aria-hidden
          className="absolute right-0 -bottom-0.5 h-2.5 w-2.5 border-r-2 border-b-2 border-[#fff6e6]"
        />
        <span className="font-pixel text-[15px] leading-none">Savepoint</span>
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
            to="/"
            className="px-3 py-2.5 font-medium"
            onClick={() => setMenuOpen(false)}
          >
            Classic view
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
        className="pixel-btn touch-target flex-1 px-4 py-2.5"
        onClick={() => navigate("/scene/today")}
      >
        <span className="font-pixel text-[13px]">Today</span>
      </button>
      <button
        type="button"
        aria-label="Journal"
        className="pixel-btn touch-target flex w-14 items-center justify-center"
        onClick={() => navigate("/")}
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
