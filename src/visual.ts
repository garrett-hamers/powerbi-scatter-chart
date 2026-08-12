import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import {
  buildScatterModel,
  ClassifiedPoint,
  formatNumber,
  hasHighlightValues,
  isHighlightedValue,
  RawPoint,
  ScatterModel
} from "./domain";
import { buildFormattingModel, readVisualSettings, VisualSettings } from "./settings";
import {
  annotationFontSize,
  clampMarkerRadius,
  isCompact,
  LayoutPlan,
  planChromeRows,
  planLayout,
  planMargins,
  truncateToWidth
} from "./layout";

type ISelectionManager = ReturnType<powerbi.extensibility.visual.IVisualHost["createSelectionManager"]>;
type IVisual = powerbi.extensibility.visual.IVisual;
type IVisualHost = powerbi.extensibility.visual.IVisualHost;
type VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
type VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
type DataViewValueColumn = powerbi.DataViewValueColumn;
type ElementWithEvents = HTMLElement | SVGElement;
type HostSelectionId = powerbi.extensibility.ISelectionId;
type ISelectionId = powerbi.visuals.ISelectionId;

interface PointRecord {
  point: RawPoint;
  identity: ISelectionId;
}

interface RenderedPoint {
  point: ClassifiedPoint;
  record: PointRecord;
  element?: SVGCircleElement;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const palette = ["#0078d4", "#8764b8", "#107c10", "#d83b01", "#008272", "#5c2d91"];
const EMPTY_IDENTITY_KEY = "__empty__";

const translations: Record<string, Record<string, string>> = {
  en: {
    noData: "Add one Category, one numeric X measure, and one numeric Y measure.",
    invalid: "X and Y must contain finite numeric values. Invalid rows were excluded.",
    compact: "Increase the visual size to show the scatter plot.",
    threshold: "threshold",
    points: "points",
    received: "Received",
    analyzed: "analyzed",
    rendered: "rendered",
    reduced: "Power BI reduced the data window; showing a bounded sample.",
    partial: "The host supplied a bounded segment; additional rows were not requested.",
    regression: "Regression",
    unavailable: "unavailable",
    boundary: "on threshold",
    upperRight: "Upper right",
    upperLeft: "Upper left",
    lowerLeft: "Lower left",
    lowerRight: "Lower right",
    semanticTable: "Accessible point table",
    selected: "selected",
    highlighted: "highlighted",
    visible: "visible"
  },
  es: {
    noData: "Agregue una categoría, una medida X numérica y una medida Y numérica.",
    invalid: "X e Y deben contener valores numéricos finitos. Se excluyeron las filas no válidas.",
    compact: "Aumente el tamaño del objeto visual para mostrar el gráfico.",
    threshold: "umbral",
    points: "puntos",
    received: "Recibidos",
    analyzed: "analizados",
    rendered: "representados",
    reduced: "Power BI redujo la ventana de datos; se muestra una muestra limitada.",
    partial: "El host proporcionó un segmento limitado; no se solicitaron filas adicionales.",
    regression: "Regresión",
    unavailable: "no disponible",
    boundary: "en el umbral",
    upperRight: "Superior derecha",
    upperLeft: "Superior izquierda",
    lowerLeft: "Inferior izquierda",
    lowerRight: "Inferior derecha",
    semanticTable: "Tabla accesible de puntos",
    selected: "seleccionado",
    highlighted: "resaltado",
    visible: "visible"
  },
  fr: {
    noData: "Ajoutez une catégorie, une mesure X numérique et une mesure Y numérique.",
    invalid: "X et Y doivent contenir des valeurs numériques finies. Les lignes invalides sont exclues.",
    compact: "Agrandissez le visuel pour afficher le nuage de points.",
    threshold: "seuil",
    points: "points",
    received: "Reçus",
    analyzed: "analysés",
    rendered: "affichés",
    reduced: "Power BI a réduit la fenêtre de données ; un échantillon limité est affiché.",
    partial: "L’hôte a fourni un segment limité ; aucune ligne supplémentaire n’a été demandée.",
    regression: "Régression",
    unavailable: "indisponible",
    boundary: "sur le seuil",
    upperRight: "Supérieur droit",
    upperLeft: "Supérieur gauche",
    lowerLeft: "Inférieur gauche",
    lowerRight: "Inférieur droit",
    semanticTable: "Table accessible des points",
    selected: "sélectionné",
    highlighted: "mis en évidence",
    visible: "visible"
  }
};

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function htmlElement<K extends keyof HTMLElementTagNameMap>(name: K): HTMLElementTagNameMap[K] {
  return document.createElement(name);
}

function setText(element: Element, value: string): void {
  element.textContent = value;
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
}

// SVG has no text-overflow, so chrome that would run past the plot has to be trimmed by
// measurement. getComputedTextLength is exact once the node is in the live document; the
// character estimate is only a fallback for hosts that render the visual detached.
function measureTextWidth(element: SVGTextElement): number {
  try {
    const length = element.getComputedTextLength();
    if (Number.isFinite(length) && length > 0) {
      return length;
    }
  } catch {
    // Not laid out yet; fall through to the estimate.
  }
  const fontSize = Number(element.getAttribute("font-size")) || 10;
  return (element.textContent ?? "").length * fontSize * 0.55;
}

function fitText(element: SVGTextElement, maxWidth: number): void {
  const full = element.textContent ?? "";
  const fitted = truncateToWidth(full, maxWidth, (candidate) => {
    element.textContent = candidate;
    return measureTextWidth(element);
  });
  element.textContent = fitted;
}

function numericScale(value: number, min: number, max: number, outputMin: number, outputMax: number): number {
  const scale = Math.max(Math.abs(value), Math.abs(min), Math.abs(max), 1);
  const normalizedMin = min / scale;
  const normalizedMax = max / scale;
  const normalizedValue = value / scale;
  const denominator = normalizedMax - normalizedMin;
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return (outputMin + outputMax) / 2;
  }
  const ratio = (normalizedValue - normalizedMin) / denominator;
  return outputMin + ratio * (outputMax - outputMin);
}

function extent(values: readonly number[], thresholdValue: number): [number, number] {
  let min = thresholdValue;
  let max = thresholdValue;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (min === max) {
    const padding = Math.min(Math.max(Math.abs(min), 1) * 0.1, Number.MAX_VALUE / 4);
    min = Math.max(-Number.MAX_VALUE, min - padding);
    max = Math.min(Number.MAX_VALUE, max + padding);
  } else {
    const padding = Math.min(Math.max(Math.abs(min), Math.abs(max), 1) * 0.06, Number.MAX_VALUE / 4);
    min = Math.max(-Number.MAX_VALUE, min - padding);
    max = Math.min(Number.MAX_VALUE, max + padding);
  }
  return [min, max];
}

function numericRange(values: readonly number[]): [number, number] | undefined {
  if (values.length === 0) {
    return undefined;
  }
  let min = values[0];
  let max = values[0];
  for (const value of values.slice(1)) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}

