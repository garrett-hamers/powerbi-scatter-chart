import powerbi from "powerbi-visuals-api";
import { buildScatterModel, ClassifiedPoint, formatNumber, RawPoint, ScatterModel, ThresholdSettings } from "./domain";

type ISelectionId = powerbi.visuals.ISelectionId;
type ISelectionManager = ReturnType<powerbi.extensibility.visual.IVisualHost["createSelectionManager"]>;
type IVisual = powerbi.extensibility.visual.IVisual;
type IVisualHost = powerbi.extensibility.visual.IVisualHost;
type VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
type VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
type ElementWithEvents = HTMLElement | SVGElement;

interface PointRecord {
  point: RawPoint;
  identity?: ISelectionId;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const palette = ["#0078d4", "#8764b8", "#107c10", "#d83b01", "#008272", "#5c2d91"];

const translations: Record<string, Record<string, string>> = {
  en: {
    noData: "Add one Category, one numeric X measure, and one numeric Y measure.",
    invalid: "X and Y must contain finite numeric values. Invalid rows were excluded.",
    threshold: "threshold",
    points: "points",
    received: "Received",
    rendered: "rendered",
    reduced: "Power BI reduced the data window; showing a bounded sample.",
    regression: "Regression",
    unavailable: "unavailable",
    boundary: "on threshold",
    upperRight: "Upper right",
    upperLeft: "Upper left",
    lowerLeft: "Lower left",
    lowerRight: "Lower right",
    semanticTable: "Accessible point table"
  },
  es: {
    noData: "Agregue una categoría, una medida X numérica y una medida Y numérica.",
    invalid: "X e Y deben contener valores numéricos finitos. Se excluyeron las filas no válidas.",
    threshold: "umbral",
    points: "puntos",
    received: "Recibidos",
    rendered: "representados",
    reduced: "Power BI redujo la ventana de datos; se muestra una muestra limitada.",
    regression: "Regresión",
    unavailable: "no disponible",
    boundary: "en el umbral",
    upperRight: "Superior derecha",
    upperLeft: "Superior izquierda",
    lowerLeft: "Inferior izquierda",
    lowerRight: "Inferior derecha",
    semanticTable: "Tabla accesible de puntos"
  },
  fr: {
    noData: "Ajoutez une catégorie, une mesure X numérique et une mesure Y numérique.",
    invalid: "X et Y doivent contenir des valeurs numériques finies. Les lignes invalides sont exclues.",
    threshold: "seuil",
    points: "points",
    received: "Reçus",
    rendered: "affichés",
    reduced: "Power BI a réduit la fenêtre de données ; un échantillon limité est affiché.",
    regression: "Régression",
    unavailable: "indisponible",
    boundary: "sur le seuil",
    upperRight: "Supérieur droit",
    upperLeft: "Supérieur gauche",
    lowerLeft: "Inférieur gauche",
    lowerRight: "Inférieur droit",
    semanticTable: "Table accessible des points"
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

function numericScale(value: number, min: number, max: number, outputMin: number, outputMax: number): number {
  if (max === min) {
    return (outputMin + outputMax) / 2;
  }
  return outputMin + ((value - min) / (max - min)) * (outputMax - outputMin);
}

function extent(values: readonly number[], thresholdValue: number): [number, number] {
  if (values.length === 0) {
    return [thresholdValue - 1, thresholdValue + 1];
  }
  let min = Math.min(...values, thresholdValue);
  let max = Math.max(...values, thresholdValue);
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1;
    min -= padding;
    max += padding;
  } else {
    const padding = (max - min) * 0.06;
    min -= padding;
    max += padding;
  }
  return [min, max];
}

export class Visual implements IVisual {
  private readonly host: IVisualHost;
  private readonly selectionManager: ISelectionManager;
  private readonly localizationManager?: powerbi.extensibility.ILocalizationManager;
  private readonly root: HTMLElement;
  private readonly listeners: Array<() => void> = [];
  private readonly renderListeners: Array<() => void> = [];
  private readonly identityByKey = new Map<string, ISelectionId>();
  private selectedKeys = new Set<string>();
  private model?: ScatterModel;
  private lastDataView?: powerbi.DataView;
  private lastViewport = { width: 0, height: 0 };
  private locale = "en";
  private rtl = false;
  private reducedMotion = false;
  private allowInteractions = true;

  constructor(options?: VisualConstructorOptions) {
    if (!options) {
      throw new Error("Visual constructor options are required.");
    }
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager();
    this.localizationManager = (this.host as any).createLocalizationManager?.();
    this.allowInteractions = (this.host as any).hostCapabilities?.allowInteractions !== false;
    this.root = options.element;
    this.root.className = "atlyn-scatter";
    this.locale = ((this.host as any).locale || "en").toLowerCase().slice(0, 2);
    this.rtl = this.isRtl();
    this.reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    this.root.setAttribute("dir", this.rtl ? "rtl" : "ltr");
    this.root.setAttribute("role", "application");
    this.addListener(this.root, "click", (event) => {
      const target = event.target as Element;
      if (target === this.root || !target.closest?.(".atlyn-scatter__point")) {
        void this.clearSelection();
      }
    }, true);
    this.addListener(this.root, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        void this.clearSelection();
      }
    }, true);
  }

