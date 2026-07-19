/**
 * App-level toast overlay — pixel-bubble styled, HeroUI v3 (beta) ships no
 * toast primitive yet. Mount `ToastProvider` once above the router outlet,
 * then `useToast().show(...)` (from `@/lib/toast`) anywhere. Toasts survive
 * navigation (the provider never unmounts), which is exactly what the record
 * screen needs — it navigates away and THEN reports "saved".
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { PiCheckCircle, PiWarningCircle } from "react-icons/pi";
import { Icon } from "./Icon";
import { ToastContext, type ToastItem, type ToastTone } from "@/lib/toast";

/** How long a toast lingers. Errors stay longer — there's a reason to read. */
const TOAST_MS: Record<ToastTone, number> = { success: 4500, error: 7000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, tone, message }]);
      setTimeout(() => dismiss(id), TOAST_MS[tone]);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* overlay: bottom-center, above the pixel bottom bar, tap to dismiss */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+4.75rem))] z-[70] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            role={t.tone === "error" ? "alert" : "status"}
            onClick={() => dismiss(t.id)}
            className="pixel-bubble pointer-events-auto flex max-w-sm items-start gap-2 px-3 py-2.5 text-left"
          >
            <Icon
              icon={t.tone === "success" ? PiCheckCircle : PiWarningCircle}
              size={18}
              className={
                t.tone === "success"
                  ? "mt-px shrink-0 text-[var(--accent)]"
                  : "mt-px shrink-0 text-[#a03c37]"
              }
            />
            <span className="text-sm leading-snug">{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
