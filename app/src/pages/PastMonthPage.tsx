/**
 * The Past view — `/past/:month`. "Here's your month": a cozy month-in-review
 * from `GET /month/{YYYY-MM}/summary` — a podium of who you saw most, the
 * month's stats, and its busiest day. Reached from the Past button's month
 * picker on the plaza/garden (waterprism: Past is a look-back popup, distinct
 * from the plaza↔garden swipe).
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  PiCaretLeft,
  PiCaretRight,
  PiCrownSimpleFill,
  PiPlantFill,
} from "react-icons/pi";
import { Icon } from "@/components/Icon";
import { PixelBottomNav, PixelHeader } from "@/components/PixelChrome";
import { PixelSprite } from "@/lib/pixel-sprite";
import {
  api,
  ApiError,
  displayName,
  type ApiMonthSummary,
  type ApiMonthTopPerson,
} from "@/lib/api";
import { monthLabel } from "@/lib/calendar";

type Status = "loading" | "ready" | "missing" | "error";

/** "2026-07-18" → "Sat, Jul 18". */
function fmtBusiestDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Shared pixel chrome around every Past state (loading/missing/ready). */
function PastChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <PixelHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <PixelBottomNav />
    </div>
  );
}

/** Back to wherever the picker was opened (plaza or garden); /plaza if cold. */
function useBack() {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/plaza");
  };
}

export function PastMonthPage() {
  const { month } = useParams();
  const goBack = useBack();

  const [summary, setSummary] = useState<ApiMonthSummary | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      setStatus("missing");
      return;
    }
    const ac = new AbortController();
    setStatus("loading");
    setSummary(null);
    api.monthSummary(month, ac.signal).then(
      (s) => {
        setSummary(s);
        setStatus("ready");
      },
      (e) => {
        if (ac.signal.aborted) return;
        setStatus(
          e instanceof ApiError && e.status === 404 ? "missing" : "error",
        );
      },
    );
    return () => ac.abort();
  }, [month]);

  const backBtn = (
    <button
      type="button"
      className="pixel-btn touch-target inline-flex items-center gap-1.5 self-start px-3 py-1.5"
      onClick={goBack}
    >
      <Icon icon={PiCaretLeft} size={12} />
      <span className="font-pixel text-[9px]">Back</span>
    </button>
  );

  if (status === "loading") {
    return (
      <PastChrome>
        <section className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="animate-pulse text-sm text-[var(--muted)]">
            Turning back the pages…
          </p>
        </section>
      </PastChrome>
    );
  }

  if (status === "missing" || status === "error" || !summary) {
    return (
      <PastChrome>
        <section className="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <Icon icon={PiPlantFill} className="text-5xl text-[var(--muted)]" />
          <h1 className="font-pixel text-[13px]">
            {status === "error" ? "Backend asleep…" : "No such month"}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {status === "error"
              ? "Couldn't reach the SavePoint API — is it up?"
              : "That page of the journal doesn't exist."}
          </p>
          <button
            type="button"
            className="pixel-btn touch-target mt-1 px-4 py-2"
            onClick={goBack}
          >
            <span className="font-pixel text-[10px]">Back</span>
          </button>
        </section>
      </PastChrome>
    );
  }

  const empty = summary.days_journaled === 0 && summary.total_events === 0;

  return (
    <PastChrome>
      <section
        aria-labelledby="past-heading"
        className="flex flex-col gap-4 px-4 pt-4 pb-6"
      >
        {backBtn}

        <header className="text-center">
          <h1 id="past-heading" className="font-pixel text-[16px] leading-7">
            {monthLabel(summary.month) || summary.month}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {empty ? "a quiet page in the journal" : "your month, autosaved"}
          </p>
        </header>

        {empty ? (
          <div className="pixel-panel text-center">
            <Icon icon={PiPlantFill} className="mx-auto text-3xl opacity-70" />
            <p className="mt-2 text-sm leading-relaxed">
              No moments yet this month — the garden is still resting.
            </p>
          </div>
        ) : (
          <>
            {summary.top_people.length > 0 && (
              <div className="pixel-panel">
                <h2 className="font-pixel text-center text-[10px]">
                  Who you saw most
                </h2>
                <Podium top={summary.top_people} />
              </div>
            )}

            <div className="pixel-panel">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat n={summary.days_journaled} label="days journaled" />
                <Stat n={summary.total_events} label="moments" />
                <Stat n={summary.people_count} label="people" />
              </div>
            </div>

            {summary.busiest_day && (
              <Link
                to={`/scene/${summary.busiest_day.date}`}
                className="pixel-panel flex items-center justify-between gap-2"
              >
                <span className="min-w-0">
                  <span className="font-pixel block text-[10px]">
                    Busiest day
                  </span>
                  <span className="mt-1 block text-sm">
                    {fmtBusiestDay(summary.busiest_day.date)} ·{" "}
                    {summary.busiest_day.events}{" "}
                    {summary.busiest_day.events === 1 ? "moment" : "moments"}
                  </span>
                </span>
                <Icon icon={PiCaretRight} className="shrink-0 opacity-60" />
              </Link>
            )}
          </>
        )}
      </section>
    </PastChrome>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="font-pixel text-[18px] leading-7">{n}</p>
      <p className="mt-0.5 text-xs opacity-70">{label}</p>
    </div>
  );
}

