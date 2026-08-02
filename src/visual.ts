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

const SVG_NS = "http://www.w3.org/2000/svg";
const palette = ["#0078d4", "#8764b8", "#107c10", "#d83b01", "#008272", "#5c2d91"];

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

export class Visual implements IVisual {
  private readonly host: IVisualHost;
  private readonly selectionManager: ISelectionManager;
  private readonly localizationManager: powerbi.extensibility.ILocalizationManager;
  private readonly emptySelectionId: ISelectionId;
  private readonly root: HTMLElement;
  private readonly listeners: Array<() => void> = [];
  private readonly renderListeners: Array<() => void> = [];
  private readonly identityByKey = new Map<string, ISelectionId>();
  private selectedKeys = new Set<string>();
  private model?: ScatterModel;
  private lastDataView?: powerbi.DataView;
  private lastUpdateOptions?: VisualUpdateOptions;
  private lastViewport = { width: 0, height: 0 };
  private lastSettings: VisualSettings = readVisualSettings();
  private locale = "en";
  private rtl = false;
  private reducedMotion = false;
  private allowInteractions = true;
  private emptyLongPressTimer?: number;

  constructor(options?: VisualConstructorOptions) {
    if (!options) {
      throw new Error("Visual constructor options are required.");
    }
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager();
    this.localizationManager = this.host.createLocalizationManager();
    this.emptySelectionId = this.host.createSelectionIdBuilder().createSelectionId();
    this.allowInteractions = this.host.hostCapabilities.allowInteractions !== false;
    this.root = options.element;
    this.root.className = "atlyn-scatter";
    this.locale = this.host.locale.toLowerCase().slice(0, 2);
    this.rtl = this.isRtl();
    this.reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    this.root.setAttribute("dir", this.rtl ? "rtl" : "ltr");
    this.root.setAttribute("data-reduced-motion", String(this.reducedMotion));
    this.root.setAttribute("role", "application");
    this.root.tabIndex = 0;
    this.selectionManager.registerOnSelectCallback((ids) => {
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
  }

  public update(options: VisualUpdateOptions): void {
    this.lastUpdateOptions = options;
    this.renderingStarted(options);
    try {
      const view = options.dataViews[0];
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
    this.clearEmptyLongPress();
    for (const remove of this.listeners.splice(0)) {
      remove();
    }
    this.clearRenderListeners();
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    this.identityByKey.clear();
    this.selectedKeys.clear();
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
      for (const group of grouped) {
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
        return records;
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
    return records;
  }

  private render(
    width: number,
    height: number,
    records: PointRecord[],
    settings: VisualSettings
  ): void {
    this.clearRenderListeners();
    this.clearEmptyLongPress();
    while (this.root.firstChild) {
      this.root.removeChild(this.root.firstChild);
    }
    const model = this.model;
    if (!model || records.length === 0) {
      this.appendMessage(this.t("noData"));
      return;
    }
    if (model.validCount === 0) {
      this.appendMessage(this.t("invalid"));
      this.renderSemanticTable(model, settings.showSemanticTable);
      return;
    }
    if (width < 80 || height < 80) {
      this.appendMessage(this.t("compact"));
      return;
    }

    const svg = svgElement("svg");
    svg.classList.add("atlyn-scatter__svg");
    setAttributes(svg, {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": this.summaryLabel(model),
      direction: this.rtl ? "rtl" : "ltr",
      "data-reduced-motion": String(this.reducedMotion)
    });
    this.addListener(svg, "contextmenu", (event) => {
      event.preventDefault();
      this.showContextMenu(undefined, event);
    });
    this.addListener(svg, "pointerdown", (event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === "touch" && event.target === svg) {
        this.emptyLongPressTimer = window.setTimeout(() => this.showContextMenu(undefined, pointer), 550);
      }
    });
    this.addListener(svg, "pointerup", () => this.clearEmptyLongPress());
    this.addListener(svg, "pointercancel", () => this.clearEmptyLongPress());
    this.addListener(svg, "pointerleave", () => this.clearEmptyLongPress());
    this.root.appendChild(svg);

    const compact = width < 280 || height < 190;
    const margin = {
      top: compact ? 40 : Math.max(34, Math.min(64, height * 0.12)),
      right: compact ? 14 : Math.max(18, Math.min(56, width * 0.12)),
      bottom: compact ? 30 : Math.max(36, Math.min(58, height * 0.14)),
      left: compact ? 34 : Math.max(44, Math.min(72, width * 0.15))
    };
    const plotWidth = Math.max(20, width - margin.left - margin.right);
    const plotHeight = Math.max(20, height - margin.top - margin.bottom);
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

    this.drawQuadrants(svg, model, x, y, xExtent, yExtent, margin, plotWidth, plotHeight, settings);
    this.drawAxes(svg, x, y, xExtent, yExtent, margin, plotWidth, plotHeight, settings);
    if (settings.showRegression && model.regression.valid) {
      this.drawRegression(svg, model, x, y, xExtent);
    }
    const recordsByKey = new Map(records.map((record) => [record.point.identityKey ?? "", record]));
    const sizeValues = model.points.map((point) => point.size).filter((value): value is number => value !== undefined);
    const sizeMin = sizeValues.length ? Math.min(...sizeValues) : 0;
    const sizeMax = sizeValues.length ? Math.max(...sizeValues) : 1;
    const gradientValues = model.points.map((point) => point.gradient).filter((value): value is number => value !== undefined);
    const gradientMin = gradientValues.length ? Math.min(...gradientValues) : 0;
    const gradientMax = gradientValues.length ? Math.max(...gradientValues) : 1;
    model.points.forEach((point, index) => {
      const record = recordsByKey.get(point.identityKey ?? "");
      if (record) {
        this.drawPoint(
          svg,
          point,
          record.identity,
          index,
          x,
          y,
          sizeMin,
          sizeMax,
          gradientMin,
          gradientMax,
          model.hasHighlights,
          settings
        );
      }
    });
    if (settings.showLegend) {
      this.drawLegend(svg, model, width, margin);
    }
    this.drawAnnotations(svg, model, margin, width, settings.showRegression);
    if (model.reduced || model.partialData || model.invalidRows > 0) {
      const disclosure = svgElement("text");
      setAttributes(disclosure, {
        x: this.rtl ? width - margin.right : margin.left,
        y: height - 8,
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
    }
    this.renderSemanticTable(model, settings.showSemanticTable);
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
    settings: VisualSettings
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
    if (settings.showThresholdLabels) {
      const xLabel = svgElement("text");
      setAttributes(xLabel, {
        x: this.rtl ? xMid - 4 : xMid + 4,
        y: margin.top + plotHeight - 4,
        "font-size": 9,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(xLabel, `${this.t("threshold")} ${formatNumber(model.xThreshold.value)}`);
      const yLabel = svgElement("text");
      setAttributes(yLabel, {
        x: this.rtl ? margin.left + plotWidth - 4 : margin.left + 4,
        y: yMid - 4,
        "font-size": 9,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(yLabel, `${this.t("threshold")} ${formatNumber(model.yThreshold.value)}`);
      svg.append(xLabel, yLabel);
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
    setText(xStart, formatNumber(xExtent[0]));
    const xEnd = svgElement("text");
    setAttributes(xEnd, {
      x: x(xExtent[1]),
      y: margin.top + plotHeight + 16,
      "font-size": 10,
      "text-anchor": this.rtl ? "start" : "end",
      fill: axisColor
    });
    setText(xEnd, formatNumber(xExtent[1]));
    const yStart = svgElement("text");
    setAttributes(yStart, {
      x: this.rtl ? yAxisX + 6 : yAxisX - 6,
      y: y(yExtent[0]),
      "font-size": 10,
      "text-anchor": this.rtl ? "start" : "end",
      fill: axisColor
    });
    setText(yStart, formatNumber(yExtent[0]));
    const yEnd = svgElement("text");
    setAttributes(yEnd, {
      x: this.rtl ? yAxisX + 6 : yAxisX - 6,
      y: y(yExtent[1]),
      "font-size": 10,
      "text-anchor": this.rtl ? "start" : "end",
      fill: axisColor
    });
    setText(yEnd, formatNumber(yExtent[1]));
    svg.append(xStart, xEnd, yStart, yEnd);
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
    identity: ISelectionId,
    index: number,
    x: (value: number) => number,
    y: (value: number) => number,
    sizeMin: number,
    sizeMax: number,
    gradientMin: number,
    gradientMax: number,
    hasHighlights: boolean,
    settings: VisualSettings
  ): void {
    const circle = svgElement("circle");
    const radius = point.size === undefined
      ? Math.max(settings.minMarkerSize, 5)
      : numericScale(point.size, sizeMin, sizeMax, settings.minMarkerSize, settings.maxMarkerSize);
    const seriesValues = [...new Set(this.model?.points.map((item) => item.series).filter((value): value is string => value !== undefined))];
    const seriesIndex = point.series === undefined ? 0 : Math.max(0, seriesValues.indexOf(point.series));
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
      tabindex: 0,
      role: "button",
      "aria-label": this.pointLabel(point),
      "aria-pressed": String(selected),
      "data-point-index": index,
      "data-selected": String(selected)
    });
    circle.classList.add("atlyn-scatter__point");
    if (selected) {
      circle.classList.add("atlyn-scatter__point--selected");
    }
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
    this.addListener(circle, "pointerenter", (event) => this.showTooltip(point, identity, event));
    this.addListener(circle, "pointerleave", (event) => {
      this.hideTooltip(event);
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
    this.addListener(circle, "pointercancel", () => {
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

    const stride = Math.max(1, Math.round(100 / settings.labelDensity));
    if (settings.showLabels && index % stride === 0) {
      const label = svgElement("text");
      setAttributes(label, {
        x: x(point.x) + (this.rtl ? -radius - 2 : radius + 2),
        y: y(point.y) - radius - 2,
        "font-size": 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(label, point.category);
      svg.appendChild(label);
    }
  }

  private drawLegend(
    svg: SVGSVGElement,
    model: ScatterModel,
    width: number,
    margin: { top: number; right: number; bottom: number; left: number }
  ): void {
    const seriesValues = [...new Set(model.points.map((point) => point.series).filter((value): value is string => value !== undefined))];
    if (seriesValues.length === 0) {
      return;
    }
    seriesValues.forEach((series, index) => {
      const x = this.rtl ? width - margin.right - index * 96 : margin.left + index * 96;
      const marker = svgElement("circle");
      setAttributes(marker, {
        cx: x,
        cy: margin.top - 12,
        r: 4,
        fill: this.host.colorPalette.isHighContrast ? this.host.colorPalette.background.value : this.colorFor({ series, gradient: undefined }, index, 0, 1),
        stroke: this.host.colorPalette.isHighContrast ? this.host.colorPalette.foreground.value : "currentColor",
        "stroke-width": 1
      });
      svg.appendChild(marker);
      const label = svgElement("text");
      setAttributes(label, {
        x: x + (this.rtl ? -8 : 8),
        y: margin.top - 8,
        "font-size": 10,
        fill: this.textColor(),
        "text-anchor": this.rtl ? "end" : "start"
      });
      setText(label, series);
      svg.appendChild(label);
    });
  }

  private drawAnnotations(
    svg: SVGSVGElement,
    model: ScatterModel,
    margin: { top: number; right: number; bottom: number; left: number },
    width: number,
    showRegression: boolean
  ): void {
    const group = svgElement("g");
    const annotation = svgElement("text");
    setAttributes(annotation, {
      x: this.rtl ? width - margin.right : margin.left,
      y: 16,
      "font-size": Math.min(13, Math.max(10, width / 80)),
      fill: this.textColor(),
      "text-anchor": this.rtl ? "end" : "start"
    });
    const regressionText = showRegression
      ? model.regression.valid
        ? `${this.t("regression")}: ${model.regression.equation}; R2 ${formatNumber(model.regression.r2 ?? 0)}; n=${model.regression.n}`
        : `${this.t("regression")}: ${this.t("unavailable")} (${model.regression.reason ?? ""})`
      : "";
    setText(annotation, `${model.xThreshold.provenance}; ${model.yThreshold.provenance}. ${regressionText}`);
    group.appendChild(annotation);
    const countText = svgElement("text");
    setAttributes(countText, {
      x: this.rtl ? width - margin.right : margin.left,
      y: 30,
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
    svg.appendChild(group);
  }

  private renderSemanticTable(model: ScatterModel, visible: boolean): void {
    const table = htmlElement("table");
    table.className = `atlyn-scatter__semantic-table${visible ? "" : " atlyn-scatter__semantic-table--visually-hidden"}`;
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
    const series = point.series ? `, ${point.series}` : "";
    return `${point.category}${series}: X ${formatNumber(point.x)}, Y ${formatNumber(point.y)}, ${this.quadrantLabel(point.quadrant)}${boundary}`;
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

  private isRtl(): boolean {
    const locale = this.host.locale.toLowerCase();
    return locale.startsWith("ar") || locale.startsWith("he") || locale.startsWith("fa") ||
      (typeof document !== "undefined" && document.documentElement.dir === "rtl");
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
    await this.selectionManager.clear();
    this.selectedKeys.clear();
    this.rerenderFromLastData();
  }

  private showTooltip(point: ClassifiedPoint, identity: ISelectionId, event: Event): void {
    const pointer = event as PointerEvent;
    const items: Array<{ displayName: string; value: string }> = [
      { displayName: "Category", value: point.category },
      { displayName: "X", value: formatNumber(point.x) },
      { displayName: "Y", value: formatNumber(point.y) },
      { displayName: "Quadrant", value: this.quadrantLabel(point.quadrant) },
      { displayName: "X threshold", value: this.model ? `${formatNumber(this.model.xThreshold.value)} (${this.model.xThreshold.mode})` : "" },
      { displayName: "Y threshold", value: this.model ? `${formatNumber(this.model.yThreshold.value)} (${this.model.yThreshold.mode})` : "" }
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
      items.push({ displayName: "Size", value: formatNumber(point.size) });
    }
    if (point.gradient !== undefined) {
      items.push({ displayName: "Gradient", value: formatNumber(point.gradient) });
    }
    Object.entries(point.tooltips).forEach(([displayName, value]) => items.push({ displayName, value: String(value ?? "") }));
    this.host.tooltipService.show({
      coordinates: [pointer.clientX ?? 0, pointer.clientY ?? 0],
      isTouchEvent: pointer.pointerType === "touch",
      dataItems: items,
      identities: [identity]
    });
  }

  private hideTooltip(event: Event): void {
    const pointer = event as PointerEvent;
    this.host.tooltipService.hide({
      isTouchEvent: pointer.pointerType === "touch",
      immediately: false
    });
  }

  private showContextMenu(identity: ISelectionId | undefined, event: Event): void {
    const pointer = event as PointerEvent;
    void this.selectionManager.showContextMenu(identity ?? this.emptySelectionId, {
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

  private renderingStarted(options: VisualUpdateOptions): void {
    this.host.eventService.renderingStarted(options);
  }

  private renderingFinished(options: VisualUpdateOptions): void {
    this.host.eventService.renderingFinished(options);
  }

  private renderError(options: VisualUpdateOptions, error: unknown): void {
    this.clearEmptyLongPress();
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
