import { createSignal } from "solid-js";

/**
 * Store powiadomień toast (Runda 8) — dotąd appka nie miała żadnego
 * mechanizmu powiadomień; `sound_enabled` w Ustawieniach istniał, ale nic
 * go nie odtwarzało. Prosty moduł na poziomie modułu (nie kontekst Reacta
 * — Solid pozwala na globalne sygnały), żeby dowolny komponent mógł wołać
 * `pushToast(...)` bez przekazywania propsów przez całe drzewo.
 */
export type ToastKind = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  createdAt: number;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
export { toasts };

let counter = 0;

/** Domyślny czas życia toasta w ms zanim zniknie automatycznie. */
export const TOAST_LIFETIME_MS = 6000;

export function pushToast(kind: ToastKind, title: string, message?: string): string {
  const id = `toast-${Date.now()}-${++counter}`;
  setToasts((prev) => [...prev, { id, kind, title, message, createdAt: Date.now() }]);
  return id;
}

export function dismissToast(id: string): void {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

/** Czyste dla testów: które toasty przetrwały do `now`, zważywszy na
 * `TOAST_LIFETIME_MS` — wydzielone z komponentu, żeby dało się to
 * przetestować bez renderowania i bez `setTimeout` w teście. */
export function expireToasts(list: Toast[], now: number, lifetimeMs = TOAST_LIFETIME_MS): Toast[] {
  return list.filter((t) => now - t.createdAt < lifetimeMs);
}
