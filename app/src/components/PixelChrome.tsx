/**
 * Chrome for the immersive pixel screens (plaza / garden / day scene):
 * a wooden header with the bracketed Savepoint logotype (decorative — NOT a
 * home button) + hamburger menu, and a real primary nav bar at the bottom
 * with three destinations — Home · People · Record.
 */

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  PiHouseFill,
  PiHouseLine,
  PiList,
  PiMicrophone,
  PiMoonStars,
  PiSun,
  PiUsersThree,
} from "react-icons/pi";
import { Icon } from "./Icon";
import { activeNav, type NavDest } from "@/lib/nav";
import { getCurrentTheme, toggleTheme, type ThemeMode } from "@/lib/theme";

export function PixelHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(() => getCurrentTheme());

  return (
    <header className="wood-bar relative z-40 flex h-[calc(3.5rem_+_var(--sat))] flex-none items-center justify-between px-3 pt-[var(--sat)]">
      {/* Decorative logotype — the corner-bracketed Savepoint mark. It no
          longer navigates (Home lives in the bottom nav now), so it's a plain
          non-interactive element. */}
      <span className="relative flex items-center justify-center px-2.5 py-2">
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
      </span>

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
            to="/voice-setup"
            className="flex items-center gap-2 px-3 py-2.5 font-medium"
            onClick={() => setMenuOpen(false)}
          >
            <Icon icon={PiMicrophone} />
            Set up your voice
          </Link>
        </div>
      )}
    </header>
  );
}

/** One primary-nav destination — icon over a short label. */
interface NavItem {
  dest: NavDest;
  to: string;
  label: string;
  icon: typeof PiHouseLine;
  iconActive: typeof PiHouseLine;
}

const NAV_ITEMS: NavItem[] = [
  {
    dest: "home",
    to: "/plaza",
    label: "Home",
    icon: PiHouseLine,
    iconActive: PiHouseFill,
  },
  {
    dest: "people",
    to: "/people",
    label: "People",
    icon: PiUsersThree,
    iconActive: PiUsersThree,
  },
  {
    dest: "record",
    to: "/record",
    label: "Record",
    icon: PiMicrophone,
    iconActive: PiMicrophone,
  },
];

export function PixelBottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = activeNav(pathname);

  return (
    <nav
      aria-label="Primary"
      className="pixel-bar z-40 flex flex-none items-stretch gap-1 px-2 pt-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom))]"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.dest;
        return (
          <button
            key={item.dest}
            type="button"
            aria-current={isActive ? "page" : undefined}
            className={`touch-target flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-colors ${
              isActive ? "text-[var(--accent)]" : "text-[var(--pixel-btn-fg)]"
            }`}
            onClick={() => navigate(item.to)}
          >
            <Icon icon={isActive ? item.iconActive : item.icon} size={22} />
            <span className="font-pixel text-[8px] leading-none">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
