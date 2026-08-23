export type InstallState = "idle" | "installing" | "removing";

/**
 * Tekst przycisku pakietu w Store — wyciągnięte z JSX (`Store.tsx`) do
 * czystej funkcji, żeby dało się to przetestować bez renderowania
 * komponentu (patrz `__tests__/installState.test.ts`).
 */
export function installButtonLabel(installed: boolean, state: InstallState): string {
  if (installed) {
    return state === "removing" ? "Usuwam..." : "Usuń";
  }
  return state === "installing" ? "Instaluję..." : "Zainstaluj";
}

/** Przycisk pakietu jest zablokowany, gdy trwa dla niego jakakolwiek akcja. */
export function isActionDisabled(state: InstallState): boolean {
  return state !== "idle";
}