  public update(options: VisualUpdateOptions): void {
    this.renderingStarted();
    try {
      const view = options.dataViews?.[0];
      this.lastDataView = view;
      this.lastViewport = { width: options.viewport.width, height: options.viewport.height };
      const raw = this.readPoints(view);
      const settings = this.readSettings(view);
      this.model = buildScatterModel(raw.map((record) => record.point), settings);
      this.render(options.viewport.width, options.viewport.height, raw, settings);
      this.renderingFinished();
    } catch (error) {
      this.renderError(error);
    }
  }

  public destroy(): void {
    for (const remove of this.listeners.splice(0)) {
      remove();
    }
    this.clearRenderListeners();
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    this.identityByKey.clear();
    this.model = undefined;
  }

  public getFormattingModel(): powerbi.visuals.FormattingModel {
    const descriptor = (propertyName: string) => ({ objectName: "quadrants", propertyName });
    const dropdown = (propertyName: string, value: string) => ({
      displayName: propertyName === "xThresholdMode" ? "X threshold mode" : "Y threshold mode",
      uid: `quadrants_${propertyName}`,
      control: {
        type: "Dropdown",
        properties: {
          descriptor: descriptor(propertyName),
          value: { value, displayName: value }
        }
      }
    });
    const numberInput = (propertyName: string, displayName: string) => ({
      displayName,
      uid: `quadrants_${propertyName}`,
      control: {
        type: "NumUpDown",
        properties: {
          descriptor: descriptor(propertyName),
          value: 0
        }
      }
    });
    return {
      cards: [{
        uid: "quadrants",
        displayName: "Quadrant analysis",
        groups: [{
          uid: "thresholds",
          displayName: "Thresholds",
          slices: [
            dropdown("xThresholdMode", "median"),
            dropdown("yThresholdMode", "median"),
            numberInput("xFixed", "Fixed X value"),
            numberInput("yFixed", "Fixed Y value"),
            numberInput("xBenchmark", "Benchmark X value"),
            numberInput("yBenchmark", "Benchmark Y value")
          ]
        }]
      }]
    } as powerbi.visuals.FormattingModel;
  }

