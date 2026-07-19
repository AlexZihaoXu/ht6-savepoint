// PeopleModal — the People pop-up over a dimmed backdrop. Rendered under a
// MemoryRouter (it reads useParams for the /people/:id deep-link and uses
// useNavigate to close) + ToastProvider (the nested PersonModal calls useToast).
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@/components/Toast";
import { RECENT_MS } from "@/lib/contacts";
import type { ApiPerson, ApiPersonDetail } from "@/lib/api";
import { PeopleModal } from "./PeopleModal";

const NOW = Date.now();

function person(over: Partial<ApiPerson> & { local_id: string }): ApiPerson {
  return {
    name: null,
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
    ...over,
  };
}

const MIA = person({
  local_id: "demo-mia",
  name: "Mia",
  tags: ["friend", "gym"],
  last_seen: new Date(NOW - 3600_000).toISOString(), // recent
});
const NOAH = person({
  local_id: "demo-noah",
  name: "Noah",
  last_seen: new Date(NOW - 2 * RECENT_MS).toISOString(), // stale
});
const PEOPLE = [MIA, NOAH];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubPeopleFetch() {
  const detail = (p: ApiPerson): ApiPersonDetail => ({
    ...p,
    first_seen: null,
    events: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const m = url.match(/\/people\/([^/?]+)/);
      if (m) {
        const found = PEOPLE.find((p) => p.local_id === m[1]);
        return found
          ? jsonResponse(detail(found))
          : new Response("no", { status: 404 });
      }
      return jsonResponse(PEOPLE);
    }),
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <LocationProbe />
        <Routes>
          <Route path="/plaza" element={<div>plaza</div>} />
          <Route path="/people" element={<PeopleModal />} />
          <Route path="/people/:id" element={<PeopleModal />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("PeopleModal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the people as a pop-up dialog with no title or count chrome", async () => {
    stubPeopleFetch();
    renderAt("/people");

    const dialog = await screen.findByRole("dialog", { name: "People" });
    expect(await within(dialog).findByText("Mia")).toBeInTheDocument();
    expect(within(dialog).getByText("Noah")).toBeInTheDocument();
    // no title heading, no "N characters" count
    expect(
      screen.queryByRole("heading", { name: /^people$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/characters in your town/i)).toBeNull();
    // the filter funnel is present
    expect(
      within(dialog).getByRole("button", { name: /filter and sort/i }),
    ).toBeInTheDocument();
  });

  it("shows last-seen only for recently-seen people, and tags below the name", async () => {
    stubPeopleFetch();
    renderAt("/people");

    await screen.findByText("Mia");
    // Mia was seen an hour ago → her "seen …" line shows
    expect(screen.getByText(/seen today/i)).toBeInTheDocument();
    // exactly one "seen …" line total (Noah is stale → none)
    expect(screen.getAllByText(/^seen /i)).toHaveLength(1);
    // tags render below the name
    expect(screen.getByText("friend · gym")).toBeInTheDocument();
  });

  it("closing the pop-up navigates back to /plaza", async () => {
    stubPeopleFetch();
    const user = userEvent.setup();
    renderAt("/people");

    await screen.findByText("Mia");
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/plaza");
  });

  it("tapping a row opens that person's profile pop-up without navigating", async () => {
    stubPeopleFetch();
    const user = userEvent.setup();
    renderAt("/people");

    await screen.findByText("Mia");
    await user.click(screen.getByRole("button", { name: /open mia/i }));

    // the person dialog opens on top; the URL stays on /people (no full page)
    expect(
      await screen.findByRole("dialog", { name: "Mia" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loc")).toHaveTextContent("/people");
  });

  it("opens the profile pop-up for a /people/:id deep-link", async () => {
    stubPeopleFetch();
    renderAt("/people/demo-noah");

    expect(
      await screen.findByRole("dialog", { name: "Noah" }),
    ).toBeInTheDocument();
  });
});
