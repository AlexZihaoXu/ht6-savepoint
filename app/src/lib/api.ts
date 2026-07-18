/**
 * Minimal client for the SavePoint backend read API (server/ — SAV-34).
 *
 * The base URL is `VITE_API_BASE` (set it to the live cloudflared tunnel or a
 * tailnet IP), defaulting to the local dev backend. The backend sends permissive
 * CORS, so the PWA can call it directly from the browser.
 *
 * Shapes mirror `savepoint_server/models` (snake_case over the wire). This is the
 * real-data path that replaces `seed.ts` as the redesign lands.
 */

export const API_BASE = (
  import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

/** The 6 deterministic avatar axes the backend derives per person. */
export interface AvatarParams {
  skin_tone: string;
  hair_color: string;
  hair_style: string;
  glasses: boolean;
  hat: string | null;
  shirt_color: string;
}

export interface ApiPerson {
  local_id: string;
  name: string | null;
  avatar_params: AvatarParams;
  tags: string[];
  favorite: boolean;
  first_seen: string | null;
  last_seen: string | null;
  notes: string | null;
}

export interface ApiEvent {
  _id: string;
  ts: string;
  person_id: string;
  type: "seen" | "spoke";
  text: string | null;
  emotion: string | null;
  place: string | null;
  day_id: string;
}

export interface ApiRecap {
  date: string;
  scope: string;
  narrative: string;
  highlights: string[];
}

export interface ApiDay {
  _id: string;
  date: string;
  mood_color: string | null;
  plant_stage: number;
  summary: { people: number; events: number } | null;
}

export interface ApiDayView {
  day: ApiDay | null;
  events: ApiEvent[];
  people: ApiPerson[];
  recap: ApiRecap | null;
}

/** GET /people/{local_id} — the person plus their recent events. */
export interface ApiPersonDetail extends ApiPerson {
  events: ApiEvent[];
}

/** Error that keeps the HTTP status, so 404s can render as "not found". */
export class ApiError extends Error {
  status: number;

  constructor(status: number, path: string) {
    super(`${path} → HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

export const api = {
  people: (signal?: AbortSignal) => getJSON<ApiPerson[]>("/people", signal),
  person: (localId: string, signal?: AbortSignal) =>
    getJSON<ApiPersonDetail>(`/people/${encodeURIComponent(localId)}`, signal),
  days: (signal?: AbortSignal) => getJSON<ApiDay[]>("/days", signal),
  day: (date: string, signal?: AbortSignal) =>
    getJSON<ApiDayView>(`/day/${date}`, signal),
  today: (signal?: AbortSignal) => getJSON<ApiDayView>("/today", signal),
};

/** A friendly display name: the stored name, else a stable label from the id. */
export function displayName(p: ApiPerson): string {
  if (p.name) return p.name;
  // "Speaker 1" ids read fine as-is; face ids get a short friendly stand-in.
  if (/^speaker/i.test(p.local_id)) return p.local_id;
  return `Neighbor ${p.local_id
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 3)
    .toUpperCase()}`;
}
