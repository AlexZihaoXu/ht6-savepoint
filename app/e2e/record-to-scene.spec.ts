import { expect, test } from "@playwright/test";

/**
 * Live demo 2: stop a recording and land straight in today's dialogue scene.
 * Chromium's fake media device (configured in playwright.config.ts, fed
 * pipeline/testcases/tc1_02min.wav) stands in for a real microphone, so
 * MediaRecorder produces real audio bytes through the actual RecordPage UI —
 * this exercises the real POST /ingest/audio/clip path end to end.
 */
test("stopping a recording navigates into today's dialogue scene", async ({
  page,
}) => {
  await page.goto("/record");

  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("button", { name: "Stop and save the recording" }),
  ).toBeVisible({
    timeout: 10_000,
  });

  // Let the fake mic capture a few seconds of audio.
  await page.waitForTimeout(4_000);

  await page
    .getByRole("button", { name: "Stop and save the recording" })
    .click();

  // saveClip() → POST /ingest/audio/clip → navigate("/scene/today?t=...").
  await page.waitForURL(/\/scene\/today/, { timeout: 20_000 });

  // The dialogue box renders once the day's events load — assert real text,
  // not just the route (a raw "Speaker N" placeholder is expected and fine;
  // DayScenePage already supports tap-to-name for it).
  const dialogue = page.getByRole("button", {
    name: "Dialogue — tap to continue",
  });
  await expect(dialogue).toBeVisible({ timeout: 10_000 });
  await expect(dialogue).not.toHaveText("");
});
