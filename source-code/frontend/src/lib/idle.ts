export function shouldSendHeartbeat(lastSentAt: number | null, now: number, minIntervalMs: number): boolean {
  if (lastSentAt === null) return true;
  return now - lastSentAt >= minIntervalMs;
}

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;
const DEFAULT_MIN_INTERVAL_MS = 20_000;

/** Podpina listenery aktywności do `window` i woła `onHeartbeat()`
 * (throttlowane przez `shouldSendHeartbeat`) na realny ruch/klawiaturę
 * operatora. Zwraca funkcję odpinającą wszystkie listenery. */
export function attachIdleHeartbeat(onHeartbeat: () => void, minIntervalMs = DEFAULT_MIN_INTERVAL_MS): () => void {
  let lastSentAt: number | null = null;

  const handler = () => {
    const now = Date.now();
    if (shouldSendHeartbeat(lastSentAt, now, minIntervalMs)) {
      lastSentAt = now;
      onHeartbeat();
    }
  };

  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, handler, { passive: true });
  }

  return () => {
    for (const evt of ACTIVITY_EVENTS) {
      window.removeEventListener(evt, handler);
    }
  };
}
