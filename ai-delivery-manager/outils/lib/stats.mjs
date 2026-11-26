// Deterministic statistics. A quantile is returned only when the sample can carry it.

export const MIN_SAMPLES = { p50: 5, p80: 10, p95: 20 };

export function quantile(values, q) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

// Quantiles the sample size allows; the others are null, never extrapolated.
export function quantiles(values) {
  const n = values.length;
  return {
    n,
    p50: n >= MIN_SAMPLES.p50 ? quantile(values, 0.5) : null,
    p80: n >= MIN_SAMPLES.p80 ? quantile(values, 0.8) : null,
    p95: n >= MIN_SAMPLES.p95 ? quantile(values, 0.95) : null,
  };
}

// Three-point estimate. A starting point, not a confidence interval.
export const pert = (o, m, p) => (o + 4 * m + p) / 6;

// Calibration from past tasks: how real durations compared with estimates.
// ratio > 1 means the work took longer than estimated.
export function calibration(pairs) {
  const ok = pairs.filter((x) => x.estimate > 0 && x.actual > 0);
  const ratios = ok.map((x) => x.actual / x.estimate);
  const n = ratios.length;
  if (!n) return { n: 0, usable: false };
  const inRange = ok.filter((x) => x.low != null && x.high != null);
  return {
    n,
    usable: n >= MIN_SAMPLES.p50,
    medianRatio: quantile(ratios, 0.5),
    p80Ratio: n >= MIN_SAMPLES.p80 ? quantile(ratios, 0.8) : null,
    meanAbsErrorMin: ok.reduce((a, x) => a + Math.abs(x.actual - x.estimate), 0) / n,
    overruns: ratios.filter((r) => r > 1).length,
    rangeCoverage: inRange.length ? inRange.filter((x) => x.actual >= x.low && x.actual <= x.high).length / inRange.length : null,
    rangeN: inRange.length,
  };
}

export const min = (ms) => Math.round(ms / 60000);

export function fmtMin(m) {
  if (m == null) return 'n/a';
  m = Math.round(m);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

export function parseSince(v, now = Date.now()) {
  if (!v) return null;
  const m = String(v).match(/^(\d+)([hdw])$/);
  if (m) return now - +m[1] * { h: 3600e3, d: 86400e3, w: 604800e3 }[m[2]];
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`--since: cannot read "${v}" (use 24h, 7d, 4w or an ISO date)`);
  return t;
}
