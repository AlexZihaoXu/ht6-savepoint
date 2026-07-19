import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Local-only browser e2e for the two live demos (camera → plaza, record →
 * dialogue scene). NOT run in CI — these need a real running backend (real
 * Mongo, real /ingest endpoints) plus fake-media Chromium flags, none of
 * which belong in ci-frontend.yml. Run by hand: `pnpm test:e2e`.
 *
 * Assumes the real backend is already up (see docs/DEPLOY.md §1) at
 * PLAYWRIGHT_API_BASE (default http://127.0.0.1:8000) — this config only
 * manages the frontend dev server, matching `VITE_API_BASE` to it.
 */
const API_BASE = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8000";
// 5173 is already held by a long-running pre-existing dev server on this
// machine (left untouched) — this test run's own instance lands on 5174.
const APP_PORT = 5174;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  // Default 30s is too short once SAVEPOINT_TRANSCRIBER=real: each
  // transcription is a fresh subprocess reloading pyannote/whisper from
  // disk, so record-to-scene.spec.ts can genuinely take well over a minute.
  timeout: 180_000,
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${path.resolve(
              fileURLToPath(new URL(".", import.meta.url)),
              "../pipeline/testcases/tc1_02min.wav",
            )}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${APP_PORT}`,
    url: `http://127.0.0.1:${APP_PORT}`,
    reuseExistingServer: true,
    env: { VITE_API_BASE: API_BASE },
    timeout: 30_000,
  },
});
