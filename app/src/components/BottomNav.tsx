import { NavLink } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  PiChatCircleDots,
  PiPlant,
  PiSunHorizon,
  PiUsersThree,
} from "react-icons/pi";
import { Icon } from "./Icon";
import { TODAY_ISO } from "@/lib/seed";

interface Tab {
  to: string;
  label: string;
  icon: IconType;
  end?: boolean;
}

// Mobile-first bottom tab bar. The Person and Day-view screens are reached from
// within People / Garden / Today, so the bar stays to four primary destinations.
const tabs: Tab[] = [
  { to: "/", label: "Today", icon: PiSunHorizon, end: true },
  { to: "/garden", label: "Garden", icon: PiPlant },
  { to: `/day/${TODAY_ISO}`, label: "Story", icon: PiChatCircleDots },
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
