import { createSignal } from "solid-js";
import { Target, X } from "lucide-solid";

export function DraggableScanner() {
  const [isOpen, setIsOpen] = createSignal(true);
  const [scanning, setScanning] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 80, y: 80 });
  const [progress, setProgress] = createSignal(0);

  let dragOffset = { x: 0, y: 0 };
  let dragging = false;

  const onPointerDown = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    dragging = true;
    dragOffset = { x: e.clientX - pos().x, y: e.clientY - pos().y };
    target.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const x = Math.min(Math.max(e.clientX - dragOffset.x, 0), 800);
    const y = Math.min(Math.max(e.clientY - dragOffset.y, 0), 600);
    setPos({ x, y });
  };

  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const launchScan = () => {
    setScanning(true);
    setProgress(0);
    const start = performance.now();
    const duration = 3000;
    const step = (now: number) => {
      const pct = Math.min(((now - start) / duration) * 100, 100);
      setProgress(pct);
      if (pct < 100) requestAnimationFrame(step);
      else setScanning(false);
    };
    requestAnimationFrame(step);
  };

  if (!isOpen()) return null;

  return (
    <div
      class="absolute w-64 bg-[var(--bg-surface-90)] backdrop-blur-md border border-[var(--accent-30)] rounded-xl shadow-[0_0_15px_var(--accent-10)] z-50 overflow-hidden"
      style={{ top: `${pos().y}px`, left: `${pos().x}px` }}
    >
      <div
        class="h-8 bg-[var(--bg-surface-raised)] border-b border-[var(--border-default)] px-3 flex items-center justify-between cursor-move touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div class="flex items-center gap-2">
          <Target size={12} class="text-[var(--accent)]" />
          <span class="text-[9px] uppercase tracking-widest font-bold text-[var(--text-primary)]">Quick Scan</span>
        </div>
        <button onClick={() => setIsOpen(false)} class="text-[var(--text-muted)] hover:text-[var(--accent)]">
          <X size={12} />
        </button>
      </div>
      <div class="p-4 flex flex-col gap-3">
        <input
          type="text"
          placeholder="Target IP / Range"
          value="10.0.8.0/24"
          class="w-full bg-[var(--bg-app)] border border-[var(--border-strong)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)] font-mono outline-none focus:border-[var(--accent-50)]"
        />
        <button
          onClick={launchScan}
          class="w-full bg-[var(--border-default)] hover:bg-[var(--accent)] text-white text-[10px] font-bold uppercase tracking-wider py-1.5 rounded transition-colors"
        >
          {scanning() ? "Scanning..." : "Launch Scan"}
        </button>
        {scanning() && (
          <div class="w-full h-1 bg-[var(--border-default)] rounded overflow-hidden">
            <div class="h-full bg-[var(--accent)] transition-[width] duration-75 ease-linear" style={{ width: `${progress()}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
