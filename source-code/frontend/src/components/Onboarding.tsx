import { createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { TerminalSquare, ScrollText, ShieldCheck, Command, X } from "lucide-solid";

interface Step {
  icon: any;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: TerminalSquare,
    title: "Witaj w Penetration Mode",
    body: "To środowisko red-teamowe z prawdziwym terminalem podpiętym do izolowanego kontenera BlackArch. Kilka rzeczy, zanim zaczniesz.",
  },
  {
    icon: TerminalSquare,
    title: "Terminal ma taby i drugą konsolę",
    body: "Otwórz kilka równoległych sesji terminala przyciskiem „+” nad terminalem. Pod terminalem stale widać drugą konsolę z logami na żywo — z kontenera, audit logu operatora albo systemu.",
  },
  {
    icon: Command,
    title: "Ctrl/Cmd+K otwiera paletę poleceń",
    body: "Szybkie przełączanie widoków i akcje bez sięgania po mysz — Ctrl/Cmd+1…5 przełącza bezpośrednio między Workspace/Arsenal/Activity/Reports/Ustawieniami.",
  },
  {
    icon: ShieldCheck,
    title: "Każda akcja trafia do audit logu",
    body: "Instalacje, logowania, sesje terminala — wszystko jest podpisane łańcuchem HMAC (patrz Ustawienia → \"Sprawdź integralność\"), więc log jest odporny na ciche edycje.",
  },
  {
    icon: ScrollText,
    title: "Dostosuj appkę w Ustawieniach",
    body: "Kolor akcentu, jasny/ciemny motyw, auto-wylogowanie po bezczynności i domyślne źródło logów — wszystko w zakładce Ustawienia (ikonka koła zębatego).",
  },
];

/**
 * Przewodnik dla nowego operatora — pokazywany raz, przy pierwszym
 * uruchomieniu (`settings.onboarding_completed === false`, patrz
 * backend/src/settings.rs). `onFinish` zapisuje `onboarding_completed:
 * true`, żeby się nie powtarzał; "Pomiń" robi dokładnie to samo bez
 * przechodzenia przez resztę kroków.
 */
export function Onboarding(props: { onFinish: () => void }) {
  const [step, setStep] = createSignal(0);
  const isLast = () => step() === STEPS.length - 1;

  return (
    <div class="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 pt-5">
          <div class="flex gap-1.5">
            <For each={STEPS}>
              {(_, i) => (
                <div class={`h-1 w-6 rounded-full transition-colors ${i() <= step() ? "bg-[var(--accent)]" : "bg-[var(--border-default)]"}`} />
              )}
            </For>
          </div>
          <button onClick={props.onFinish} title="Pomiń" class="text-[var(--text-faint)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div class="p-6 flex flex-col gap-3">
          <Show when={STEPS[step()]}>
            {(s) => {
              const Icon = () => s().icon;
              return (
                <>
                  <div class="w-10 h-10 rounded-lg bg-[var(--accent-10)] text-[var(--accent)] flex items-center justify-center">
                    <Dynamic component={Icon()} size={20} />
                  </div>
                  <h2 class="text-[15px] font-bold text-[var(--text-primary)]">{s().title}</h2>
                  <p class="text-[12px] text-[var(--text-muted)] leading-relaxed">{s().body}</p>
                </>
              );
            }}
          </Show>
        </div>

        <div class="flex items-center justify-between px-5 py-4 border-t border-[var(--border-default)]">
          <button onClick={props.onFinish} class="text-[10px] uppercase tracking-widest text-[var(--text-faint)] hover:text-[var(--text-primary)]">
            Pomiń
          </button>
          <div class="flex gap-2">
            <Show when={step() > 0}>
              <button
                onClick={() => setStep((s) => s - 1)}
                class="px-3 py-1.5 text-[10px] uppercase tracking-widest rounded border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-50)] transition-colors"
              >
                Wstecz
              </button>
            </Show>
            <button
              onClick={() => (isLast() ? props.onFinish() : setStep((s) => s + 1))}
              class="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded bg-[var(--accent)] text-black hover:opacity-90 transition-opacity"
            >
              {isLast() ? "Zaczynamy" : "Dalej"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
