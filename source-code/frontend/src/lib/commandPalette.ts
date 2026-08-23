export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  shortcut?: string;
}

/**
 * Filtrowanie poleceń w Command Palette (Ctrl/Cmd+K) — proste dopasowanie
 * podciągu (case-insensitive) na `label + keywords`, nie pełny fuzzy-match
 * search (niepotrzebna złożoność dla listy rzędu kilkunastu-kilkudziesięciu
 * poleceń). Puste zapytanie zwraca wszystko w oryginalnej kolejności.
 * Wydzielone z komponentu, żeby dało się to przetestować bez renderowania.
 */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q));
}
