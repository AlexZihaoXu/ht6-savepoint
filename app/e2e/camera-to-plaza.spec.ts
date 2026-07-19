import { expect, test } from "@playwright/test";

/**
 * Live demo 1: a Pi camera detection lands a new Person in Mongo via
 * `POST /ingest/video` — the plaza (already open, no reload) must pick it up
 * via its polling refetch (PlazaPage.tsx) and render it without disturbing
 * anyone already wandering the plot.
 */
test("a new person detected by the camera appears in an already-open plaza", async ({
  page,
  request,
}) => {
  const apiBase = process.env.PLAYWRIGHT_API_BASE ?? "http://127.0.0.1:8000";

  await page.goto("/plaza");
  const plot = page.getByRole("region", { name: /plaza/i }).first();
  // Wait for the initial GET /people to settle (the "Loading your world…"
  // placeholder disappears either way — empty plaza or a populated one).
  await expect(plot.getByText(/loading your world/i)).toBeHidden({
    timeout: 10_000,
  });

  // Identity-based, not count-based: this Atlas database has other live
  // writers (this looks like a shared demo backend, not an isolated test
  // DB), so the total headcount can shift for reasons unrelated to this
  // test. Instead, inject one person with a recognizable local_id and assert
  // THAT specific arrival renders — matches displayName()'s fallback
  // ("Neighbor " + first 3 hex chars of local_id, uppercased), which for any
  // local_id starting with "e2e" always resolves to "Neighbor E2E".
  const localId = `e2e-camera-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const res = await request.post(`${apiBase}/ingest/video`, {
    data: [
      {
        ts_unix_ms: Date.now(),
        local_id: localId,
        type: "seen",
        avatar_params: {
          skin_tone: "tan",
          hair_color: "brown",
          hair_style: "short",
          glasses: false,
          hat: null,
          shirt_color: "blue",
        },
        face_embedding: null,
        place: "e2e",
      },
    ],
  });
  expect(
    res.ok(),
    `POST /ingest/video failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);

  // The plaza polls every 4s (PlazaPage.tsx) — give it a couple of cycles.
  await expect(
    plot.getByRole("button", { name: "Neighbor E2E" }).first(),
  ).toBeVisible({ timeout: 15_000 });
});
