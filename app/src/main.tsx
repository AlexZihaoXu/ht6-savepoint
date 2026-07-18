import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted DM Sans (via @fontsource) — never hotlinked from Google Fonts.
// theme.css maps `--font-sans` to the "DM Sans" family defined in globals.css.
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";

// Global styles: tailwind -> heroui -> theme -> base (order matters, see file).
import "./styles/globals.css";

import { App } from "./App";
import { initTheme } from "./lib/theme";

// Apply saved / system light|dark preference before first paint.
initTheme();

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
