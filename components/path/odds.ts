// Odds as people read them. Math.round(p * 100) turned 1.4% into "1%" and 0.3% into "0%", which
// reads as broken; small shares become "1 in N", mid shares keep one decimal.
export function odds(p: number, runs?: number): string {
  if (!(p > 0)) return runs ? `<1 in ${runs.toLocaleString()}` : "<1 in 1,000";
  if (p < 0.02) return `1 in ${Math.round(1 / p).toLocaleString()}`;
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`;
  return `${Math.round(p * 100)}%`;
}

// A share against the typical company's at the same stage: "2.4× typical". Undefined when the
// typical share is zero (no ratio to give).
export function vsTypical(p: number, typical: number): string | undefined {
  if (!(typical > 0)) return undefined;
  const r = p / typical;
  if (r >= 0.9 && r <= 1.1) return "about typical";
  return `${r.toFixed(1)}× typical`;
}
