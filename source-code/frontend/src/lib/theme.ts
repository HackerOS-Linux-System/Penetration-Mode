import { createSignal } from "solid-js";

/**
 * Motyw jasny/ciemny — niezależny od koloru akcentu (`lib/accent.ts`).
 * Dotąd UI miał dokładnie jeden, na sztywno wpisany ciemny motyw
 * (dziesiątki `bg-[#111]`/`text-[#e0e0e0]`/`border-[#222]` rozsianych po
 * wszystkich komponentach). Rozwiązanie jest tej samej rodziny co
 * `accent.ts`: zestaw semantycznych zmiennych CSS (`--bg-surface`,
 * `--text-primary`, `--border-default`, ...) zdefiniowanych w
 * `index.css` dla `:root` (ciemny, domyślny) i nadpisanych dla
 * `[data-theme="light"]`. Komponenty używają `var(--...)` zamiast
 * konkretnego hexa.
 *
 * Wyjątek: `Terminal.tsx`/`LogsTerminal.tsx` renderują przez `<canvas>`
 * (xterm.js), które NIE rozumie zmiennych CSS — te dwa komponenty
 * subskrybują `currentTheme()` z tego modułu i same dobierają literalny
 * zestaw kolorów (patrz `TERMINAL_THEMES` niżej), żeby terminal też
 * reagował na zmianę motywu, zamiast zostać na stałe czarny w trybie
 * jasnym.
 */
export type Theme = "dark" | "light";

const [currentTheme, setCurrentThemeSignal] = createSignal<Theme>("dark");
export { currentTheme };

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  setCurrentThemeSignal(theme);
}

/** Kolory xterm.js dla obu motywów — canvas nie czyta `var(--...)`, więc to
 * muszą być literały. "Hackerski" zielony akcent terminala jest zachowany
 * w obu motywach (tożsamość stylistyczna), tylko z odwróconym kontrastem. */
export const TERMINAL_THEMES: Record<Theme, { background: string; foreground: string; cursor: string; selection: string }> = {
  dark: {
    background: "#111111",
    foreground: "#00ff41",
    cursor: "#00ff41",
    selection: "#ff333355",
  },
  light: {
    background: "#f4f7f2",
    foreground: "#0a7a34",
    cursor: "#0a7a34",
    selection: "#ff333333",
  },
};

export const LOGS_TERMINAL_THEMES: Record<Theme, { background: string; foreground: string; cursor: string }> = {
  dark: {
    background: "#0c0c0c",
    foreground: "#8ad1ff",
    cursor: "#8ad1ff",
  },
  light: {
    background: "#eef4f8",
    foreground: "#0b6fa8",
    cursor: "#0b6fa8",
  },
};
