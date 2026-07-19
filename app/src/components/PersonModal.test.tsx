// Inline rename (person profile pop-up): stubs fetch the way the API-layer
// tests do, and renders the modal under react-router + ToastProvider —
// PersonModal calls useToast() on every render and renders react-router
// <Link>s for its recent-interaction rows.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/Toast";
import { API_BASE, type ApiPersonDetail } from "@/lib/api";
import { PersonModal } from "./PersonModal";

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

function renderModal(onClose = vi.fn(), onRenamed = vi.fn()) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PersonModal
          localId={PERSON.local_id}
          onClose={onClose}
          onRenamed={onRenamed}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("PersonModal — rename", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves a new name via PATCH /people/{id}, shows it, and reports it up", async () => {
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
    const onRenamed = vi.fn();
    const user = userEvent.setup();

    renderModal(vi.fn(), onRenamed);

    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent(
      "Alex",
    );

    await user.click(screen.getByRole("button", { name: /rename/i }));

    const input = screen.getByRole("textbox", { name: /name/i });
    expect(input).toHaveValue("Alex");
    await user.clear(input);
    await user.type(input, "Jordan");
    await user.click(screen.getByRole("button", { name: /save name/i }));

    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent(
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
    expect(onRenamed).toHaveBeenCalledWith(PERSON.local_id, "Jordan");
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

    renderModal();

    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent(
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

    const retryInput = screen.getByRole("textbox", { name: /name/i });
    expect(retryInput).toHaveValue("Jordan");
    expect(retryInput).toBeEnabled();
    expect(screen.getByRole("button", { name: /save name/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Alex");
  });
});

describe("PersonModal — close", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("closes on the X button and on a backdrop click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(PERSON)),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderModal(onClose);

    await screen.findByRole("heading", { level: 2 });

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // backdrop (the presentation wrapper) also closes
    const dialog = screen.getByRole("dialog");
    await user.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
