// GET /voice/status render states: stubs fetch the same way PersonPage.test.tsx
// does for the API layer, and renders the page through react-router +
// ToastProvider (VoiceSetupPage calls useToast() on every render). The actual
// record/stop/upload flow is real-browser/manual territory (MediaRecorder is
// absent in jsdom) — see this page's own docstring — so only the status card
// is covered here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/Toast";
import type { VoiceStatus } from "@/lib/api";
import { VoiceSetupPage } from "./VoiceSetupPage";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderVoiceSetupPage() {
  return render(
    <MemoryRouter initialEntries={["/voice-setup"]}>
      <ToastProvider>
        <Routes>
          <Route path="/voice-setup" element={<VoiceSetupPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("VoiceSetupPage — status", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the not-enrolled state from GET /voice/status", async () => {
    const status: VoiceStatus = { enrolled: false, enrolled_at: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(status)),
    );

    renderVoiceSetupPage();

    expect(await screen.findByText(/not set up yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^record your voice$/i }),
    ).toBeInTheDocument();
  });

  it("shows the enrolled state from GET /voice/status", async () => {
    const status: VoiceStatus = {
      enrolled: true,
      enrolled_at: "2026-07-18T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(status)),
    );

    renderVoiceSetupPage();

    expect(
      await screen.findByText(/your voice is set up/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-record your voice/i }),
    ).toBeInTheDocument();
  });
});
