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

import { audioExt } from "./mic";

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
  events: ApiEvent[];
  days: ApiDay[];
}

/**
 * Multipart body for `POST /ingest/audio/clip`: the recorded blob plus the
 * wall-clock time recording BEGAN (the server offsets diarized segment times
 * from it). Pure — split out so it's unit-testable without a network.
 */
export function buildAudioClipForm(blob: Blob, startedAt: Date): FormData {
  const form = new FormData();
  form.append("audio", blob, `clip.${audioExt(blob.type)}`);
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

/* ---- live preview transcription (record screen) --------------------------- */

/** One diarized line of `POST /speech/preview` — relative seconds, no ids. */
export interface PreviewSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

/** The store-free preview response: just the separated speech so far. */
export interface PreviewTranscribeResult {
  segments: PreviewSegment[];
}

/**
 * Preview-transcribe a (partial) recording: POST the audio accumulated so far
 * to `/speech/preview` and get back diarized "Speaker N" segments WITHOUT
 * anything being written server-side — safe to poll repeatedly while the
 * recorder is still running. The backend contract is "never 500": decode
 * failures come back as `{segments: []}`, so an ok response always parses.
 */
export async function previewTranscribe(
  blob: Blob,
  signal?: AbortSignal,
): Promise<PreviewTranscribeResult> {
  const path = "/speech/preview";
  const form = new FormData();
  form.append("audio", blob, `preview.${audioExt(blob.type)}`);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as PreviewTranscribeResult;
}

/* ---- voice enrollment ("set up your voice" screen) ------------------------ */

/** GET /voice/status — whether this listener's voiceprint is on file. */
export interface VoiceStatus {
  enrolled: boolean;
  enrolled_at: string | null;
}

/** What `POST /voice/enroll` hands back once the sample is accepted. */
export interface VoiceEnrollResult {
  enrolled: true;
  enrolled_at: string;
}

/**
 * Upload a recorded voice sample to `POST /voice/enroll` so the backend can
 * extract a voiceprint (re-recording overwrites any prior enrollment). A 400
 * means the sample was empty or too short/unusable to enroll — surfaces as
 * the usual `ApiError`.
 */
export async function enrollVoice(
  blob: Blob,
  signal?: AbortSignal,
): Promise<VoiceEnrollResult> {
  const path = "/voice/enroll";
  const form = new FormData();
  form.append("audio", blob, `voice.${audioExt(blob.type)}`);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as VoiceEnrollResult;
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

/* ---- edit a person (name / notes / tags on a person's profile) ------------ */

/** Partial update for `PATCH /people/{local_id}` — omit a key to leave it as-is. */
export interface PersonPatch {
  /** New name; `""`/whitespace clears it back to `null`. */
  name?: string | null;
  /** New notes; `""`/whitespace clears them back to `null`. */
  notes?: string | null;
  /** Full replacement tag list (normalized server-side). */
  tags?: string[];
}

/**
 * Partially update a person: `PATCH /people/{local_id}` with ONLY the keys
 * present in `patch`. Any omitted field is left untouched server-side (the
 * backend keys off the request's `model_fields_set`), so a notes-only patch
 * can't wipe the name and vice versa. Returns the updated Person.
 */
export async function updatePerson(
  localId: string,
  patch: PersonPatch,
  signal?: AbortSignal,
): Promise<ApiPerson> {
  const path = `/people/${encodeURIComponent(localId)}`;
  // Send only the keys the caller explicitly provided so omitted fields aren't
  // touched server-side.
  const body: PersonPatch = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.tags !== undefined) body.tags = patch.tags;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as ApiPerson;
}

/**
 * Rename a person (or clear their name back to `null` — send `""`/whitespace):
 * a thin wrapper over {@link updatePerson}, returning the updated Person.
 */
export async function renamePerson(
  localId: string,
  name: string,
  signal?: AbortSignal,
): Promise<ApiPerson> {
  return updatePerson(localId, { name }, signal);
}

/* ---- clean slate (admin data reset) --------------------------------------- */

/** What `POST /admin/reset` reports: how many docs were deleted per collection. */
export interface ResetResult {
  people: number;
  events: number;
  days: number;
  recaps: number;
}

/**
 * Wipe every collection (people, events, days, recaps) for a clean-slate demo.
 * Destructive + irreversible — always gate this behind a confirmation.
 */
export async function resetData(signal?: AbortSignal): Promise<ResetResult> {
  const path = "/admin/reset";
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", signal });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as ResetResult;
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
  voiceStatus: (signal?: AbortSignal) =>
    getJSON<VoiceStatus>("/voice/status", signal),
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
