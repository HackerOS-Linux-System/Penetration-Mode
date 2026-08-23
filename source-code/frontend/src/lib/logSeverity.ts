export type LogSeverity = "critical" | "error" | "warning" | "info" | null;

/**
 * Wykrywa poziom istotności linii logu po słowach kluczowych — dotąd
 * `LogsTerminal.tsx` kolorował całą linię wyłącznie wg *źródła* (kontener
 * / audit / system), więc `ERROR` i zwykła linia informacyjna z tego
 * samego źródła wyglądały identycznie. To dodaje drugi wymiar: kolor
 * per-linia wg treści, niezależny od koloru źródła.
 *
 * Celowo proste dopasowanie słów kluczowych (case-insensitive, na
 * granicach słów) zamiast pełnego parsera formatów logów — pokrywa
 * zdecydowaną większość rzeczywistych logów (syslog, journald, appki
 * pisane w Pythonie/Node/Javie/Go, które w większości używają tych samych
 * angielskich nazw poziomów) bez potrzeby konfigurowania formatu.
 */
export function detectLogSeverity(line: string): LogSeverity {
  if (/\b(critical|fatal|panic|segfault)\b/i.test(line)) return "critical";
  if (/\b(error|err|fail(ed|ure)?|exception|denied|refused)\b/i.test(line)) return "error";
  if (/\b(warn(ing)?|deprecat(ed|ion))\b/i.test(line)) return "warning";
  if (/\b(info|notice|debug)\b/i.test(line)) return "info";
  return null;
}

/** Kody ANSI (foreground) dla xterm.js — `null` oznacza "brak
 * nadpisania", czyli zostaje kolor źródła. */
export const SEVERITY_ANSI: Record<Exclude<LogSeverity, null>, string> = {
  critical: "\x1b[1;91m", // jaskrawa czerwień, pogrubiona
  error: "\x1b[91m", // czerwień
  warning: "\x1b[93m", // żółty
  info: "\x1b[90m", // przygaszony szary — "info" nie powinno krzyczeć głośniej niż źródło
};