/* ---- the podium ----------------------------------------------------------- */

const PEDESTAL_H: Record<number, string> = { 1: "h-11", 2: "h-7", 3: "h-5" };

function PodiumSpot({
  entry,
  rank,
}: {
  entry: ApiMonthTopPerson;
  rank: number;
}) {
  const name = displayName(entry.person);
  const first = rank === 1;
  return (
    <Link
      to={`/people/${entry.person.local_id}`}
      aria-label={`${name} — ${entry.interactions} ${
        entry.interactions === 1 ? "moment" : "moments"
      } together`}
      className="flex w-20 flex-col items-center"
    >
      {first && (
        <Icon
          icon={PiCrownSimpleFill}
          className="mb-0.5 text-xl text-[#d8b757] drop-shadow-[0_1px_0_rgba(0,0,0,0.35)]"
        />
      )}
      <PixelSprite
        localId={entry.person.local_id}
        sprite={entry.person.sprite}
        params={entry.person.avatar_params}
        size={first ? 72 : 52}
      />
      <span
        className={`dlg-nameplate font-pixel z-10 -mt-1 px-1.5 py-0.5 text-[8px]`}
      >
        ×{entry.interactions}
      </span>
      <span className="mt-1 w-full truncate text-center text-xs font-bold">
        {name}
      </span>
      <span
        aria-hidden
        className={`dlg-text mt-1 flex w-14 items-start justify-center ${PEDESTAL_H[rank] ?? "h-5"}`}
      >
        <span className="font-pixel pt-0.5 text-[9px] opacity-70">{rank}</span>
      </span>
    </Link>
  );
}

/**
 * Top-people podium: ranks 2·1·3 side by side (gold center, crown on #1),
 * ranks 4–5 as a smaller row underneath. Every spot links to the person.
 */
function Podium({ top }: { top: ApiMonthTopPerson[] }) {
  const spots = [
    { entry: top[1], rank: 2 },
    { entry: top[0], rank: 1 },
    { entry: top[2], rank: 3 },
  ].filter((s): s is { entry: ApiMonthTopPerson; rank: number } =>
    Boolean(s.entry),
  );
  const rest = top.slice(3);

  return (
    <div className="mt-2">
      <div className="flex items-end justify-center gap-2">
        {spots.map((s) => (
          <PodiumSpot
            key={s.entry.person.local_id}
            entry={s.entry}
            rank={s.rank}
          />
        ))}
      </div>
      {rest.length > 0 && (
        <div className="mt-3 flex justify-center gap-5 border-t-2 border-[#d9a066]/40 pt-2">
          {rest.map((entry, i) => {
            const name = displayName(entry.person);
            return (
              <Link
                key={entry.person.local_id}
                to={`/people/${entry.person.local_id}`}
                aria-label={`${name} — ${entry.interactions} ${
                  entry.interactions === 1 ? "moment" : "moments"
                } together`}
                className="flex w-16 flex-col items-center"
              >
                <PixelSprite
                  localId={entry.person.local_id}
                  sprite={entry.person.sprite}
                  params={entry.person.avatar_params}
                  size={40}
                />
                <span className="mt-0.5 w-full truncate text-center text-xs">
                  {name}{" "}
                  <span className="font-pixel text-[8px] opacity-70">
                    ×{entry.interactions}
                  </span>
                </span>
                <span className="sr-only">rank {i + 4}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
