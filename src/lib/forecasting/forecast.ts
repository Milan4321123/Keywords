export interface SeriesPoint {
  period: string;
  value: number;
}

export interface ForecastPoint {
  period: string;
  value: number;
  lower: number;
  upper: number;
}

export interface ForecastResult {
  ok: boolean;
  reason?: string;
  model: string;
  history_points: number;
  forecasts: ForecastPoint[];
  assumptions: string[];
  fit: { slope: number; intercept: number; residual_std: number } | null;
}

export const MIN_HISTORY_POINTS = 6;

/** Advance a period label (YYYY, YYYY-MM, YYYY-MM-DD, YYYY-Qn) by n steps. */
export function nextPeriod(period: string, steps: number): string {
  const quarterMatch = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const total = parseInt(quarterMatch[1], 10) * 4 + (parseInt(quarterMatch[2], 10) - 1) + steps;
    return `${Math.floor(total / 4)}-Q${(total % 4) + 1}`;
  }
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const total = parseInt(monthMatch[1], 10) * 12 + (parseInt(monthMatch[2], 10) - 1) + steps;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  }
  const dayMatch = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayMatch) {
    const date = new Date(Date.UTC(+dayMatch[1], +dayMatch[2] - 1, +dayMatch[3]));
    date.setUTCDate(date.getUTCDate() + steps);
    return date.toISOString().slice(0, 10);
  }
  const yearMatch = period.match(/^(\d{4})$/);
  if (yearMatch) return String(parseInt(yearMatch[1], 10) + steps);
  return `${period}+${steps}`;
}

/**
 * Forecast a metric series: ordinary least squares trend with a 95%
 * prediction interval from residual spread. Deliberately simple and
 * fully explainable — assumptions are part of the result, and the
 * caller must separate these projections from facts.
 */
export function forecastSeries(history: SeriesPoint[], horizon: number): ForecastResult {
  const points = history
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => (a.period < b.period ? -1 : 1));

  if (points.length < MIN_HISTORY_POINTS) {
    return {
      ok: false,
      reason: `Not enough history: ${points.length} data points, need at least ${MIN_HISTORY_POINTS}. A forecast would be a guess, so none is produced.`,
      model: 'none',
      history_points: points.length,
      forecasts: [],
      assumptions: [],
      fit: null,
    };
  }

  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let ssXY = 0;
  let ssXX = 0;
  for (let i = 0; i < n; i++) {
    ssXY += (xs[i] - meanX) * (ys[i] - meanY);
    ssXX += (xs[i] - meanX) ** 2;
  }
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanY - slope * meanX;

  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const residualStd = Math.sqrt(
    residuals.reduce((a, r) => a + r * r, 0) / Math.max(1, n - 2)
  );

  const lastPeriod = points[n - 1].period;
  const clampedHorizon = Math.max(1, Math.min(horizon, 12));
  const forecasts: ForecastPoint[] = [];
  for (let step = 1; step <= clampedHorizon; step++) {
    const x = n - 1 + step;
    const value = intercept + slope * x;
    // Interval widens with distance from the observed range
    const width = 1.96 * residualStd * Math.sqrt(1 + 1 / n + ((x - meanX) ** 2) / Math.max(1e-9, ssXX));
    forecasts.push({
      period: nextPeriod(lastPeriod, step),
      value: Math.round(value * 100) / 100,
      lower: Math.round((value - width) * 100) / 100,
      upper: Math.round((value + width) * 100) / 100,
    });
  }

  const trendWord = slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'flat';
  return {
    ok: true,
    model: 'ols_linear_trend',
    history_points: n,
    forecasts,
    assumptions: [
      `Linear trend fitted on ${n} historical periods (${points[0].period} → ${lastPeriod}); recent ${trendWord} trend is assumed to continue.`,
      'No seasonality, one-off events, or external factors are modeled.',
      '95% prediction intervals derive from historical scatter around the trend; actual uncertainty may be higher.',
      'This is a projection, not a fact — treat it separately from computed actuals.',
    ],
    fit: {
      slope: Math.round(slope * 10000) / 10000,
      intercept: Math.round(intercept * 100) / 100,
      residual_std: Math.round(residualStd * 100) / 100,
    },
  };
}
