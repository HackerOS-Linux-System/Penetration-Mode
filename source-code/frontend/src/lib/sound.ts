let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

function beep(frequency: number, startAt: number, durationSec: number, ctx: AudioContext, gainValue: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, ctx.currentTime + startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + durationSec);
}

/** Dwuton "uwaga" — używany dla zdarzeń wysokiego ryzyka z threat feed. */
export function playAlertSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    beep(880, 0, 0.12, ctx, 0.08);
    beep(660, 0.14, 0.16, ctx, 0.08);
  } catch {
    // AudioContext bywa zablokowany przez politykę autoplay przeglądarki
    // dopóki operator nie wejdzie w interakcję ze stroną — cicho pomijamy,
    // to nie jest błąd wart przerywania niczego innego.
  }
}

/** Pojedynczy, cichszy "tik" — używany dla mniej krytycznych powiadomień. */
export function playNotifySound(): void {
  const ctx = getContext();
  if (!ctx) return;
  try {
    beep(520, 0, 0.08, ctx, 0.05);
  } catch {
    // jak wyżej
  }
}
