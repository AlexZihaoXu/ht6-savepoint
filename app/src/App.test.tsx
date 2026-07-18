import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

describe("App shell", () => {
  it("renders the SavePoint shell on the Today screen", () => {
    render(<App />);

    expect(
      screen.getByRole("link", { name: /savepoint.*home/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /today/i }),
    ).toBeInTheDocument();
  });

  it("navigates to the Garden screen via the bottom nav", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("link", { name: /^garden$/i }));

    expect(
      await screen.findByRole(
        "heading",
        { level: 1, name: /garden/i },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });
});
