/**
 * Toast context + hook, split from the provider component so the component
 * file only exports components (react-refresh) and pages can depend on the
 * hook without pulling provider internals.
 */

import { createContext, useContext } from "react";

export type ToastTone = "success" | "error";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

export interface ToastApi {
  show: (tone: ToastTone, message: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** Toast handle; throws when the provider is missing (a wiring bug). */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider> above it");
  return api;
}