  private readPoints(dataView: powerbi.DataView | undefined): PointRecord[] {
    const categorical = dataView?.categorical;
    const category = categorical?.categories?.[0] as any;
    const values = categorical?.values as any;
    if (!category || !values) {
      return [];
    }
    const columns = Array.from(values as any[]);
    const byRole = (role: string): any | undefined => columns.find((column: any) => column.source?.roles?.[role]);
    const xColumn = byRole("X");
    const yColumn = byRole("Y");
    const sizeColumn = byRole("Size");
    const gradientColumn = byRole("Gradient");
    const seriesColumn = byRole("Series");
    const tooltipColumns = columns.filter((column: any) => column.source?.roles?.Tooltips);
    const grouped = typeof values.grouped === "function" ? values.grouped() : [];
    const count = category.values?.length ?? Math.max(xColumn?.values?.length ?? 0, yColumn?.values?.length ?? 0);
    if ((!xColumn || !yColumn) && !grouped.length || count === 0) {
      return [];
    }

    const records: PointRecord[] = [];
    if (grouped.length) {
      for (const group of grouped) {
        const groupColumns = group.values ?? [];
        const groupX = groupColumns.find((column: any) => column.source?.roles?.X);
        const groupY = groupColumns.find((column: any) => column.source?.roles?.Y);
        if (!groupX || !groupY) {
          continue;
        }
        const groupSize = groupColumns.find((column: any) => column.source?.roles?.Size);
        const groupGradient = groupColumns.find((column: any) => column.source?.roles?.Gradient);
        const groupTooltips = groupColumns.filter((column: any) => column.source?.roles?.Tooltips);
        const seriesName = group.name === undefined ? undefined : String(group.name);
        for (let index = 0; index < count; index++) {
          const builder = this.host.createSelectionIdBuilder()
            .withCategory(category, index)
            .withSeries(values, group);
          const identity = builder.createSelectionId();
          const identityKey = identity.getKey();
          this.identityByKey.set(identityKey, identity);
          const tooltips: Record<string, unknown> = {};
          for (const column of [...tooltipColumns, ...groupTooltips]) {
            tooltips[column.source?.displayName || "Detail"] = column.values?.[index];
          }
          records.push({
            identity,
            point: {
              category: String(category.values?.[index] ?? ""),
              x: groupX.values?.[index],
              y: groupY.values?.[index],
              size: groupSize?.values?.[index],
              gradient: groupGradient?.values?.[index],
              series: seriesName,
              tooltips,
              identityKey,
              highlighted: groupX.highlights?.[index] !== undefined || groupY.highlights?.[index] !== undefined
            }
          });
        }
      }
      if (records.length) {
        return records;
      }
      if (!xColumn || !yColumn) {
        return [];
      }
    }
    for (let index = 0; index < count; index++) {
      const builder = this.host.createSelectionIdBuilder().withCategory(category, index);
      const identity = builder.createSelectionId();
      const identityKey = identity.getKey();
      this.identityByKey.set(identityKey, identity);
      const tooltips: Record<string, unknown> = {};
      for (const column of tooltipColumns) {
        tooltips[column.source?.displayName || "Detail"] = column.values?.[index];
      }
      const point: RawPoint = {
        category: String(category.values?.[index] ?? ""),
        x: xColumn.values?.[index],
        y: yColumn.values?.[index],
        size: sizeColumn?.values?.[index],
        gradient: gradientColumn?.values?.[index],
        series: seriesColumn?.values?.[index] === undefined ? undefined : String(seriesColumn.values[index]),
        tooltips,
        identityKey,
        highlighted: xColumn.highlights?.[index] !== undefined || yColumn.highlights?.[index] !== undefined
      };
      records.push({ point, identity });
    }
    return records;
  }

