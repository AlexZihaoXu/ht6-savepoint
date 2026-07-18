import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@heroui/react";
import { getCurrentTheme, toggleTheme, type ThemeMode } from "@/lib/theme";

/** Sticky top bar: logo + name on the left, theme toggle + settings right. */
export function TopBar() {
  const [mode, setMode] = useState<ThemeMode>(() => getCurrentTheme());

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--separator)] bg-[color-mix(in_oklch,var(--background)_84%,transparent)] backdrop-blur-md">
      <div className="app-column flex h-14 items-center justify-between gap-2">
        <Link
          to="/"
          aria-label="SavePoint — home"
          className="touch-target flex items-center gap-2"
        >
          <img
            src="/icon.svg"
            alt=""
            width={26}
            height={26}
            className="pixelated"
          />
          <span className="text-lg font-semibold tracking-tight">
            SavePoint
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <Button
            variant="tertiary"
            aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}
            onPress={() => setMode(toggleTheme())}
          >
            <span aria-hidden>{mode === "dark" ? "🌙" : "☀️"}</span>
          </Button>
          <Button variant="tertiary" aria-label="Settings">
            <span aria-hidden>⚙️</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
