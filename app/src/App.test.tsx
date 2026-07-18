import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

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
});
