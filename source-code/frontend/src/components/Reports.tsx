import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { Download, FileText, FileSpreadsheet, BarChart3 } from "lucide-solid";
import jsPDF from "jspdf";
import { getThreatFeed, readAuditLog, type ThreatEntry, type AuditRecord, type Session } from "../lib/tauri";
import { auditRecordsToCsv } from "../lib/auditCsv";

type RangeDays = 1 | 7 | 30 | 0; // 0 = all

const RANGE_LABEL: Record<RangeDays, string> = { 1: "24h", 7: "7 dni", 30: "30 dni", 0: "Wszystko" };

/**
 * Rozbudowana wersja przycisku "Export Audit PDF" z Analytics.tsx: pełny
 * widok raportów, nie tylko pojedynczy PDF na sztywno — filtr zakresu
 * dat, podsumowanie liczbowe, eksport PDF *i* CSV (do dalszej obróbki w
 * arkuszu, np. dla klienta/compliance). Nowa pozycja w lewym pasku.
 */
export function Reports(props: { session: Session }) {
  const [audit, setAudit] = createSignal<AuditRecord[]>([]);
  const [threats, setThreats] = createSignal<ThreatEntry[]>([]);
  const [range, setRange] = createSignal<RangeDays>(7);

  onMount(async () => {
    setAudit(await readAuditLog(1000));
    try {
      setThreats(await getThreatFeed());
    } catch {
      // brak podpiętego źródła — raport i tak jest sensowny bez threat feedu
    }
  });

  const inRange = createMemo(() => {
    const days = range();
    if (days === 0) return audit();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return audit().filter((a) => new Date(a.timestamp).getTime() >= cutoff);
  });

  const stats = createMemo(() => {
    const entries = inRange();
    const byEvent: Record<string, number> = {};
    const operators = new Set<string>();
    for (const e of entries) {
      byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
      operators.add(e.operator);
    }
    return {
      total: entries.length,
      operators: operators.size,
      logins: byEvent["auth.login"] ?? 0,
      terminalSessions: byEvent["terminal.session_start"] ?? 0,
      installs: byEvent["store.package_installed"] ?? byEvent["blackarch.install"] ?? 0,
      topEvents: Object.entries(byEvent).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  });

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.setTextColor(255, 51, 51);
    doc.text("Penetration Mode — Raport operacyjny", 14, 18);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Wygenerowano: ${new Date().toLocaleString()}`, 14, 26);
    doc.text(`Zakres: ${RANGE_LABEL[range()]} — operator: ${props.session.username} (${props.session.role})`, 14, 32);

    doc.setDrawColor(230);
    doc.line(14, 36, 196, 36);

    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    doc.text("Podsumowanie", 14, 46);
    doc.setFontSize(10);
    const s = stats();
    const summaryLines = [
      `Zdarzenia audytu: ${s.total}`,
      `Aktywni operatorzy: ${s.operators}`,
      `Logowania: ${s.logins}`,
      `Sesje terminala: ${s.terminalSessions}`,
      `Zainstalowane pakiety: ${s.installs}`,
      `Zagrożenia w feedzie: ${threats().length} (wysokie: ${threats().filter((t) => t.severity === "high").length})`,
    ];
    let y = 54;
    summaryLines.forEach((line) => {
      doc.text(line, 18, y);
      y += 7;
    });

    y += 4;
    doc.setFontSize(13);
    doc.text("Najczęstsze zdarzenia", 14, y);
    y += 8;
    doc.setFontSize(9);
    s.topEvents.forEach(([event, count]) => {
      doc.text(`${event}`, 18, y);
      doc.text(`${count}`, 170, y);
      y += 6;
    });

    y += 6;
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0);
    doc.text("Zidentyfikowane zagrożenia", 14, y);
    y += 8;
    doc.setFontSize(9);
    if (threats().length === 0) {
      doc.setTextColor(120, 120, 120);
      doc.text("Brak podpiętego źródła threat feed.", 18, y);
    } else {
      threats().forEach((t) => {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        doc.setTextColor(0, 0, 0);
        doc.text(`[${t.severity.toUpperCase()}] ${t.title}`, 18, y);
        y += 6;
      });
    }

    doc.save(`penetration-mode-raport-${range() === 0 ? "all" : range() + "d"}-${Date.now()}.pdf`);
  };

  const exportCSV = () => {
    const csv = auditRecordsToCsv(inRange());
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `penetration-mode-audit-${range() === 0 ? "all" : range() + "d"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="flex-1 flex flex-col min-h-0 gap-3">
      <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div class="flex items-center gap-2">
          <BarChart3 size={14} class="text-[var(--accent)]" />
          <span class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Zakres raportu</span>
          <div class="flex bg-[var(--bg-inset)] rounded border border-[var(--border-default)] overflow-hidden ml-2">
            <For each={[1, 7, 30, 0] as RangeDays[]}>
              {(d) => (
                <button
                  onClick={() => setRange(d)}
                  class={`px-3 py-1.5 text-[9px] uppercase tracking-wider transition-colors ${
                    range() === d ? "bg-[var(--accent-15)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {RANGE_LABEL[d]}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="flex gap-2">
          <button
            onClick={exportPDF}
            class="flex items-center gap-1.5 px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded bg-[var(--border-default)] text-white hover:bg-[var(--accent)] transition-colors"
          >
            <FileText size={12} />
            Eksport PDF
          </button>
          <button
            onClick={exportCSV}
            class="flex items-center gap-1.5 px-3 py-2 text-[9px] font-bold uppercase tracking-widest rounded border border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-50)] hover:text-[var(--accent)] transition-colors"
          >
            <FileSpreadsheet size={12} />
            Eksport CSV
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <For
          each={[
            ["Zdarzenia", stats().total],
            ["Operatorzy", stats().operators],
            ["Logowania", stats().logins],
            ["Sesje terminala", stats().terminalSessions],
            ["Instalacje", stats().installs],
          ] as [string, number][]}
        >
          {([label, value]) => (
            <div class="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-3 shadow-lg">
              <div class="text-xl font-bold font-mono text-[var(--text-primary)]">{value}</div>
              <div class="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mt-1">{label}</div>
            </div>
          )}
        </For>
      </div>

      <div class="flex-1 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] p-4 min-h-0 flex flex-col gap-2 shadow-lg">
        <h2 class="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Najczęstsze zdarzenia w zakresie</h2>
        <div class="flex-1 overflow-y-auto space-y-1.5 pr-1" style={{ "scrollbar-width": "thin", "scrollbar-color": "var(--border-strong) var(--bg-surface)" }}>
          <For each={stats().topEvents}>
            {([event, count]) => {
              const max = stats().topEvents[0]?.[1] ?? 1;
              return (
                <div class="flex items-center gap-2">
                  <span class="text-[9px] font-mono text-[var(--text-secondary)] w-40 truncate">{event}</span>
                  <div class="flex-1 h-2 bg-[var(--bg-inset)] rounded overflow-hidden">
                    <div class="h-full bg-[var(--accent-60)]" style={{ width: `${(count / max) * 100}%` }} />
                  </div>
                  <span class="text-[9px] font-mono text-[var(--text-muted)] w-6 text-right">{count}</span>
                </div>
              );
            }}
          </For>
          <Show when={stats().topEvents.length === 0}>
            <div class="text-[9px] text-[var(--text-faint)] italic py-4 text-center flex items-center justify-center gap-2">
              <Download size={12} />
              Brak zdarzeń w wybranym zakresie.
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
