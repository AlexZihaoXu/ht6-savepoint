// Inline rename (person profile page): stubs fetch the same way
// src/lib/record.test.ts does for the API layer, and renders the page
// through react-router + ToastProvider the way src/App.test.tsx renders
// whole screens — PersonPage calls useToast() on every render, so the
// provider has to be mounted above it even outside the full AppShell.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/Toast";
import { API_BASE, type ApiPersonDetail } from "@/lib/api";
import { PersonPage } from "./PersonPage";

const PERSON: ApiPersonDetail = {
  local_id: "demo-alex",
  name: "Alex",
  avatar_params: {
    skin_tone: "fair",
    hair_color: "brown",
    hair_style: "short",
    glasses: false,
    hat: null,
    shirt_color: "blue",
  },
  tags: [],
  favorite: false,
  first_seen: null,
  last_seen: null,
  notes: null,
  bio: null,
  sprite: null,
  events: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderPersonPage() {
  return render(
    <MemoryRouter initialEntries={[`/people/${PERSON.local_id}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/people/:id" element={<PersonPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("PersonPage — rename", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves a new name via PATCH /people/{id} and shows it", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") return jsonResponse(PERSON);
        if (method === "PATCH")
          return jsonResponse({ ...PERSON, name: "Jordan" });
        throw new Error(`unexpected ${method} ${String(input)}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPersonPage();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Alex",
    );

    await user.click(screen.getByRole("button", { name: /rename/i }));

    const input = screen.getByRole("textbox", { name: /name/i });
    expect(input).toHaveValue("Alex");
    await user.clear(input);
    await user.type(input, "Jordan");
    await user.click(screen.getByRole("button", { name: /save name/i }));

    // the input is gone (edit mode exited) and the heading shows the saved name
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Jordan",
    );
    expect(
      screen.queryByRole("textbox", { name: /name/i }),
    ).not.toBeInTheDocument();

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    const [url, init] = patchCall!;
    expect(String(url)).toBe(`${API_BASE}/people/${PERSON.local_id}`);
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init!.body as string)).toEqual({ name: "Jordan" });
  });

  it("on a failed save, toasts an error, stays editable, and never adopts the failed name", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") return jsonResponse(PERSON);
        if (method === "PATCH") return new Response("nope", { status: 500 });
        throw new Error(`unexpected ${method} ${String(input)}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderPersonPage();

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Alex",
    );

    await user.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /name/i });
    await user.clear(input);
    await user.type(input, "Jordan");
    await user.click(screen.getByRole("button", { name: /save name/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn.t rename/i,
    );

    // still in edit mode (draft intact, controls re-enabled) so the user can retry
    const retryInput = screen.getByRole("textbox", { name: /name/i });
    expect(retryInput).toHaveValue("Jordan");
    expect(retryInput).toBeEnabled();
    expect(screen.getByRole("button", { name: /save name/i })).toBeEnabled();

    // the failed PATCH never got adopted — cancelling reveals the old name
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Alex");
  });
});
