// Number & currency formatting — HKD, compact for tiles, full for tables.

export function hkd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.round(Math.abs(n)).toLocaleString("en-HK")}`;
}

export function hkdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number, digits = 1): string {
  const s = x > 0 ? "+" : "";
  return `${s}${(x * 100).toFixed(digits)}%`;
}

export function variancePct(actual: number, base: number): number | null {
  if (!base) return null;
  return (actual - base) / Math.abs(base);
}
