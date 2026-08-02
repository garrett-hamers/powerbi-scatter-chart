export type ThresholdMode = "zero" | "mean" | "median" | "fixed" | "benchmark";

export type Quadrant = "upper-right" | "upper-left" | "lower-left" | "lower-right";

export interface RawPoint {
  category: string;
  x: unknown;
  y: unknown;
  series?: string;
  size?: unknown;
  gradient?: unknown;
  tooltips?: Record<string, unknown>;
  identityKey?: string;
  highlighted?: boolean;
}

export interface ValidPoint {
  category: string;
  x: number;
  y: number;
  size?: number;
  gradient?: number;
  series?: string;
  tooltips: Record<string, unknown>;
  identityKey?: string;
  highlighted: boolean;
}

export interface ThresholdSettings {
  xMode?: ThresholdMode;
  yMode?: ThresholdMode;
  xFixed?: number;
  yFixed?: number;
  xBenchmark?: number;
  yBenchmark?: number;
  maxPoints?: number;
  hasHighlights?: boolean;
  partialData?: boolean;
}

export interface Threshold {
  value: number;
  mode: ThresholdMode;
  provenance: string;
  fallback: boolean;
}

export interface ClassifiedPoint extends ValidPoint {
  quadrant: Quadrant;
  onXThreshold: boolean;
  onYThreshold: boolean;
}

export interface QuadrantCounts {
  "upper-right": number;
  "upper-left": number;
  "lower-left": number;
  "lower-right": number;
}

export interface Regression {
  valid: boolean;
  n: number;
  slope?: number;
  intercept?: number;
  r2?: number;
  equation?: string;
  reason?: string;
}

export interface ScatterModel {
  points: ClassifiedPoint[];
  validPoints: ValidPoint[];
  invalidRows: number;
  receivedCount: number;
  analyzedCount: number;
  validCount: number;
  renderedCount: number;
  reduced: boolean;
  partialData: boolean;
  hasHighlights: boolean;
  xThreshold: Threshold;
  yThreshold: Threshold;
  counts: QuadrantCounts;
  boundaryCount: number;
  regression: Regression;
}

export const DEFAULT_MAX_POINTS = 10000;

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isHighlightedValue(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function hasHighlightValues(highlights: readonly unknown[] | undefined): boolean {
  return highlights?.some(isHighlightedValue) ?? false;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? sorted[middle - 1] / 2 + sorted[middle] / 2
    : sorted[middle];
}

function mean(values: readonly number[]): number {
  let scale = 0;
  let scaledSum = 0;
  for (const value of values) {
    const absolute = Math.abs(value);
    if (absolute > scale) {
      scaledSum = scale === 0 ? Math.sign(value) : scaledSum * (scale / absolute) + value / absolute;
      scale = absolute;
    } else if (scale !== 0) {
      scaledSum += value / scale;
    }
  }
  return scale === 0 ? 0 : scale * (scaledSum / values.length);
}

function maxAbsolute(values: readonly number[]): number {
  let maximum = 0;
  for (const value of values) {
    maximum = Math.max(maximum, Math.abs(value));
  }
  return maximum;
}

function normalizeFloatingPoint(value: number): number {
  const nearestInteger = Math.round(value);
  return Math.abs(value - nearestInteger) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 16
    ? nearestInteger
    : value;
}

function threshold(
  mode: ThresholdMode,
  values: number[],
  fixed: number | undefined,
  benchmark: number | undefined,
  axis: string
): Threshold {
  if (values.length === 0) {
    return { value: 0, mode, provenance: `${axis} threshold unavailable; using zero`, fallback: true };
  }
  if (mode === "zero") {
    return { value: 0, mode, provenance: `${axis} threshold: zero`, fallback: false };
  }
  if (mode === "mean") {
    const value = mean(values);
    if (!Number.isFinite(value)) {
      return { value: 0, mode, provenance: `${axis} threshold mean overflowed; using zero`, fallback: true };
    }
    return { value, mode, provenance: `${axis} threshold: mean of ${values.length} visible points`, fallback: false };
  }
  if (mode === "fixed") {
    if (fixed !== undefined && Number.isFinite(fixed)) {
      return { value: fixed, mode, provenance: `${axis} threshold: fixed value ${formatNumber(fixed)}`, fallback: false };
    }
    return { value: 0, mode, provenance: `${axis} threshold: fixed value unavailable; using zero`, fallback: true };
  }
  if (mode === "benchmark") {
    if (benchmark !== undefined && Number.isFinite(benchmark)) {
      return { value: benchmark, mode, provenance: `${axis} threshold: benchmark ${formatNumber(benchmark)}`, fallback: false };
    }
    return { value: 0, mode, provenance: `${axis} threshold: benchmark unavailable; using zero`, fallback: true };
  }
  const value = median(values);
  return { value, mode: "median", provenance: `${axis} threshold: median of ${values.length} visible points`, fallback: false };
}

function classify(point: ValidPoint, xThreshold: number, yThreshold: number): ClassifiedPoint {
  const highX = point.x >= xThreshold;
  const highY = point.y >= yThreshold;
  const quadrant: Quadrant = highX && highY
    ? "upper-right"
    : !highX && highY
      ? "upper-left"
      : !highX && !highY
        ? "lower-left"
        : "lower-right";
  return {
    ...point,
    quadrant,
    onXThreshold: point.x === xThreshold,
    onYThreshold: point.y === yThreshold
  };
}

export function calculateRegression(points: readonly ValidPoint[]): Regression {
  const n = points.length;
  if (n < 2) {
    return { valid: false, n, reason: "At least two valid points are required." };
  }
  const xScale = maxAbsolute(points.map((point) => point.x));
  const yScale = maxAbsolute(points.map((point) => point.y));
  if (xScale === 0 || !Number.isFinite(xScale) || !Number.isFinite(yScale)) {
    return { valid: false, n, reason: "Regression is unavailable because an axis has no finite variance." };
  }
  const normalizedYScale = yScale || 1;
  const normalized = points.map((point) => ({ x: point.x / xScale, y: point.y / normalizedYScale }));
  const meanX = mean(normalized.map((point) => point.x));
  const meanY = mean(normalized.map((point) => point.y));
  const denominator = normalized.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (denominator === 0) {
    return { valid: false, n, reason: "Regression is unavailable because X has zero variance." };
  }
  const numerator = normalized.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const normalizedSlope = numerator / denominator;
  const slope = normalizeFloatingPoint(normalizedSlope * (normalizedYScale / xScale));
  const intercept = normalizeFloatingPoint(normalizedYScale * meanY - slope * (xScale * meanX));
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
    return { valid: false, n, reason: "Regression is unavailable because its coefficients are not finite." };
  }
  const total = normalized.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
  const r2 = total === 0
    ? 1
    : Math.min(1, Math.max(0, (numerator * numerator) / (denominator * total)));
  const sign = intercept < 0 ? "-" : "+";
  const equation = `y = ${formatNumber(slope)}x ${sign} ${formatNumber(Math.abs(intercept))}`;
  return { valid: true, n, slope, intercept, r2, equation };
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    ? value.toExponential(2)
    : value.toFixed(2).replace(/\.00$/, "");
}