  private readSettings(dataView: powerbi.DataView | undefined): ThresholdSettings & { showRegression: boolean; showSemanticTable: boolean } {
    const objects = dataView?.metadata?.objects as any;
    const read = (property: string): unknown => objects?.quadrants?.[property];
    const mode = (value: unknown): ThresholdSettings["xMode"] => {
      return value === "zero" || value === "mean" || value === "median" || value === "fixed" || value === "benchmark"
        ? value
        : "median";
    };
    const numberOrUndefined = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
      xMode: mode(read("xThresholdMode")),
      yMode: mode(read("yThresholdMode")),
      xFixed: numberOrUndefined(read("xFixed")),
      yFixed: numberOrUndefined(read("yFixed")),
      xBenchmark: numberOrUndefined(read("xBenchmark")),
      yBenchmark: numberOrUndefined(read("yBenchmark")),
      showRegression: read("showRegression") !== false,
      showSemanticTable: read("showSemanticTable") !== false
    };
  }

  private render(width: number, height: number, records: PointRecord[], settings: ThresholdSettings & { showRegression: boolean; showSemanticTable: boolean }): void {
    this.clearRenderListeners();
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    const model = this.model;
    if (!model || records.length === 0) {
      const message = htmlElement("div");
      message.className = "atlyn-scatter__message";
      setText(message, this.t("noData"));
      this.root.appendChild(message);
      return;
    }
    if (model.validCount === 0) {
      const message = htmlElement("div");
      message.className = "atlyn-scatter__message";
      setText(message, this.t("invalid"));
      this.root.appendChild(message);
      this.renderSemanticTable(model, settings.showSemanticTable);
      return;
    }
    if (width < 120 || height < 100) {
      const message = htmlElement("div");
      message.className = "atlyn-scatter__message";
      setText(message, this.t("noData"));
      this.root.appendChild(message);
      return;
    }
    const svg = svgElement("svg");
    svg.classList.add("atlyn-scatter__svg");
    setAttributes(svg, {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": this.summaryLabel(model)
    });
    this.addListener(svg, "contextmenu", (event) => {
      event.preventDefault();
      this.showContextMenu(undefined, event);
    });
    this.root.appendChild(svg);

    const margin = {
      top: Math.max(34, Math.min(64, height * 0.12)),
      right: Math.max(18, Math.min(56, width * 0.12)),
      bottom: Math.max(36, Math.min(58, height * 0.14)),
      left: Math.max(44, Math.min(72, width * 0.15))
    };
    const plotWidth = Math.max(20, width - margin.left - margin.right);
    const plotHeight = Math.max(20, height - margin.top - margin.bottom);
    const xExtent = extent(model.validPoints.map((point) => point.x), model.xThreshold.value);
    const yExtent = extent(model.validPoints.map((point) => point.y), model.yThreshold.value);
    const x = (value: number) => numericScale(value, xExtent[0], xExtent[1], margin.left, margin.left + plotWidth);
    const y = (value: number) => numericScale(value, yExtent[0], yExtent[1], margin.top + plotHeight, margin.top);

    const defs = svgElement("defs");
    const pattern = svgElement("pattern");
    setAttributes(pattern, { id: "atlyn-hatch", width: 8, height: 8, patternUnits: "userSpaceOnUse" });
    const patternLine = svgElement("path");
    setAttributes(patternLine, { d: "M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6", stroke: "currentColor", "stroke-width": 1, opacity: 0.18 });
    pattern.appendChild(patternLine);
    defs.appendChild(pattern);
    svg.appendChild(defs);

    this.drawQuadrants(svg, model, x, y, xExtent, yExtent, margin, plotWidth, plotHeight);
    this.drawAxes(svg, x, y, xExtent, yExtent, margin, plotWidth, plotHeight);
    if (settings.showRegression && model.regression.valid) {
      this.drawRegression(svg, model, x, y, xExtent);
    }
    const recordsByKey = new Map(records.map((record) => [record.point.identityKey, record]));
    const highlighted = model.points.some((point) => point.highlighted);
    const sizeValues = model.points.map((point) => point.size).filter((value): value is number => value !== undefined);
    const sizeMin = sizeValues.length ? Math.min(...sizeValues) : 0;
    const sizeMax = sizeValues.length ? Math.max(...sizeValues) : 1;
    const gradientValues = model.points.map((point) => point.gradient).filter((value): value is number => value !== undefined);
    const gradientMin = gradientValues.length ? Math.min(...gradientValues) : 0;
    const gradientMax = gradientValues.length ? Math.max(...gradientValues) : 1;
    model.points.forEach((point, index) => {
      const record = recordsByKey.get(point.identityKey);
      this.drawPoint(svg, point, record?.identity, index, x, y, sizeMin, sizeMax, gradientMin, gradientMax, highlighted);
    });
    this.drawAnnotations(svg, model, margin, width, settings.showRegression);
    if (model.reduced || model.invalidRows > 0) {
      const disclosure = svgElement("text");
      setAttributes(disclosure, { x: margin.left, y: height - 8, "font-size": 10, fill: "currentColor" });
      setText(disclosure, `${this.t("received")} ${model.receivedCount}; ${this.t("rendered")} ${model.renderedCount}. ${model.reduced ? this.t("reduced") : ""}`);
      svg.appendChild(disclosure);
    }
    this.renderSemanticTable(model, settings.showSemanticTable);
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
    plotHeight: number
  ): void {
    const xMid = x(model.xThreshold.value);
    const yMid = y(model.yThreshold.value);
    const rects: Array<{ quadrant: ClassifiedPoint["quadrant"]; x: number; y: number; width: number; height: number }> = [
      { quadrant: "upper-left", x: margin.left, y: margin.top, width: xMid - margin.left, height: yMid - margin.top },
      { quadrant: "upper-right", x: xMid, y: margin.top, width: margin.left + plotWidth - xMid, height: yMid - margin.top },
      { quadrant: "lower-left", x: margin.left, y: yMid, width: xMid - margin.left, height: margin.top + plotHeight - yMid },
      { quadrant: "lower-right", x: xMid, y: yMid, width: margin.left + plotWidth - xMid, height: margin.top + plotHeight - yMid }
    ];
    const colors = ["#deecf9", "#dff6dd", "#fce4ec", "#fff4ce"];
    rects.forEach((item, index) => {
      const rect = svgElement("rect");
      setAttributes(rect, { x: item.x, y: item.y, width: Math.max(0, item.width), height: Math.max(0, item.height), fill: colors[index], opacity: 0.55 });
      svg.appendChild(rect);
      const hatch = svgElement("rect");
      setAttributes(hatch, { x: item.x, y: item.y, width: Math.max(0, item.width), height: Math.max(0, item.height), fill: "url(#atlyn-hatch)", "aria-hidden": "true" });
      svg.appendChild(hatch);
      const label = svgElement("text");
      setAttributes(label, { x: item.x + 7, y: item.y + 16, "font-size": 10, fill: "currentColor" });
      setText(label, this.quadrantLabel(item.quadrant));
      svg.appendChild(label);
    });
    const xLine = svgElement("line");
    setAttributes(xLine, { x1: xMid, x2: xMid, y1: margin.top, y2: margin.top + plotHeight, stroke: "currentColor", "stroke-dasharray": "5 4", "stroke-width": 1 });
    const yLine = svgElement("line");
    setAttributes(yLine, { x1: margin.left, x2: margin.left + plotWidth, y1: yMid, y2: yMid, stroke: "currentColor", "stroke-dasharray": "5 4", "stroke-width": 1 });
    svg.append(xLine, yLine);
    const xLabel = svgElement("text");
    setAttributes(xLabel, { x: xMid + 4, y: margin.top + plotHeight - 4, "font-size": 9, fill: "currentColor" });
    setText(xLabel, `${this.t("threshold")} ${formatNumber(model.xThreshold.value)}`);
    const yLabel = svgElement("text");
    setAttributes(yLabel, { x: margin.left + 4, y: yMid - 4, "font-size": 9, fill: "currentColor" });
    setText(yLabel, `${this.t("threshold")} ${formatNumber(model.yThreshold.value)}`);
    svg.append(xLabel, yLabel);
    void xExtent;
    void yExtent;
  }

  private drawAxes(
    svg: SVGSVGElement,
    x: (value: number) => number,
    y: (value: number) => number,
    xExtent: [number, number],
    yExtent: [number, number],
    margin: { top: number; right: number; bottom: number; left: number },
    plotWidth: number,
    plotHeight: number
  ): void {
    const axisColor = "currentColor";
    const xAxis = svgElement("line");
    setAttributes(xAxis, { x1: margin.left, x2: margin.left + plotWidth, y1: margin.top + plotHeight, y2: margin.top + plotHeight, stroke: axisColor });
    const yAxis = svgElement("line");
    setAttributes(yAxis, { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + plotHeight, stroke: axisColor });
    svg.append(xAxis, yAxis);
    const xStart = svgElement("text");
    setAttributes(xStart, { x: margin.left, y: margin.top + plotHeight + 16, "font-size": 10, fill: axisColor });
    setText(xStart, formatNumber(xExtent[0]));
    const xEnd = svgElement("text");
    setAttributes(xEnd, { x: margin.left + plotWidth, y: margin.top + plotHeight + 16, "font-size": 10, "text-anchor": "end", fill: axisColor });
    setText(xEnd, formatNumber(xExtent[1]));
    const yStart = svgElement("text");
    setAttributes(yStart, { x: margin.left - 6, y: margin.top + plotHeight, "font-size": 10, "text-anchor": "end", fill: axisColor });
    setText(yStart, formatNumber(yExtent[0]));
    const yEnd = svgElement("text");
    setAttributes(yEnd, { x: margin.left - 6, y: margin.top + 4, "font-size": 10, "text-anchor": "end", fill: axisColor });
    setText(yEnd, formatNumber(yExtent[1]));
    svg.append(xStart, xEnd, yStart, yEnd);
  }

  private drawRegression(svg: SVGSVGElement, model: ScatterModel, x: (value: number) => number, y: (value: number) => number, xExtent: [number, number]): void {
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
      stroke: "#333333",
      "stroke-width": 2,
      "stroke-dasharray": "7 3"
    });
    svg.appendChild(line);
  }

  private drawPoint(
    svg: SVGSVGElement,
    point: ClassifiedPoint,
    identity: ISelectionId | undefined,
    index: number,
    x: (value: number) => number,
    y: (value: number) => number,
    sizeMin: number,
    sizeMax: number,
    gradientMin: number,
    gradientMax: number,
    hasHighlights: boolean
  ): void {
    const circle = svgElement("circle");
    const radius = point.size === undefined ? 5 : numericScale(point.size, sizeMin, sizeMax, 4, 12);
    const seriesIndex = point.series ? Math.max(0, [...new Set(this.model?.points.map((item) => item.series))].indexOf(point.series)) : 0;
    const fill = this.colorFor(point, seriesIndex, gradientMin, gradientMax);
    const key = point.identityKey ?? `${index}`;
    const selected = key !== undefined && this.selectedKeys.has(key);
    setAttributes(circle, {
      cx: x(point.x),
      cy: y(point.y),
      r: radius,
      fill,
      stroke: selected ? "currentColor" : "white",
      "stroke-width": selected ? 3 : 1,
      opacity: hasHighlights && !point.highlighted ? 0.22 : selected ? 1 : 0.88,
      tabindex: 0,
      role: "button",
      "aria-label": this.pointLabel(point),
      "data-point-index": index
    });
    circle.classList.add("atlyn-scatter__point");
    let longPressTimer: number | undefined;
    this.addListener(circle, "click", (event) => {
      event.stopPropagation();
      void this.select(identity, event as MouseEvent);
    });
    this.addListener(circle, "keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        void this.select(identity, keyboardEvent);
      } else if (keyboardEvent.key === "Escape") {
        void this.clearSelection();
      } else if (keyboardEvent.key === "ArrowRight" || keyboardEvent.key === "ArrowDown" || keyboardEvent.key === "ArrowLeft" || keyboardEvent.key === "ArrowUp") {
        this.moveFocus(index, keyboardEvent.key);
      }
    });
    this.addListener(circle, "pointerenter", (event) => this.showTooltip(point, event));
    this.addListener(circle, "pointerleave", () => {
      this.hideTooltip();
      if (longPressTimer !== undefined) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    });
    this.addListener(circle, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === "touch") {
        longPressTimer = window.setTimeout(() => this.showContextMenu(identity, pointer), 550);
      }
    });
    this.addListener(circle, "pointerup", () => {
      if (longPressTimer !== undefined) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    });
    this.addListener(circle, "contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showContextMenu(identity, event);
    });
    svg.appendChild(circle);
  }

  private drawAnnotations(svg: SVGSVGElement, model: ScatterModel, margin: { top: number; right: number; bottom: number; left: number }, width: number, showRegression: boolean): void {
    const group = svgElement("g");
    const annotation = svgElement("text");
    setAttributes(annotation, { x: this.rtl ? margin.right : margin.left, y: 16, "font-size": Math.min(13, Math.max(10, width / 80)), fill: "currentColor", "text-anchor": this.rtl ? "end" : "start" });
    const regressionText = showRegression
      ? model.regression.valid
        ? `${this.t("regression")}: ${model.regression.equation}; R² ${formatNumber(model.regression.r2 ?? 0)}; n=${model.regression.n}`
        : `${this.t("regression")}: ${this.t("unavailable")} (${model.regression.reason ?? ""})`
      : "";
    setText(annotation, `${model.xThreshold.provenance}; ${model.yThreshold.provenance}. ${regressionText}`);
    group.appendChild(annotation);
    const countText = svgElement("text");
    setAttributes(countText, { x: this.rtl ? width - margin.right : margin.left, y: 30, "font-size": 10, fill: "currentColor", "text-anchor": this.rtl ? "end" : "start" });
    const selectedSummary = this.selectedKeys.size ? ` · Selected ${this.selectedKeys.size}` : "";
    setText(countText, `${this.quadrantLabel("upper-right")}: ${model.counts["upper-right"]} · ${this.quadrantLabel("upper-left")}: ${model.counts["upper-left"]} · ${this.quadrantLabel("lower-left")}: ${model.counts["lower-left"]} · ${this.quadrantLabel("lower-right")}: ${model.counts["lower-right"]} · ${model.boundaryCount} ${this.t("boundary")}${selectedSummary}`);
    group.appendChild(countText);
    svg.appendChild(group);
  }

  private renderSemanticTable(model: ScatterModel, visible: boolean): void {
    const table = htmlElement("table");
    table.className = `atlyn-scatter__semantic-table${visible ? "" : " atlyn-scatter__semantic-table--visually-hidden"}`;
    const caption = htmlElement("caption");
    setText(caption, this.t("semanticTable"));
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
      const values = [point.category, formatNumber(point.x), formatNumber(point.y), this.quadrantLabel(point.quadrant), this.pointStatus(point)];
      values.forEach((value) => {
        const cell = htmlElement("td");
        setText(cell, value);
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    this.root.appendChild(table);
  }

  private pointLabel(point: ClassifiedPoint): string {
    const boundary = point.onXThreshold || point.onYThreshold ? `, ${this.t("boundary")}` : "";
    return `${point.category}: X ${formatNumber(point.x)}, Y ${formatNumber(point.y)}, ${this.quadrantLabel(point.quadrant)}${boundary}`;
  }

  private pointStatus(point: ClassifiedPoint): string {
    return point.onXThreshold || point.onYThreshold ? this.t("boundary") : point.highlighted ? "highlighted" : "visible";
  }

  private summaryLabel(model: ScatterModel): string {
    return `Atlyn Scatter, ${model.renderedCount} ${this.t("points")}. ${model.xThreshold.provenance}; ${model.yThreshold.provenance}.`;
  }

  private colorFor(point: ClassifiedPoint, seriesIndex: number, min: number, max: number): string {
    const highContrast = Boolean((this.host as any).colorPalette?.isHighContrast);
    if (highContrast) {
      return "currentColor";
    }
    if (point.gradient !== undefined) {
      const ratio = numericScale(point.gradient, min, max, 0, 1);
      const red = Math.round(0 + 192 * ratio);
      const blue = Math.round(190 - 120 * ratio);
      return `rgb(${red}, ${Math.round(90 + 70 * (1 - ratio))}, ${blue})`;
    }
    const hostColor = (this.host as any).colorPalette?.getColor?.(point.series ?? "").value;
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
    const hostText = this.localizationManager?.getDisplayName(key);
    if (hostText && hostText !== key) {
      return hostText;
    }
    return translations[this.locale]?.[key] ?? translations.en[key] ?? key;
  }

  private isRtl(): boolean {
    const locale = ((this.host as any).locale || "").toLowerCase();
    return locale.startsWith("ar") || locale.startsWith("he") || locale.startsWith("fa") ||
      (typeof document !== "undefined" && document.documentElement.dir === "rtl");
  }

  private moveFocus(index: number, key: string): void {
    const points = Array.from(this.root.querySelectorAll<SVGCircleElement>(".atlyn-scatter__point"));
    if (!points.length) {
      return;
    }
    const delta = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
    const next = (index + delta + points.length) % points.length;
    points[next]?.focus();
  }

  private async select(identity: ISelectionId | undefined, event: MouseEvent | KeyboardEvent): Promise<void> {
    if (!identity || !this.allowInteractions) {
      return;
    }
    const multiSelect = event instanceof KeyboardEvent
      ? event.ctrlKey || event.metaKey
      : event.ctrlKey || event.metaKey;
    const selected = await this.selectionManager.select(identity, multiSelect);
    this.selectedKeys = new Set((selected as unknown as ISelectionId[]).map((item) => item.getKey()));
    this.rerenderFromLastData();
  }

  private async clearSelection(): Promise<void> {
    await this.selectionManager.clear();
    this.selectedKeys.clear();
    this.rerenderFromLastData();
  }

  private showTooltip(point: ClassifiedPoint, event: Event): void {
    const coordinates = this.eventCoordinates(event);
    const items: Array<{ displayName: string; value: string }> = [
      { displayName: "Category", value: point.category },
      { displayName: "X", value: formatNumber(point.x) },
      { displayName: "Y", value: formatNumber(point.y) },
      { displayName: "Quadrant", value: this.quadrantLabel(point.quadrant) },
      { displayName: "X threshold", value: this.model ? `${formatNumber(this.model.xThreshold.value)} (${this.model.xThreshold.mode})` : "" },
      { displayName: "Y threshold", value: this.model ? `${formatNumber(this.model.yThreshold.value)} (${this.model.yThreshold.mode})` : "" }
    ];
    if (point.onXThreshold || point.onYThreshold) {
      const boundaries = [
        point.onXThreshold ? "on X threshold" : "",
        point.onYThreshold ? "on Y threshold" : ""
      ].filter(Boolean).join("; ");
      items.push({ displayName: "Boundary", value: boundaries });
    }
    if (point.size !== undefined) {
      items.push({ displayName: "Size", value: formatNumber(point.size) });
    }
    if (point.gradient !== undefined) {
      items.push({ displayName: "Gradient", value: formatNumber(point.gradient) });
    }
    Object.entries(point.tooltips).forEach(([displayName, value]) => items.push({ displayName, value: String(value ?? "") }));
    (this.host as any).tooltipService?.show?.({ coordinates, isTouchEvent: false, dataItems: items });
  }

  private hideTooltip(): void {
    (this.host as any).tooltipService?.hide?.({ immediately: false });
  }

  private showContextMenu(identity: ISelectionId | undefined, event: Event): void {
    const coordinates = this.eventCoordinates(event);
    (this.host as any).contextMenuService?.show?.({ data: identity, position: coordinates });
  }

  private eventCoordinates(event: Event): { x: number; y: number } {
    const pointer = event as PointerEvent;
    return { x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 };
  }

  private rerenderFromLastData(): void {
    if (!this.model || !this.lastDataView) {
      return;
    }
    const records = this.readPoints(this.lastDataView);
    const width = this.lastViewport.width || this.root.clientWidth;
    const height = this.lastViewport.height || this.root.clientHeight;
    if (records.length && width && height) {
      this.render(width, height, records, this.readSettings(this.lastDataView));
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

  private renderingStarted(): void {
    (this.host as any).eventService?.renderingStarted?.({ type: "renderingStarted" });
  }

  private renderingFinished(): void {
    (this.host as any).eventService?.renderingFinished?.({ type: "renderingFinished" });
  }

  private renderError(error: unknown): void {
    const message = htmlElement("div");
    message.className = "atlyn-scatter__message";
    setText(message, `${this.t("invalid")} ${error instanceof Error ? error.message : ""}`);
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    this.clearRenderListeners();
    this.root.appendChild(message);
    (this.host as any).eventService?.renderingFailed?.({
      errorCode: "visualRenderError",
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

export default Visual;
