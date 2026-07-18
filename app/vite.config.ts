/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// SavePoint PWA — Vite config.
// - React 19 + Tailwind v4 (CSS-first, no tailwind.config needed).
// - Dev/preview bind to 0.0.0.0 so the app is reachable over the tailnet /
//   a cloudflared tunnel and can double as a phone IO source.
// - PWA-ready: a static web app manifest + meta tags live in index.html /
//   public/. (Add vite-plugin-pwa + a service worker downstream if we want
//   offline caching + install prompts.)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