function primitiveText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function hasRole(column: DataViewValueColumn, role: string): boolean {
  return column.source.roles?.[role] === true;
}

function findColumn(columns: readonly DataViewValueColumn[], role: string): DataViewValueColumn | undefined {
  return columns.find((column) => hasRole(column, role));
}

function columnLength(column: DataViewValueColumn | undefined): number {
  return Math.max(column?.values.length ?? 0, column?.highlights?.length ?? 0);
}

function valueAt(column: DataViewValueColumn | undefined, index: number): unknown {
  return column?.values[index];
}

function tooltipValues(columns: readonly DataViewValueColumn[], index: number): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of columns.filter((item) => hasRole(item, "Tooltips"))) {
    values[column.source.displayName || "Detail"] = valueAt(column, index);
  }
  return values;
}

function isComparableSelectionId(id: HostSelectionId): id is ISelectionId {
  return typeof id === "object" && id !== null &&
    typeof Reflect.get(id, "equals") === "function" &&
    typeof Reflect.get(id, "getKey") === "function";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class Visual implements IVisual {
  private readonly host: IVisualHost;
  private readonly selectionManager: ISelectionManager;
  private readonly localizationManager: powerbi.extensibility.ILocalizationManager;
  private readonly root: HTMLElement;
  private readonly listeners: Array<() => void> = [];
  private readonly renderListeners: Array<() => void> = [];
  private readonly identityByKey = new Map<string, ISelectionId>();
  private readonly renderedPoints = new Map<string, RenderedPoint>();
  private selectedKeys = new Set<string>();
  private model?: ScatterModel;
  private lastDataView?: powerbi.DataView;
  private lastUpdateOptions?: VisualUpdateOptions;
  private lastViewport = { width: 0, height: 0 };
  private lastSettings: VisualSettings = readVisualSettings();
  private locale = "en";
  private numberFormatter?: Intl.NumberFormat;
  private rtl = false;
  private reducedMotion = false;
  private allowInteractions = true;
  private contextMenuGestureHandled = false;
  private emptyLongPressTimer?: number;
  private pointLongPressTimer?: number;
  private touchTooltipTimer?: number;
  private focusedIdentityKey?: string;
  private tooltipIdentityKey?: string;
  private tooltipIsTouch = false;
  private destroyed = false;
  private chartWidth = 0;

  constructor(options?: VisualConstructorOptions) {
    if (!options) {
      throw new Error("Visual constructor options are required.");
    }
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager();
    this.localizationManager = this.host.createLocalizationManager();
    this.allowInteractions = this.host.hostCapabilities.allowInteractions !== false;
    this.root = options.element;
    this.root.className = "atlyn-scatter";
    this.locale = this.host.locale.toLowerCase().slice(0, 2);
    try {
      this.numberFormatter = new Intl.NumberFormat(this.host.locale, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0
      });
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
    }
    this.rtl = this.isRtl();
    this.reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    this.root.setAttribute("dir", this.rtl ? "rtl" : "ltr");
    this.root.setAttribute("data-reduced-motion", String(this.reducedMotion));
    this.root.setAttribute("data-high-contrast", String(this.host.colorPalette.isHighContrast));
    this.root.setAttribute("role", "application");
    this.root.setAttribute("aria-label", "Atlyn Scatter");
    this.root.tabIndex = 0;
    this.selectionManager.registerOnSelectCallback((ids) => {
      if (this.destroyed) {
        return;
      }
      this.selectedKeys = this.keysForSelection(ids);
      this.rerenderFromLastData();
    });
    this.addListener(this.root, "click", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || (target !== this.root && target.closest(".atlyn-scatter__point"))) {
        return;
      }
      void this.clearSelection();
    }, true);
    this.addListener(this.root, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        void this.clearSelection();
      }
    }, true);
    this.addListener(this.root, "focusin", (event) => {
      const target = event.target;
      if (target instanceof Element && target.classList.contains("atlyn-scatter__point")) {
        this.focusedIdentityKey = target.getAttribute("data-identity-key") ?? undefined;
      }
    }, true);
  }

  public update(options: VisualUpdateOptions): void {
    if (this.destroyed) {
      return;
    }
    this.lastUpdateOptions = options;
    this.renderingStarted(options);
    try {
      const view = options.dataViews?.[0];
      this.lastDataView = view;
      this.lastViewport = { width: options.viewport.width, height: options.viewport.height };
      const records = this.readPoints(view);
      this.lastSettings = readVisualSettings(view);
      this.model = buildScatterModel(records.map((record) => record.point), {
        ...this.lastSettings,
        hasHighlights: this.hasHighlightData(view),
        partialData: view?.metadata.segment !== undefined
      });
      this.render(options.viewport.width, options.viewport.height, records, this.lastSettings);
      this.renderingFinished(options);
    } catch (error) {
      this.renderError(options, error);
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.clearEmptyLongPress();
    this.clearPointLongPress();
    this.clearTouchTooltip();
    this.hideTooltip();
    for (const remove of this.listeners.splice(0)) {
      remove();
    }
    this.clearRenderListeners();
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    this.identityByKey.clear();
    this.renderedPoints.clear();
    this.selectedKeys.clear();
    this.focusedIdentityKey = undefined;
    this.tooltipIdentityKey = undefined;
    this.model = undefined;
    this.lastDataView = undefined;
    this.lastUpdateOptions = undefined;
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    return buildFormattingModel(this.lastSettings, (key) => this.t(key));
  }

  private hasHighlightData(dataView: powerbi.DataView | undefined): boolean {
    const values = dataView?.categorical?.values;
    if (!values) {
      return false;
    }
    if (values.some((column) => hasHighlightValues(column.highlights))) {
      return true;
    }
    return values.grouped().some((group) => group.values.some((column) => hasHighlightValues(column.highlights)));
  }

  private readPoints(dataView: powerbi.DataView | undefined): PointRecord[] {
    const categorical = dataView?.categorical;
    const category = categorical?.categories?.[0];
    const values = categorical?.values;
    if (!category || !values || category.values.length === 0) {
      return [];
    }

    const grouped = values.grouped();
    const useGroups = grouped.length > 1 || grouped.some((group) => group.name !== undefined || group.identity !== undefined);
    const records: PointRecord[] = [];
    this.identityByKey.clear();

    if (useGroups) {
      const orderedGroups = [...grouped].sort((left, right) =>
        compareText(primitiveText(left.name), primitiveText(right.name))
      );
      for (const group of orderedGroups) {
        const groupX = findColumn(group.values, "X");
        const groupY = findColumn(group.values, "Y");
        if (!groupX || !groupY) {
          continue;
        }
        const groupSize = findColumn(group.values, "Size");
        const groupGradient = findColumn(group.values, "Gradient");
        const count = Math.min(
          category.values.length,
          Math.max(columnLength(groupX), columnLength(groupY), columnLength(groupSize), columnLength(groupGradient))
        );
        const seriesName = group.name === undefined ? undefined : primitiveText(group.name);
        for (let index = 0; index < count; index++) {
          const identity = this.host.createSelectionIdBuilder()
            .withCategory(category, index)
            .withSeries(values, group)
            .createSelectionId();
          const identityKey = identity.getKey();
          this.identityByKey.set(identityKey, identity);
          const sourceColumns = group.values;
          const highlighted = sourceColumns.some((column) => isHighlightedValue(column.highlights?.[index]));
          records.push({
            identity,
            point: {
              category: primitiveText(category.values[index]),
              x: valueAt(groupX, index),
              y: valueAt(groupY, index),
              size: valueAt(groupSize, index),
              gradient: valueAt(groupGradient, index),
              series: seriesName,
              tooltips: tooltipValues(sourceColumns, index),
              identityKey,
              highlighted
            }
          });
        }
      }
      if (records.length > 0) {
        return records.sort((left, right) =>
          compareText(left.point.series ?? "", right.point.series ?? "") ||
          compareText(left.point.category, right.point.category) ||
          compareText(left.point.identityKey ?? "", right.point.identityKey ?? "")
        );
      }
    }

    const xColumn = findColumn(values, "X");
    const yColumn = findColumn(values, "Y");
    if (!xColumn || !yColumn) {
      return [];
    }
    const sizeColumn = findColumn(values, "Size");
    const gradientColumn = findColumn(values, "Gradient");
    const seriesColumn = findColumn(values, "Series");
    const count = Math.min(
      category.values.length,
      Math.max(columnLength(xColumn), columnLength(yColumn), columnLength(sizeColumn), columnLength(gradientColumn), columnLength(seriesColumn))
    );
    for (let index = 0; index < count; index++) {
      const builder = this.host.createSelectionIdBuilder().withCategory(category, index);
      if (seriesColumn) {
        builder.withSeries(values, seriesColumn);
      }
      const identity = builder.createSelectionId();
      const identityKey = identity.getKey();
      this.identityByKey.set(identityKey, identity);
      const highlighted = values.some((column) => isHighlightedValue(column.highlights?.[index]));
      records.push({
        identity,
        point: {
          category: primitiveText(category.values[index]),
          x: valueAt(xColumn, index),
          y: valueAt(yColumn, index),
          size: valueAt(sizeColumn, index),
          gradient: valueAt(gradientColumn, index),
          series: seriesColumn ? primitiveText(valueAt(seriesColumn, index)) : undefined,
          tooltips: tooltipValues(values, index),
          identityKey,
          highlighted
        }
      });
    }
    return records.sort((left, right) =>
      compareText(left.point.series ?? "", right.point.series ?? "") ||
      compareText(left.point.category, right.point.category) ||
      compareText(left.point.identityKey ?? "", right.point.identityKey ?? "")
    );
  }

  private render(
    width: number,
    height: number,
    records: PointRecord[],
    settings: VisualSettings
  ): void {
    const focusKey = this.focusedIdentityKey;
    this.clearRenderListeners();
    this.clearEmptyLongPress();
    this.clearPointLongPress();
    this.clearTouchTooltip();
    this.hideTooltip();
    this.renderedPoints.clear();
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    const model = this.model;
    if (!model || records.length === 0) {
      this.root.setAttribute("data-size", "micro");
      this.appendMessage(this.t("noData"));
      this.restoreFocus(focusKey);
      return;
    }
    if (model.validCount === 0) {
      this.root.setAttribute("data-size", "micro");
      this.appendMessage(this.t("invalid"));
      this.renderSemanticTable(model, false, 0);
      this.restoreFocus(focusKey);
      return;
    }
    if (width < 80 || height < 80) {
      this.root.setAttribute("data-size", "micro");
      this.appendMessage(this.t("compact"));
      this.renderSemanticTable(model, false, 0);
      this.restoreFocus(focusKey);
      return;
    }

    const plan = planLayout(width, height, settings);
    const chartHeight = plan.chartHeight;
    this.chartWidth = width;
    this.root.setAttribute("data-size", plan.sizeClass);
    const svg = svgElement("svg");
    svg.classList.add("atlyn-scatter__svg");
    setAttributes(svg, {
      viewBox: `0 0 ${width} ${chartHeight}`,
      width,
      height: chartHeight,
      preserveAspectRatio: "none",
      role: "img",
      "aria-label": this.summaryLabel(model),
      // The SVG deliberately stays in an LTR coordinate space. Setting direction: rtl here
      // would flip what text-anchor start/end mean, and every x coordinate below already
      // mirrors itself explicitly, so the two flips would cancel out into overflow.
      direction: "ltr",
      "data-reduced-motion": String(this.reducedMotion)
    });
    this.addListener(svg, "contextmenu", (event) => {
      event.preventDefault();
      if (this.contextMenuGestureHandled) {
        return;
      }
      const rendered = this.renderedPointFromEvent(event);
      this.showContextMenu(rendered?.record.identity, event);
    });
    this.addListener(svg, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      this.contextMenuGestureHandled = false;
      if (pointer.pointerType !== "touch") {
        return;
      }
      const rendered = this.renderedPointFromEvent(event);
      if (rendered) {
        this.clearPointLongPress();
        this.clearTouchTooltip();
        this.touchTooltipTimer = window.setTimeout(() => {
          this.showTooltip(rendered.point, rendered.record.identity, pointer);
        }, 350);
        this.pointLongPressTimer = window.setTimeout(() => {
          this.clearTouchTooltip();
          this.showContextMenu(rendered.record.identity, pointer);
        }, 650);
      } else {
        this.emptyLongPressTimer = window.setTimeout(() => this.showContextMenu(undefined, pointer), 650);
      }
    });
    this.addListener(svg, "pointermove", (event) => {
      const rendered = this.renderedPointFromEvent(event);
      if (rendered && this.tooltipIdentityKey === rendered.record.point.identityKey) {
        this.moveTooltip(event);
      }
    });
    this.addListener(svg, "pointerover", (event) => {
      const rendered = this.renderedPointFromEvent(event);
      if (rendered) {
        this.showTooltip(rendered.point, rendered.record.identity, event);
      }
    });
    this.addListener(svg, "pointerout", (event) => {
      const rendered = this.renderedPointFromEvent(event);
      const related = (event as PointerEvent).relatedTarget;
      if (rendered && (!(related instanceof Element) || !related.closest(".atlyn-scatter__point"))) {
        this.hideTooltip(event);
      }
    });
    this.addListener(svg, "focusin", (event) => {
      const rendered = this.renderedPointFromEvent(event);
      if (rendered) {
        this.showTooltip(rendered.point, rendered.record.identity, event);
      }
    });
    this.addListener(svg, "focusout", (event) => this.hideTooltip(event));
    this.addListener(svg, "click", (event) => {
      const rendered = this.renderedPointFromEvent(event);
      if (rendered) {
        event.stopPropagation();
        void this.select(rendered.record.identity, event as MouseEvent);
      } else if (event.target === svg) {
        void this.clearSelection();
      }
    });
    this.addListener(svg, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      const rendered = this.renderedPointFromEvent(event);
      if (!rendered) {
        return;
      }
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        void this.select(rendered.record.identity, keyboardEvent);
      } else if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        void this.clearSelection();
      } else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(keyboardEvent.key)) {
        keyboardEvent.preventDefault();
        this.moveFocus(Number(rendered.element.getAttribute("data-point-index") ?? 0), keyboardEvent.key);
      }
    });
    this.addListener(svg, "pointerup", () => {
      this.clearEmptyLongPress();
      this.clearPointLongPress();
      this.clearTouchTooltip();
    });
    this.addListener(svg, "pointercancel", () => {
      this.clearEmptyLongPress();
      this.clearPointLongPress();
      this.clearTouchTooltip();
    });
    this.addListener(svg, "pointerleave", () => {
      this.clearEmptyLongPress();
      this.clearPointLongPress();
      this.clearTouchTooltip();
    });
    this.root.appendChild(svg);

    // Chrome rows are laid out top-down from the ascender height so the first baseline
    // cannot push its own glyphs above the viewport, and the plot starts below whatever
    // chrome survived the size class.
    const { annotationY, countsY, legendY, chromeBottom } = planChromeRows(width, plan);
    const compact = isCompact(width, chartHeight);
    const margin = planMargins(width, chartHeight, chromeBottom);
    const plotWidth = Math.max(20, width - margin.left - margin.right);
    const plotHeight = Math.max(20, chartHeight - margin.top - margin.bottom);
    const xExtent = extent(model.validPoints.map((point) => point.x), model.xThreshold.value);
    const yExtent = extent(model.validPoints.map((point) => point.y), model.yThreshold.value);
    const x = (value: number) => numericScale(
      value,
      xExtent[0],
      xExtent[1],
      this.rtl ? margin.left + plotWidth : margin.left,
      this.rtl ? margin.left : margin.left + plotWidth
    );
    const y = (value: number) => numericScale(value, yExtent[0], yExtent[1], margin.top + plotHeight, margin.top);

    const defs = svgElement("defs");
    const pattern = svgElement("pattern");
    setAttributes(pattern, { id: "atlyn-hatch", width: 8, height: 8, patternUnits: "userSpaceOnUse" });
    const patternLine = svgElement("path");
    setAttributes(patternLine, {
      d: "M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6",
      stroke: this.host.colorPalette.isHighContrast ? this.host.colorPalette.foreground.value : "currentColor",
      "stroke-width": 1,
      opacity: 0.22
    });
    pattern.appendChild(patternLine);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    this.drawQuadrants(svg, model, x, y, xExtent, yExtent, margin, plotWidth, plotHeight, settings, plan);
    this.drawAxes(svg, x, y, xExtent, yExtent, margin, plotWidth, plotHeight, settings);
    if (settings.showRegression && model.regression.valid) {
      this.drawRegression(svg, model, x, y, xExtent);
    }
    const recordsByKey = new Map(records.map((record) => [record.point.identityKey ?? EMPTY_IDENTITY_KEY, record]));
    const seriesValues = [...new Set(model.points
      .map((point) => point.series)
      .filter((value): value is string => value !== undefined))]
      .sort(compareText);
    const sizeValues = model.points.map((point) => point.size).filter((value): value is number => value !== undefined);
    const sizeRange = numericRange(sizeValues) ?? [0, 1];
    const sizeMin = sizeRange[0];
    const sizeMax = sizeRange[1];
    const gradientValues = model.points.map((point) => point.gradient).filter((value): value is number => value !== undefined);
    const gradientRange = numericRange(gradientValues) ?? [0, 1];
    const gradientMin = gradientRange[0];
    const gradientMax = gradientRange[1];
    model.points.forEach((point, index) => {
      const record = recordsByKey.get(point.identityKey ?? EMPTY_IDENTITY_KEY);
      if (record) {
        const key = point.identityKey ?? `${EMPTY_IDENTITY_KEY}-${index}`;
        this.renderedPoints.set(key, { point, record });
        this.drawPoint(
          svg,
          point,
          index,
          x,
          y,
          point.series === undefined ? 0 : Math.max(0, seriesValues.indexOf(point.series)),
          sizeMin,
          sizeMax,
          gradientMin,
          gradientMax,
          model.hasHighlights,
          settings,
          margin,
          plotWidth,
          plan
        );
      }
    });
    if (legendY !== undefined) {
      this.drawLegend(svg, model, width, margin, legendY);
    }
    this.drawAnnotations(svg, model, margin, width, settings.showRegression, annotationY, countsY);
    if (plan.showDisclosure && (model.reduced || model.partialData || model.invalidRows > 0)) {
      const disclosure = svgElement("text");
      setAttributes(disclosure, {
        x: this.rtl ? width - margin.right : margin.left,
        y: chartHeight - 8,
        "font-size": compact ? 8 : 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      const reasons = [
        model.reduced ? this.t("reduced") : "",
        model.partialData ? this.t("partial") : "",
        model.invalidRows > 0 ? this.t("invalid") : ""
      ].filter(Boolean).join(" ");
      setText(
        disclosure,
        `${this.t("received")} ${model.receivedCount}; ${this.t("analyzed")} ${model.analyzedCount}; ` +
        `${this.t("rendered")} ${model.renderedCount}. ${reasons}`
      );
      svg.appendChild(disclosure);
      fitText(disclosure, Math.max(0, width - margin.left - margin.right));
    }
    this.renderSemanticTable(model, plan.showTable, plan.tableHeight);
    this.restoreFocus(focusKey);
  }

  private appendMessage(text: string): void {
    const message = htmlElement("div");
    message.className = "atlyn-scatter__message";
    setAttributes(message, { role: "status", "aria-live": "polite" });
    setText(message, text);
    this.root.appendChild(message);
  }

  private drawQuadrants(
    svg: SVGSVGElement,
    model: ScatterModel,
    x: (value: number) => number,
    y: (value: number) => number,
    xExtent: [number, number],
    yExtent: [number, number],
    margin: { top: number; right: number; bottom: number; left: number },
    plotWidth: number,
    plotHeight: number,
    settings: VisualSettings,
    plan: LayoutPlan
  ): void {
    const xMid = x(model.xThreshold.value);
    const yMid = y(model.yThreshold.value);
    const xRange = (low: number, high: number): { x: number; width: number } => {
      const start = x(low);
      const end = x(high);
      return { x: Math.min(start, end), width: Math.abs(end - start) };
    };
    const yRange = (low: number, high: number): { y: number; height: number } => {
      const start = y(low);
      const end = y(high);
      return { y: Math.min(start, end), height: Math.abs(end - start) };
    };
    const lowX = xRange(xExtent[0], model.xThreshold.value);
    const highX = xRange(model.xThreshold.value, xExtent[1]);
    const lowY = yRange(yExtent[0], model.yThreshold.value);
    const highY = yRange(model.yThreshold.value, yExtent[1]);
    const rects: Array<{
      quadrant: ClassifiedPoint["quadrant"];
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [
      { quadrant: "upper-left", x: lowX.x, y: highY.y, width: lowX.width, height: highY.height },
      { quadrant: "upper-right", x: highX.x, y: highY.y, width: highX.width, height: highY.height },
      { quadrant: "lower-left", x: lowX.x, y: lowY.y, width: lowX.width, height: lowY.height },
      { quadrant: "lower-right", x: highX.x, y: lowY.y, width: highX.width, height: lowY.height }
    ];
    const colors = ["#deecf9", "#dff6dd", "#fce4ec", "#fff4ce"];
    if (settings.showQuadrants) {
      rects.forEach((item, index) => {
        const rect = svgElement("rect");
        setAttributes(rect, {
          x: item.x,
          y: item.y,
          width: Math.max(0, item.width),
          height: Math.max(0, item.height),
          fill: this.host.colorPalette.isHighContrast ? this.host.colorPalette.background.value : colors[index],
          opacity: this.host.colorPalette.isHighContrast ? 1 : 0.55
        });
        svg.appendChild(rect);
        const hatch = svgElement("rect");
        setAttributes(hatch, {
          x: item.x,
          y: item.y,
          width: Math.max(0, item.width),
          height: Math.max(0, item.height),
          fill: "url(#atlyn-hatch)",
          "aria-hidden": "true"
        });
        svg.appendChild(hatch);
        if (!plan.showQuadrantLabels || item.width < 34) {
          return;
        }
        const label = svgElement("text");
        setAttributes(label, {
          x: this.rtl ? item.x + item.width - 7 : item.x + 7,
          y: item.y + 16,
          "font-size": 10,
          fill: this.textColor(),
          "text-anchor": this.rtl ? "end" : "start"
        });
        setText(label, `${this.quadrantLabel(item.quadrant)} (${model.counts[item.quadrant]})`);
        svg.appendChild(label);
        fitText(label, Math.max(0, item.width - 14));
      });
    }
    const xLine = svgElement("line");
    setAttributes(xLine, {
      x1: xMid,
      x2: xMid,
      y1: margin.top,
      y2: margin.top + plotHeight,
      stroke: this.textColor(),
      "stroke-dasharray": "5 4",
      "stroke-width": 1
    });
    const yLine = svgElement("line");
    setAttributes(yLine, {
      x1: margin.left,
      x2: margin.left + plotWidth,
      y1: yMid,
      y2: yMid,
      stroke: this.textColor(),
      "stroke-dasharray": "5 4",
      "stroke-width": 1
    });
    svg.append(xLine, yLine);
    if (plan.showThresholdLabels) {
      const xLabel = svgElement("text");
      setAttributes(xLabel, {
        x: this.rtl ? xMid - 4 : xMid + 4,
        y: margin.top + plotHeight - 4,
        "font-size": 9,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(xLabel, `${this.t("threshold")} ${this.formatValue(model.xThreshold.value)}`);
      const yLabel = svgElement("text");
      setAttributes(yLabel, {
        x: this.rtl ? margin.left + plotWidth - 4 : margin.left + 4,
        y: yMid - 4,
        "font-size": 9,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(yLabel, `${this.t("threshold")} ${this.formatValue(model.yThreshold.value)}`);
      svg.append(xLabel, yLabel);
      fitText(xLabel, Math.max(0, this.rtl ? xMid - 4 - margin.left : margin.left + plotWidth - xMid - 4));
      fitText(yLabel, Math.max(0, plotWidth - 8));
    }
  }

  private drawAxes(
    svg: SVGSVGElement,
    x: (value: number) => number,
    y: (value: number) => number,
    xExtent: [number, number],
    yExtent: [number, number],
    margin: { top: number; right: number; bottom: number; left: number },
    plotWidth: number,
    plotHeight: number,
    settings: VisualSettings
  ): void {
    if (!settings.showAxes) {
      return;
    }
    const axisColor = this.textColor();
    const yAxisX = this.rtl ? margin.left + plotWidth : margin.left;
    const xAxis = svgElement("line");
    setAttributes(xAxis, {
      x1: margin.left,
      x2: margin.left + plotWidth,
      y1: margin.top + plotHeight,
      y2: margin.top + plotHeight,
      stroke: axisColor
    });
    const yAxis = svgElement("line");
    setAttributes(yAxis, {
      x1: yAxisX,
      x2: yAxisX,
      y1: margin.top,
      y2: margin.top + plotHeight,
      stroke: axisColor
    });
    svg.append(xAxis, yAxis);
    if (!settings.showAxisLabels) {
      return;
    }
    const xStart = svgElement("text");
    setAttributes(xStart, {
      x: x(xExtent[0]),
      y: margin.top + plotHeight + 16,
      "font-size": 10,
      "text-anchor": this.rtl ? "end" : "start",
      fill: axisColor
    });
    setText(xStart, this.formatValue(xExtent[0]));
    const xEnd = svgElement("text");
    setAttributes(xEnd, {
      x: x(xExtent[1]),
      y: margin.top + plotHeight + 16,
      "font-size": 10,
      "text-anchor": this.rtl ? "start" : "end",
      fill: axisColor
    });
    setText(xEnd, this.formatValue(xExtent[1]));
    const yStart = svgElement("text");
    setAttributes(yStart, {
      x: this.rtl ? yAxisX + 6 : yAxisX - 6,
      y: y(yExtent[0]),
      "font-size": 10,
      "text-anchor": this.rtl ? "start" : "end",
      fill: axisColor
    });
    setText(yStart, this.formatValue(yExtent[0]));
    const yEnd = svgElement("text");
    setAttributes(yEnd, {
      x: this.rtl ? yAxisX + 6 : yAxisX - 6,
      y: y(yExtent[1]),
      "font-size": 10,
      "text-anchor": this.rtl ? "start" : "end",
      fill: axisColor
    });
    setText(yEnd, this.formatValue(yExtent[1]));
    svg.append(xStart, xEnd, yStart, yEnd);
    // Axis extremes are anchored at the plot edge, so the space available runs back toward
    // the nearest root edge; a long formatted number would otherwise leave the viewport.
    fitText(xStart, Math.max(0, this.rtl ? x(xExtent[0]) : plotWidth));
    fitText(xEnd, Math.max(0, this.rtl ? plotWidth : x(xExtent[1])));
    const sideRoom = this.rtl ? Math.max(0, this.chartWidth - yAxisX - 6) : Math.max(0, yAxisX - 6);
    fitText(yStart, sideRoom);
    fitText(yEnd, sideRoom);
  }

  private drawRegression(
    svg: SVGSVGElement,
    model: ScatterModel,
    x: (value: number) => number,
    y: (value: number) => number,
    xExtent: [number, number]
  ): void {
    const regression = model.regression;
    if (!regression.valid || regression.slope === undefined || regression.intercept === undefined) {
      return;
    }
    const line = svgElement("line");
    setAttributes(line, {
      x1: x(xExtent[0]),
      y1: y(regression.slope * xExtent[0] + regression.intercept),
      x2: x(xExtent[1]),
      y2: y(regression.slope * xExtent[1] + regression.intercept),
      stroke: this.host.colorPalette.isHighContrast ? this.host.colorPalette.foreground.value : "#333333",
      "stroke-width": 2,
      "stroke-dasharray": "7 3"
    });
    svg.appendChild(line);
  }

  private drawPoint(
    svg: SVGSVGElement,
    point: ClassifiedPoint,
    index: number,
    x: (value: number) => number,
    y: (value: number) => number,
    seriesIndex: number,
    sizeMin: number,
    sizeMax: number,
    gradientMin: number,
    gradientMax: number,
    hasHighlights: boolean,
    settings: VisualSettings,
    margin: { top: number; right: number; bottom: number; left: number },
    plotWidth: number,
    plan: LayoutPlan
  ): void {
    const circle = svgElement("circle");
    const rawRadius = point.size === undefined
      ? Math.max(settings.minMarkerSize, 5)
      : numericScale(point.size, sizeMin, sizeMax, settings.minMarkerSize, settings.maxMarkerSize);
    // Cap the marker against the surrounding margins so a focus ring on an extreme point
    // cannot push its outline outside the clipped root on a small tile.
    const radius = clampMarkerRadius(rawRadius, margin);
    const highContrast = this.host.colorPalette.isHighContrast;
    const selected = point.identityKey !== undefined && this.selectedKeys.has(point.identityKey);
    const fill = highContrast
      ? this.host.colorPalette.background.value
      : this.colorFor(point, seriesIndex, gradientMin, gradientMax);
    const stroke = highContrast
      ? selected ? this.host.colorPalette.foregroundSelected.value : this.host.colorPalette.foreground.value
      : selected ? "currentColor" : "white";
    const opacity = hasHighlights && !point.highlighted ? 0.22 : selected ? 1 : settings.markerOpacity;
    setAttributes(circle, {
      cx: x(point.x),
      cy: y(point.y),
      r: radius,
      fill,
      stroke,
      "stroke-width": selected ? 3 : highContrast ? 2 : 1,
      "stroke-dasharray": highContrast && !selected ? "3 2" : "",
      opacity,
      tabindex: index === 0 ? 0 : -1,
      role: "button",
      "aria-label": this.pointLabel(point),
      "aria-pressed": String(selected),
      "data-point-index": index,
      "data-identity-key": point.identityKey ?? `${EMPTY_IDENTITY_KEY}-${index}`,
      "data-selected": String(selected)
    });
    circle.classList.add("atlyn-scatter__point");
    if (selected) {
      circle.classList.add("atlyn-scatter__point--selected");
    }
    svg.appendChild(circle);

    const stride = Math.max(1, Math.round(100 / settings.labelDensity));
    if (plan.showDataLabels && index % stride === 0) {
      const labelX = x(point.x) + (this.rtl ? -radius - 2 : radius + 2);
      const room = this.rtl
        ? labelX - margin.left
        : margin.left + plotWidth - labelX;
      if (room < 12) {
        return;
      }
      const label = svgElement("text");
      setAttributes(label, {
        x: labelX,
        y: y(point.y) - radius - 2,
        "font-size": 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(label, point.category);
      svg.appendChild(label);
      fitText(label, room);
    }
  }

  private drawLegend(
    svg: SVGSVGElement,
    model: ScatterModel,
    width: number,
    margin: { top: number; right: number; bottom: number; left: number },
    baselineY: number
  ): void {
    const seriesValues = [...new Set(model.points.map((point) => point.series).filter((value): value is string => value !== undefined))];
    seriesValues.sort(compareText);
    if (seriesValues.length === 0) {
      return;
    }
    // Chips are placed by measured width and stop at the edge of the plot. A fixed stride
    // marches later series straight out of the clipped viewport as the tile narrows.
    const available = Math.max(0, width - margin.left - margin.right);
    const startX = this.rtl ? width - margin.right : margin.left;
    const radius = 4;
    const gap = 12;
    let cursor = 0;
    let placed = 0;
    for (let index = 0; index < seriesValues.length; index += 1) {
      const series = seriesValues[index];
      const label = svgElement("text");
      setAttributes(label, {
        "font-size": 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(label, series);
      svg.appendChild(label);
      const labelWidth = measureTextWidth(label);
      const chipWidth = radius * 2 + 4 + labelWidth;
      const reserve = index < seriesValues.length - 1 ? 32 : 0;
      if (placed > 0 && cursor + chipWidth > available - reserve) {
        svg.removeChild(label);
        break;
      }
      const markerX = this.rtl ? startX - cursor - radius : startX + cursor + radius;
      const marker = svgElement("circle");
      setAttributes(marker, {
        cx: markerX,
        cy: baselineY - 3,
        r: radius,
        fill: this.host.colorPalette.isHighContrast ? this.host.colorPalette.background.value : this.colorFor({ series, gradient: undefined }, index, 0, 1),
        stroke: this.host.colorPalette.isHighContrast ? this.host.colorPalette.foreground.value : "currentColor",
        "stroke-width": 1
      });
      svg.insertBefore(marker, label);
      setAttributes(label, {
        x: this.rtl ? markerX - radius - 4 : markerX + radius + 4,
        y: baselineY
      });
      fitText(label, Math.max(0, available - cursor - radius * 2 - 4 - reserve));
      cursor += chipWidth + gap;
      placed += 1;
    }
    if (placed < seriesValues.length) {
      const more = svgElement("text");
      setAttributes(more, {
        x: this.rtl ? startX - cursor : startX + cursor,
        y: baselineY,
        "font-size": 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(more, `+${seriesValues.length - placed}`);
      svg.appendChild(more);
      fitText(more, Math.max(0, available - cursor));
    }
  }

  private drawAnnotations(
    svg: SVGSVGElement,
    model: ScatterModel,
    margin: { top: number; right: number; bottom: number; left: number },
    width: number,
    showRegression: boolean,
    annotationY: number | undefined,
    countsY: number | undefined
  ): void {
    const available = Math.max(0, width - margin.left - margin.right);
    const anchorX = this.rtl ? width - margin.right : margin.left;
    const group = svgElement("g");
    svg.appendChild(group);
    if (annotationY !== undefined) {
      const annotation = svgElement("text");
      setAttributes(annotation, {
        x: anchorX,
        y: annotationY,
        "font-size": annotationFontSize(width),        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      const regressionText = showRegression
        ? model.regression.valid
          ? `${this.t("regression")}: ${model.regression.equation}; R2 ${this.formatValue(model.regression.r2 ?? 0)}; n=${model.regression.n}`
          : `${this.t("regression")}: ${this.t("unavailable")} (${model.regression.reason ?? ""})`
        : "";
      setText(annotation, `${model.xThreshold.provenance}; ${model.yThreshold.provenance}. ${regressionText}`);
      group.appendChild(annotation);
      fitText(annotation, available);
    }
    if (countsY !== undefined) {
      const countText = svgElement("text");
      setAttributes(countText, {
        x: anchorX,
        y: countsY,
        "font-size": 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      const selectedSummary = this.selectedKeys.size ? ` · ${this.t("selected")} ${this.selectedKeys.size}` : "";
      setText(
        countText,
        `${this.quadrantLabel("upper-right")}: ${model.counts["upper-right"]} · ` +
        `${this.quadrantLabel("upper-left")}: ${model.counts["upper-left"]} · ` +
        `${this.quadrantLabel("lower-left")}: ${model.counts["lower-left"]} · ` +
        `${this.quadrantLabel("lower-right")}: ${model.counts["lower-right"]} · ` +
        `${model.boundaryCount} ${this.t("boundary")}${selectedSummary}`
      );
      group.appendChild(countText);
      fitText(countText, available);
    }
  }

  private renderSemanticTable(model: ScatterModel, visible: boolean, maxHeight: number): void {
    const wrapper = htmlElement("div");
    wrapper.className = `atlyn-scatter__table${visible ? "" : " atlyn-scatter__table--visually-hidden"}`;
    if (visible) {
      wrapper.style.height = `${maxHeight}px`;
      wrapper.style.maxHeight = `${maxHeight}px`;
    }
    const table = htmlElement("table");
    table.className = "atlyn-scatter__semantic-table";
    const caption = htmlElement("caption");
    setText(caption, `${this.t("semanticTable")} (${this.t("rendered")} ${model.renderedCount})`);
    table.appendChild(caption);
    const head = htmlElement("thead");
    const headRow = htmlElement("tr");
    ["Category", "X", "Y", "Quadrant", "Status"].forEach((label) => {
      const cell = htmlElement("th");
      cell.scope = "col";
      setText(cell, label);
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = htmlElement("tbody");
    model.points.slice(0, 500).forEach((point) => {
      const row = htmlElement("tr");
      const values = [point.category, this.formatValue(point.x), this.formatValue(point.y), this.quadrantLabel(point.quadrant), this.pointStatus(point)];
      values.forEach((value) => {
        const cell = htmlElement("td");
        setText(cell, value);
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    this.root.appendChild(wrapper);
  }

  private pointLabel(point: ClassifiedPoint): string {
    const boundary = point.onXThreshold || point.onYThreshold ? `, ${this.t("boundary")}` : "";
    const series = point.series ? `, ${point.series}` : "";
    return `${point.category}${series}: X ${this.formatValue(point.x)}, Y ${this.formatValue(point.y)}, ${this.quadrantLabel(point.quadrant)}${boundary}`;
  }

  private pointStatus(point: ClassifiedPoint): string {
    if (point.identityKey !== undefined && this.selectedKeys.has(point.identityKey)) {
      return this.t("selected");
    }
    return point.onXThreshold || point.onYThreshold
      ? this.t("boundary")
      : point.highlighted
        ? this.t("highlighted")
        : this.t("visible");
  }

  private summaryLabel(model: ScatterModel): string {
    return `Atlyn Scatter, ${model.receivedCount} ${this.t("received")}, ${model.analyzedCount} ${this.t("analyzed")}, ${model.renderedCount} ${this.t("rendered")} ${this.t("points")}. ${model.xThreshold.provenance}; ${model.yThreshold.provenance}.`;
  }

  private textColor(): string {
    return this.host.colorPalette.isHighContrast
      ? this.host.colorPalette.foreground.value
      : "currentColor";
  }

  private colorFor(point: Pick<ClassifiedPoint, "series" | "gradient">, seriesIndex: number, min: number, max: number): string {
    if (point.gradient !== undefined) {
      const ratio = numericScale(point.gradient, min, max, 0, 1);
      const red = Math.round(0 + 192 * ratio);
      const blue = Math.round(190 - 120 * ratio);
      return `rgb(${red}, ${Math.round(90 + 70 * (1 - ratio))}, ${blue})`;
    }
    const hostColor = this.host.colorPalette.getColor(point.series ?? "Atlyn Scatter").value;
    return hostColor || palette[seriesIndex % palette.length];
  }

  private quadrantLabel(quadrant: ClassifiedPoint["quadrant"]): string {
    const key = quadrant === "upper-right"
      ? "upperRight"
      : quadrant === "upper-left"
        ? "upperLeft"
        : quadrant === "lower-left"
          ? "lowerLeft"
          : "lowerRight";
    return this.t(key);
  }

  private t(key: string): string {
    const hostText = this.localizationManager.getDisplayName(key);
    if (hostText && hostText !== key) {
      return hostText;
    }
    return translations[this.locale]?.[key] ?? translations.en[key] ?? key;
  }

  private formatValue(value: number): string {
    if (!Number.isFinite(value)) {
      return "n/a";
    }
    return this.numberFormatter?.format(value) ?? formatNumber(value);
  }

  private isRtl(): boolean {
    const locale = this.host.locale.toLowerCase();
    return locale.startsWith("ar") || locale.startsWith("he") || locale.startsWith("fa") ||
      (typeof document !== "undefined" && document.documentElement.dir === "rtl");
  }

  private renderedPointFromEvent(event: Event): (RenderedPoint & { element: SVGCircleElement }) | undefined {
    const target = event.target;
    if (!(target instanceof Element)) {
      return undefined;
    }
    const element = target.closest<SVGCircleElement>(".atlyn-scatter__point");
    if (!(element instanceof SVGCircleElement)) {
      return undefined;
    }
    const key = element.getAttribute("data-identity-key");
    const rendered = key === null ? undefined : this.renderedPoints.get(key);
    return rendered ? { ...rendered, element } : undefined;
  }

  private restoreFocus(focusKey: string | undefined): void {
    const point = focusKey === undefined
      ? undefined
      : Array.from(this.root.querySelectorAll<SVGCircleElement>(".atlyn-scatter__point"))
        .find((candidate) => candidate.getAttribute("data-identity-key") === focusKey);
    if (point) {
      point.focus();
      return;
    }
    if (focusKey !== undefined) {
      this.root.focus();
    }
  }

  private moveFocus(index: number, key: string): void {
    const points = Array.from(this.root.querySelectorAll<SVGCircleElement>(".atlyn-scatter__point"));
    if (!points.length) {
      return;
    }
    const horizontalDelta = key === "ArrowLeft"
      ? (this.rtl ? 1 : -1)
      : key === "ArrowRight"
        ? (this.rtl ? -1 : 1)
        : undefined;
    const delta = horizontalDelta ?? (key === "ArrowUp" ? -1 : 1);
    const next = (index + delta + points.length) % points.length;
    points.forEach((point, pointIndex) => point.setAttribute("tabindex", pointIndex === next ? "0" : "-1"));
    points[next]?.focus();
  }

  private async select(identity: ISelectionId, event: MouseEvent | KeyboardEvent): Promise<void> {
    if (!this.allowInteractions) {
      return;
    }
    const selected = await this.selectionManager.select(identity, event.ctrlKey || event.metaKey);
    this.selectedKeys = this.keysForSelection(selected);
    this.rerenderFromLastData();
  }

  private keysForSelection(ids: readonly HostSelectionId[]): Set<string> {
    return new Set(
      [...this.identityByKey.entries()]
        .filter(([, identity]) => ids.some((id) => id === identity ||
          (isComparableSelectionId(id) && identity.equals(id))))
        .map(([key]) => key)
    );
  }

  private async clearSelection(): Promise<void> {
    if (!this.allowInteractions) {
      return;
    }
    await this.selectionManager.clear();
    this.selectedKeys.clear();
    this.rerenderFromLastData();
  }

  private showTooltip(point: ClassifiedPoint, identity: ISelectionId, event: Event): void {
    if (!this.allowInteractions || !this.host.tooltipService.enabled()) {
      return;
    }
    const pointer = event as PointerEvent;
    const identityKey = point.identityKey ?? EMPTY_IDENTITY_KEY;
    if (this.tooltipIdentityKey === identityKey) {
      this.moveTooltip(event);
      return;
    }
    const items: Array<{ displayName: string; value: string }> = [
      { displayName: "Category", value: point.category },
      { displayName: "X", value: this.formatValue(point.x) },
      { displayName: "Y", value: this.formatValue(point.y) },
      { displayName: "Quadrant", value: this.quadrantLabel(point.quadrant) },
      { displayName: "X threshold", value: this.model ? `${this.formatValue(this.model.xThreshold.value)} (${this.model.xThreshold.mode})` : "" },
      { displayName: "Y threshold", value: this.model ? `${this.formatValue(this.model.yThreshold.value)} (${this.model.yThreshold.mode})` : "" }
    ];
    if (point.series !== undefined) {
      items.push({ displayName: "Series", value: point.series });
    }
    if (point.onXThreshold || point.onYThreshold) {
      const boundaries = [
        point.onXThreshold ? "on X threshold" : "",
        point.onYThreshold ? "on Y threshold" : ""
      ].filter(Boolean).join("; ");
      items.push({ displayName: "Boundary", value: boundaries });
    }
    if (point.size !== undefined) {
      items.push({ displayName: "Size", value: this.formatValue(point.size) });
    }
    if (point.gradient !== undefined) {
      items.push({ displayName: "Gradient", value: this.formatValue(point.gradient) });
    }
    Object.entries(point.tooltips).forEach(([displayName, value]) => items.push({ displayName, value: String(value ?? "") }));
    this.tooltipIdentityKey = identityKey;
    this.tooltipIsTouch = pointer.pointerType === "touch";
    this.host.tooltipService.show({
      coordinates: [pointer.clientX ?? 0, pointer.clientY ?? 0],
      isTouchEvent: this.tooltipIsTouch,
      dataItems: items,
      identities: [identity]
    });
  }

  private moveTooltip(event: Event): void {
    if (this.tooltipIdentityKey === undefined || !this.host.tooltipService.enabled()) {
      return;
    }
    const identity = this.identityByKey.get(this.tooltipIdentityKey);
    if (!identity) {
      return;
    }
    const pointer = event as PointerEvent;
    this.host.tooltipService.move({
      coordinates: [pointer.clientX ?? 0, pointer.clientY ?? 0],
      isTouchEvent: this.tooltipIsTouch,
      identities: [identity]
    });
  }

  private hideTooltip(event?: Event): void {
    if (this.tooltipIdentityKey === undefined) {
      return;
    }
    const pointer = event as PointerEvent | undefined;
    this.host.tooltipService.hide({
      isTouchEvent: pointer?.pointerType === "touch" || this.tooltipIsTouch,
      immediately: pointer?.pointerType === "touch" || this.tooltipIsTouch
    });
    this.tooltipIdentityKey = undefined;
    this.tooltipIsTouch = false;
  }

  private showContextMenu(identity: ISelectionId | undefined, event: Event): void {
    if (!this.allowInteractions) {
      return;
    }
    this.contextMenuGestureHandled = true;
    this.clearEmptyLongPress();
    this.clearPointLongPress();
    this.clearTouchTooltip();
    this.hideTooltip(event);
    const pointer = event as PointerEvent;
    void this.selectionManager.showContextMenu(identity ?? {}, {
      x: pointer.clientX ?? 0,
      y: pointer.clientY ?? 0
    });
  }

  private rerenderFromLastData(): void {
    if (!this.model || !this.lastDataView) {
      return;
    }
    const records = this.readPoints(this.lastDataView);
    const width = this.lastViewport.width || this.root.clientWidth;
    const height = this.lastViewport.height || this.root.clientHeight;
    if (width && height) {
      this.render(width, height, records, this.lastSettings);
    }
  }

  private addListener<T extends ElementWithEvents>(element: T, type: string, handler: EventListener, persistent = false): void {
    element.addEventListener(type, handler);
    const remove = () => element.removeEventListener(type, handler);
    (persistent ? this.listeners : this.renderListeners).push(remove);
  }

  private clearRenderListeners(): void {
    for (const remove of this.renderListeners.splice(0)) {
      remove();
    }
  }

  private clearEmptyLongPress(): void {
    if (this.emptyLongPressTimer !== undefined) {
      window.clearTimeout(this.emptyLongPressTimer);
      this.emptyLongPressTimer = undefined;
    }
  }

  private clearPointLongPress(): void {
    if (this.pointLongPressTimer !== undefined) {
      window.clearTimeout(this.pointLongPressTimer);
      this.pointLongPressTimer = undefined;
    }
  }

  private clearTouchTooltip(): void {
    if (this.touchTooltipTimer !== undefined) {
      window.clearTimeout(this.touchTooltipTimer);
      this.touchTooltipTimer = undefined;
    }
  }

  private renderingStarted(options: VisualUpdateOptions): void {
    this.host.eventService.renderingStarted(options);
  }

  private renderingFinished(options: VisualUpdateOptions): void {
    this.host.eventService.renderingFinished(options);
  }

  private renderError(options: VisualUpdateOptions, error: unknown): void {
    this.clearEmptyLongPress();
    this.clearPointLongPress();
    this.clearTouchTooltip();
    this.hideTooltip();
    const message = error instanceof Error ? error.message : String(error);
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    this.clearRenderListeners();
    this.appendMessage(`${this.t("invalid")} ${message}`);
    this.host.eventService.renderingFailed(options, message);
  }
}

export default Visual;
