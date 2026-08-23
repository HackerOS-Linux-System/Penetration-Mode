import { For, onCleanup, createSignal, onMount } from "solid-js";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from "lucide-solid";
import { toasts, dismissToast, expireToasts, TOAST_LIFETIME_MS, type ToastKind } from "../lib/toast";

const KIND_STYLE: Record<ToastKind, { icon: any; class: string }> = {
  info: { icon: Info, class: "border-[var(--accent)]/30 text-[var(--text-primary)]" },
  success: { icon: CheckCircle2, class: "border-green-500/40 text-green-400" },
  warning: { icon: AlertTriangle, class: "border-yellow-500/40 text-yellow-400" },
  danger: { icon: ShieldAlert, class: "border-[#ff3333]/50 text-[#ff5555]" },
};

/** Pasek toastów w prawym dolnym rogu — subskrybuje `lib/toast.ts` i sam
 * zajmuje się auto-znikaniem (co sekundę filtruje przez `expireToasts`,
 * czystą, testowalną funkcję). */
export function ToastStack() {
  const [, forceTick] = createSignal(0);
  const interval = setInterval(() => forceTick((n) => n + 1), 1000);
  onCleanup(() => clearInterval(interval));

  onMount(() => {
    // Odśwież raz od razu, żeby pierwszy toast nie czekał sekundy na tick.
    forceTick((n) => n + 1);
  });

  const visible = () => expireToasts(toasts(), Date.now(), TOAST_LIFETIME_MS);

  return (
    <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      <For each={visible()}>
        {(toast) => {
          const style = KIND_STYLE[toast.kind];
          return (
            <div
              class={`pointer-events-auto bg-[var(--bg-surface)] border rounded-lg shadow-xl p-3 flex items-start gap-2.5 animate-[fadeIn_0.15s_ease-out] ${style.class}`}
            >
              <style.icon size={16} class="shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <div class="text-[11px] font-bold text-[var(--text-primary)]">{toast.title}</div>
                {toast.message && <div class="text-[10px] text-[var(--text-muted)] mt-0.5 leading-snug">{toast.message}</div>}
              </div>
              <button onClick={() => dismissToast(toast.id)} class="text-[var(--text-faint)] hover:text-[var(--text-primary)] shrink-0">
                <X size={13} />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
}