export function buildScatterModel(rawPoints: readonly RawPoint[], settings: ThresholdSettings = {}): ScatterModel {
  const validPoints: ValidPoint[] = [];
  let invalidRows = 0;
  for (const raw of rawPoints) {
    const x = finiteNumber(raw.x);
    const y = finiteNumber(raw.y);
    if (x === undefined || y === undefined) {
      invalidRows++;
      continue;
    }
    const size = finiteNumber(raw.size);
    const gradient = finiteNumber(raw.gradient);
    validPoints.push({
      category: raw.category,
      x,
      y,
      size,
      gradient,
      series: raw.series,
      tooltips: raw.tooltips ?? {},
      identityKey: raw.identityKey,
      highlighted: raw.highlighted ?? false
    });
  }
  const xValues = validPoints.map((point) => point.x);
  const yValues = validPoints.map((point) => point.y);
  const xMode = settings.xMode ?? "median";
  const yMode = settings.yMode ?? "median";
  const xThreshold = threshold(xMode, xValues, settings.xFixed, settings.xBenchmark, "X");
  const yThreshold = threshold(yMode, yValues, settings.yFixed, settings.yBenchmark, "Y");
  const classified = validPoints.map((point) => classify(point, xThreshold.value, yThreshold.value));
  const counts: QuadrantCounts = {
    "upper-right": 0,
    "upper-left": 0,
    "lower-left": 0,
    "lower-right": 0
  };
  for (const point of classified) {
    counts[point.quadrant]++;
  }
  const requestedMaxPoints = settings.maxPoints;
  const maxPoints = requestedMaxPoints !== undefined && Number.isFinite(requestedMaxPoints)
    ? Math.min(DEFAULT_MAX_POINTS, Math.max(1, Math.floor(requestedMaxPoints)))
    : DEFAULT_MAX_POINTS;
  const points = classified.slice(0, maxPoints);
  const hasHighlights = settings.hasHighlights ?? rawPoints.some((point) => point.highlighted === true);
  return {
    points,
    validPoints,
    invalidRows,
    receivedCount: rawPoints.length,
    analyzedCount: validPoints.length,
    validCount: validPoints.length,
    renderedCount: points.length,
    reduced: validPoints.length > points.length,
    partialData: settings.partialData ?? false,
    hasHighlights,
    xThreshold,
    yThreshold,
    counts,
    boundaryCount: classified.filter((point) => point.onXThreshold || point.onYThreshold).length,
    regression: calculateRegression(validPoints)
  };
}
