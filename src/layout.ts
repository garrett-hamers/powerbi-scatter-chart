// Pure layout policy for the scatter visual. Nothing here touches the DOM, so the rules
// that decide what survives a shrinking tile can be asserted directly instead of being
// inferred from rendered output.
//
// The ordering rule is: decorative chrome degrades first, data degrades last. The chart
// and the accessible point table are the two things that carry data, and the table stays
// in the accessibility tree at every size even when there is no room to paint it.

export type SizeClass = "regular" | "narrow" | "short" | "micro";

export interface LayoutInputs {
  showSemanticTable: boolean;
  showLegend: boolean;
  showLabels: boolean;
  showThresholdLabels: boolean;
}

export interface LayoutPlan {
  sizeClass: SizeClass;
  chartHeight: number;
  tableHeight: number;
  showTable: boolean;
  showAnnotation: boolean;
  showCounts: boolean;
  showLegend: boolean;
  showQuadrantLabels: boolean;
  showThresholdLabels: boolean;
  showDataLabels: boolean;
  showDisclosure: boolean;
}

export interface ChromeRows {
  annotationY?: number;
  countsY?: number;
  legendY?: number;
  chromeBottom: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const LAYOUT_LIMITS = {
  minTableWidth: 200,
  minTableViewportHeight: 170,
  microWidth: 200,
  microHeight: 150,
  narrowWidth: 320,
  shortHeight: 240,
  minTableHeight: 60,
  maxTableHeight: 180,
  tableFraction: 0.34
} as const;

export function planLayout(width: number, height: number, inputs: LayoutInputs): LayoutPlan {
  const micro = width < LAYOUT_LIMITS.microWidth || height < LAYOUT_LIMITS.microHeight;
  const narrow = width < LAYOUT_LIMITS.narrowWidth;
  const short = height < LAYOUT_LIMITS.shortHeight;
  const sizeClass: SizeClass = micro ? "micro" : narrow ? "narrow" : short ? "short" : "regular";
  const showTable = inputs.showSemanticTable &&
    width >= LAYOUT_LIMITS.minTableWidth &&
    height >= LAYOUT_LIMITS.minTableViewportHeight;
  const tableHeight = showTable
    ? Math.min(
      LAYOUT_LIMITS.maxTableHeight,
      Math.max(LAYOUT_LIMITS.minTableHeight, Math.round(height * LAYOUT_LIMITS.tableFraction))
    )
    : 0;
  return {
    sizeClass,
    chartHeight: Math.max(1, height - tableHeight),
    tableHeight,
    showTable,
    showAnnotation: sizeClass === "regular",
    showCounts: !micro,
    showLegend: inputs.showLegend && !micro,
    showQuadrantLabels: !micro,
    showThresholdLabels: inputs.showThresholdLabels && !micro,
    showDataLabels: inputs.showLabels && !micro,
    showDisclosure: !micro
  };
}

export function annotationFontSize(width: number): number {
  return Math.min(13, Math.max(10, width / 80));
}

// Baselines are stacked from the ascender height downwards so the first row cannot push
// its own glyphs above the top of the clipped root.
export function planChromeRows(width: number, plan: LayoutPlan): ChromeRows {
  let cursor = 2;
  let annotationY: number | undefined;
  if (plan.showAnnotation) {
    cursor += Math.ceil(annotationFontSize(width));
    annotationY = cursor;
    cursor += 3;
  }
  let countsY: number | undefined;
  if (plan.showCounts) {
    cursor += 10;
    countsY = cursor;
    cursor += 4;
  }
  let legendY: number | undefined;
  if (plan.showLegend) {
    cursor += 10;
    legendY = cursor;
    cursor += 6;
  }
  return { annotationY, countsY, legendY, chromeBottom: cursor };
}

export function isCompact(width: number, chartHeight: number): boolean {
  return width < 280 || chartHeight < 190;
}

export function planMargins(width: number, chartHeight: number, chromeBottom: number): Margins {
  const compact = isCompact(width, chartHeight);
  return {
    top: Math.max(chromeBottom, compact ? 20 : Math.max(34, Math.min(64, chartHeight * 0.12))),
    right: compact ? 14 : Math.max(18, Math.min(56, width * 0.12)),
    bottom: compact ? 24 : Math.max(36, Math.min(58, chartHeight * 0.14)),
    left: compact ? 34 : Math.max(44, Math.min(72, width * 0.15))
  };
}

// A focus ring is drawn 2px outside the marker with a 2px offset, so the marker has to fit
// inside the surrounding margin or the ring leaves the clipped root on a small tile.
export function clampMarkerRadius(radius: number, margins: Margins): number {
  const room = Math.max(2, Math.min(margins.top, margins.bottom, margins.left, margins.right) - 5);
  return Math.max(2, Math.min(radius, room));
}

export const ELLIPSIS = "\u2026";

// SVG has no text-overflow, so chrome that would run past the plot is trimmed by
// measurement. The caller supplies the measurement so this stays testable without a DOM.
export function truncateToWidth(
  text: string,
  maxWidth: number,
  measure: (candidate: string) => number
): string {
  if (text.length === 0) {
    return text;
  }
  if (maxWidth <= 0) {
    return "";
  }
  if (measure(text) <= maxWidth) {
    return text;
  }
  let low = 0;
  let high = text.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}${ELLIPSIS}`) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}${ELLIPSIS}` : "";
}
