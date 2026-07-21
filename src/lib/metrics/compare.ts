export type MetricComparisonOperation = 'difference' | 'percent_difference' | 'ratio';

export interface MetricComparisonResult {
  difference?: number | null;
  percent_difference?: number | null;
  ratio?: number | null;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Deterministic arithmetic between two already-computed catalog metrics. */
export function compareMetricValues(
  metricA: number | null,
  metricB: number | null,
  operations: MetricComparisonOperation[]
): MetricComparisonResult {
  const result: MetricComparisonResult = {};
  const selected = new Set(operations);
  if (metricA == null || metricB == null || !Number.isFinite(metricA) || !Number.isFinite(metricB)) {
    for (const operation of selected) result[operation] = null;
    return result;
  }
  if (selected.has('difference')) result.difference = rounded(metricA - metricB);
  if (selected.has('percent_difference')) {
    result.percent_difference = metricB === 0 ? null : rounded(((metricA - metricB) / Math.abs(metricB)) * 100);
  }
  if (selected.has('ratio')) result.ratio = metricB === 0 ? null : rounded(metricA / metricB);
  return result;
}

