export function kbpsToBarHeight(kbps: number): number {
  if (kbps <= 0) return 4;
  return Math.min(100, Math.max(4, Math.log2(kbps + 1) * 12));
}
