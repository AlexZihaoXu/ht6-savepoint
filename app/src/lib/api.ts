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

/**
 * A person's generated PixelLab sprite sheet (SAV-61). Filenames are relative
 * to `/sprites/{local_id}/` — resolve them with `spriteUrl`. Tiles are square
 * transparent pixel-art PNGs (92×92 today); `walk.east` is the side-facing
 * walk cycle (left = the same frames mirrored).
 */
export interface SpriteManifest {
  tile: { w: number; h: number };
  static: { south: string; east: string; west: string; north: string };
  walk: { east: string[] };
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
  /** Warm 1–2 sentence generated character bio (null until the backend writes one). */
  bio: string | null;
  /** PixelLab sheet manifest — null until this person's sprites generate. */
  sprite: SpriteManifest | null;
}

/** Absolute URL of one sprite-sheet file named by a `SpriteManifest`. */
export function spriteUrl(localId: string, filename: string): string {
  return `${API_BASE}/sprites/${encodeURIComponent(localId)}/${encodeURIComponent(filename)}`;
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

/** One podium row of `GET /month/{YYYY-MM}/summary`. */
export interface ApiMonthTopPerson {
  person: ApiPerson;
  interactions: number;
}

/** GET /month/{YYYY-MM}/summary — the Past view's month-in-review. */
export interface ApiMonthSummary {
  month: string;
  days_journaled: number;
  total_events: number;
  people_count: number;
  /** Up to 5, most interactions first. */
  top_people: ApiMonthTopPerson[];
  /** Null for a month with no recorded moments. */
  busiest_day: { date: string; events: number } | null;
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

/* ---- audio-clip ingest (SAV-40 — app-side mic capture) -------------------- */

/** What `POST /ingest/audio/clip` hands back after diarizing the clip. */
export interface AudioIngestResult {
  events: unknown[];
  days: unknown[];
}

/**
 * Multipart body for `POST /ingest/audio/clip`: the recorded blob plus the
 * wall-clock time recording BEGAN (the server offsets diarized segment times
 * from it). Pure — split out so it's unit-testable without a network.
 */
export function buildAudioClipForm(blob: Blob, startedAt: Date): FormData {
  const form = new FormData();
  form.append("audio", blob, "clip.webm");
  form.append("started_at", startedAt.toISOString());
  return form;
}

/** Upload a recorded audio clip for diarized ingest. */
export async function ingestAudioClip(
  blob: Blob,
  startedAt: Date,
  signal?: AbortSignal,
): Promise<AudioIngestResult> {
  const path = "/ingest/audio/clip";
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: buildAudioClipForm(blob, startedAt),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as AudioIngestResult;
}

/* ---- tap-to-name (SAV-57 — bind a "Speaker N" to a real Person) ----------- */

/** What `POST /day/{date}/assign-speaker` hands back: the binding + fresh day. */
export interface SpeakerAssignmentResult {
  speaker_label: string;
  person_local_id: string;
  /** How many of the day's events were rebound to the person. */
  reassigned: number;
  /** The refreshed DayView — swap it into the scene, no reload needed. */
  day: ApiDayView;
}

/**
 * Assign a raw diarization label (e.g. "Speaker 1") on one day to a real
 * Person: the backend rewrites that day's spoke-events to the person's
 * local_id and returns the refreshed DayView.
 */
export async function assignSpeaker(
  date: string,
  speakerLabel: string,
  personLocalId: string,
  signal?: AbortSignal,
): Promise<SpeakerAssignmentResult> {
  const path = `/day/${date}/assign-speaker`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      speaker_label: speakerLabel,
      person_local_id: personLocalId,
    }),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as SpeakerAssignmentResult;
}

export const api = {
  people: (signal?: AbortSignal) => getJSON<ApiPerson[]>("/people", signal),
  person: (localId: string, signal?: AbortSignal) =>
    getJSON<ApiPersonDetail>(`/people/${encodeURIComponent(localId)}`, signal),
  days: (signal?: AbortSignal) => getJSON<ApiDay[]>("/days", signal),
  day: (date: string, signal?: AbortSignal) =>
    getJSON<ApiDayView>(`/day/${date}`, signal),
  today: (signal?: AbortSignal) => getJSON<ApiDayView>("/today", signal),
  monthSummary: (month: string, signal?: AbortSignal) =>
    getJSON<ApiMonthSummary>(
      `/month/${encodeURIComponent(month)}/summary`,
      signal,
    ),
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
