const ALPHA_STEPS = [10, 15, 20, 30, 40, 50, 60] as const;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/** Waliduje hex koloru (z lub bez `#`, 6 cyfr) — używane przez pole
 * tekstowe koloru akcentu w Settings.tsx, żeby dawać natychmiastowy
 * feedback ("nieprawidłowy hex") zamiast po cichu ignorować literówkę
 * jak robi to `applyAccentColor` (które musi być odporne na złe dane z
 * pliku ustawień, nie tylko na wpisywanie na żywo). */
export function isValidHex(hex: string): boolean {
  return hexToRgb(hex) !== null;
}

/** Normalizuje do postaci `#rrggbb` (małe litery, wiodący `#`) — do
 * zapisu/porównań, żeby "ff3333", "#FF3333" i "#ff3333" nie liczyły się
 * jako różne wartości. Zwraca `null` dla nieprawidłowego hexa. */
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/** Ustawia `--accent` i pochodne `--accent-NN` (rgba, NN = % krycia) na `:root`.
 * Nieprawidłowy hex jest cicho ignorowany — zostaje poprzedni/domyślny kolor
 * zamiast psuć całe UI przezroczystymi/czarnymi elementami. */
export function applyAccentColor(hex: string): void {
  const rgb = hexToRgb(hex);
  if (!rgb) return;

  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  for (const step of ALPHA_STEPS) {
    root.setProperty(`--accent-${step}`, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${step / 100})`);
  }
}
