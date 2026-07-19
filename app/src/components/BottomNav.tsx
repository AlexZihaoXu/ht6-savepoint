import { NavLink } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  PiChatCircleDots,
  PiPlant,
  PiSunHorizon,
  PiUsersThree,
} from "react-icons/pi";
import { Icon } from "./Icon";

interface Tab {
  to: string;
  label: string;
  icon: IconType;
  end?: boolean;
}

// Mobile-first bottom tab bar (shown on the classic-chrome screens, i.e.
// People). Every tab targets a REAL screen: the plaza home, the garden
// (page 2 of the plaza — a swipe, not a separate page), today's day scene,
// and the people list. The old scaffold pages are gone.
const tabs: Tab[] = [
  { to: "/plaza", label: "Today", icon: PiSunHorizon, end: true },
  { to: "/plaza?view=garden", label: "Garden", icon: PiPlant },
  { to: "/scene/today", label: "Story", icon: PiChatCircleDots },
  { to: "/people", label: "People", icon: PiUsersThree },
];

export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--separator)] bg-[color-mix(in_oklch,var(--background)_92%,transparent)] pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md"
    >
      <ul className="app-column flex items-stretch justify-around gap-1 py-1.5">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  "touch-target flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-[0.7rem] font-medium transition-colors",
                  isActive
                    ? "text-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={[
                      "text-xl leading-none transition-transform",
                      isActive ? "-translate-y-0.5" : "",
                    ].join(" ")}
                  >
                    <Icon icon={tab.icon} />
                  </span>
                  <span>{tab.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
