import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { AppShell } from "./components/AppShell";

describe("App shell", () => {
  it("lands on the plaza (the redesign is the default app)", async () => {
    render(<App />);

    // "/" redirects to /plaza — the immersive pixel chrome renders its
    // wooden header and the plaza panel. Pages are lazy-loaded (route
    // code-splitting), so await the Suspense boundary.
    expect(
      await screen.findByRole(
        "link",
        { name: /savepoint.*plaza/i },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText(
        /plaza — everyone you have met/i,
        undefined,
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it("navigates to the People list via the pixel bottom bar", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole(
        "button",
        { name: /^people$/i },
        { timeout: 3000 },
      ),
    );

    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: /people/i },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it.each(["/classic", "/garden", "/day/2026-07-18", "/nope"])(
    "redirects the retired scaffold route %s to the plaza",
    async (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
        </MemoryRouter>,
      );

      // The old pages are deleted — every stray path lands on the plaza's
      // immersive chrome via the wildcard redirect.
      expect(
        await screen.findByLabelText(
          /plaza — everyone you have met/i,
          undefined,
          { timeout: 3000 },
        ),
      ).toBeInTheDocument();
    },
  );
});
