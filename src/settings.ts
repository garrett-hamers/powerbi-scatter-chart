import powerbi from "powerbi-visuals-api";
import { DEFAULT_MAX_POINTS, ThresholdMode, ThresholdSettings } from "./domain";

export interface VisualSettings extends ThresholdSettings {
  xMode: ThresholdMode;
  yMode: ThresholdMode;
  showRegression: boolean;
  showSemanticTable: boolean;
  showQuadrants: boolean;
  showThresholdLabels: boolean;
  showAxes: boolean;
  showAxisLabels: boolean;
  minMarkerSize: number;
  maxMarkerSize: number;
  markerOpacity: number;
  showLabels: boolean;
  labelDensity: number;
  showLegend: boolean;
}

export const DEFAULT_SETTINGS: VisualSettings = {
  xMode: "median",
  yMode: "median",
  showRegression: true,
  showSemanticTable: true,
  showQuadrants: true,
  showThresholdLabels: true,
  showAxes: true,
  showAxisLabels: true,
  minMarkerSize: 4,
  maxMarkerSize: 12,
  markerOpacity: 0.88,
  showLabels: false,
  labelDensity: 25,
  showLegend: true,
  maxPoints: DEFAULT_MAX_POINTS
};

type Translation = (key: string) => string;

const thresholdModes: readonly ThresholdMode[] = ["median", "mean", "zero", "fixed", "benchmark"];

function readProperty(
  objects: powerbi.DataViewObjects | undefined,
  objectName: string,
  propertyName: string
): powerbi.DataViewPropertyValue | undefined {
  return objects?.[objectName]?.[propertyName];
}

function readMode(value: powerbi.DataViewPropertyValue | undefined, fallback: ThresholdMode): ThresholdMode {
  return typeof value === "string" && thresholdModes.includes(value as ThresholdMode)
    ? value as ThresholdMode
    : fallback;
}

function readNumber(value: powerbi.DataViewPropertyValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: powerbi.DataViewPropertyValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readVisualSettings(dataView?: powerbi.DataView): VisualSettings {
  const objects = dataView?.metadata?.objects;
  const xMode = readMode(readProperty(objects, "quadrants", "xThresholdMode"), DEFAULT_SETTINGS.xMode);
  const yMode = readMode(readProperty(objects, "quadrants", "yThresholdMode"), DEFAULT_SETTINGS.yMode);
  const minMarkerSize = clamp(readNumber(readProperty(objects, "markers", "minMarkerSize"), DEFAULT_SETTINGS.minMarkerSize), 2, 24);
  const maxMarkerSize = clamp(
    readNumber(readProperty(objects, "markers", "maxMarkerSize"), DEFAULT_SETTINGS.maxMarkerSize),
    minMarkerSize,
    48
  );
  return {
    ...DEFAULT_SETTINGS,
    xMode,
    yMode,
    xFixed: readNumber(readProperty(objects, "quadrants", "xFixed"), DEFAULT_SETTINGS.xFixed ?? 0),
    yFixed: readNumber(readProperty(objects, "quadrants", "yFixed"), DEFAULT_SETTINGS.yFixed ?? 0),
    xBenchmark: readNumber(readProperty(objects, "quadrants", "xBenchmark"), DEFAULT_SETTINGS.xBenchmark ?? 0),
    yBenchmark: readNumber(readProperty(objects, "quadrants", "yBenchmark"), DEFAULT_SETTINGS.yBenchmark ?? 0),
    showRegression: readBoolean(readProperty(objects, "quadrants", "showRegression"), DEFAULT_SETTINGS.showRegression),
    showSemanticTable: readBoolean(readProperty(objects, "quadrants", "showSemanticTable"), DEFAULT_SETTINGS.showSemanticTable),
    showQuadrants: readBoolean(readProperty(objects, "quadrants", "showQuadrants"), DEFAULT_SETTINGS.showQuadrants),
    showThresholdLabels: readBoolean(readProperty(objects, "quadrants", "showThresholdLabels"), DEFAULT_SETTINGS.showThresholdLabels),
    showAxes: readBoolean(readProperty(objects, "axes", "showAxes"), DEFAULT_SETTINGS.showAxes),
    showAxisLabels: readBoolean(readProperty(objects, "axes", "showAxisLabels"), DEFAULT_SETTINGS.showAxisLabels),
    minMarkerSize,
    maxMarkerSize,
    markerOpacity: clamp(readNumber(readProperty(objects, "markers", "markerOpacity"), DEFAULT_SETTINGS.markerOpacity), 0, 1),
    showLabels: readBoolean(readProperty(objects, "labels", "showLabels"), DEFAULT_SETTINGS.showLabels),
    labelDensity: clamp(Math.round(readNumber(readProperty(objects, "labels", "labelDensity"), DEFAULT_SETTINGS.labelDensity)), 1, 100),
    showLegend: readBoolean(readProperty(objects, "legend", "showLegend"), DEFAULT_SETTINGS.showLegend)
  };
}

function descriptor(objectName: string, propertyName: string): powerbi.visuals.FormattingDescriptor {
  return { objectName, propertyName };
}

function dropdownSlice(
  uid: string,
  objectName: string,
  propertyName: string,
  displayName: string,
  value: ThresholdMode,
  translate: Translation
): powerbi.visuals.FormattingSlice {
  const items: powerbi.IEnumMember[] = thresholdModes.map((mode) => ({
    value: mode,
    displayName: translate(`Threshold_${mode}`)
  }));
  return {
    uid,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.Dropdown,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value: { value, displayName: translate(`Threshold_${value}`) },
        items
      }
    }
  };
}

function numberSlice(
  uid: string,
  objectName: string,
  propertyName: string,
  displayName: string,
  value: number
): powerbi.visuals.FormattingSlice {
  return {
    uid,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.NumUpDown,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value
      }
    }
  };
}

function toggleSlice(
  uid: string,
  objectName: string,
  propertyName: string,
  displayName: string,
  value: boolean
): powerbi.visuals.FormattingSlice {
  return {
    uid,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.ToggleSwitch,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value
      }
    }
  };
}

function sliderSlice(
  uid: string,
  objectName: string,
  propertyName: string,
  displayName: string,
  value: number
): powerbi.visuals.FormattingSlice {
  return {
    uid,
    displayName,
    control: {
      type: powerbi.visuals.FormattingComponent.Slider,
      properties: {
        descriptor: descriptor(objectName, propertyName),
        value
      }
    }
  };
}

export function buildFormattingModel(settings: VisualSettings, translate: Translation): powerbi.visuals.FormattingModel {
  const descriptors = [
    "xThresholdMode",
    "yThresholdMode",
    "xFixed",
    "yFixed",
    "xBenchmark",
    "yBenchmark",
    "showRegression",
    "showSemanticTable",
    "showQuadrants",
    "showThresholdLabels"
  ].map((propertyName) => descriptor("quadrants", propertyName));
  descriptors.push(
    descriptor("axes", "showAxes"),
    descriptor("axes", "showAxisLabels"),
    descriptor("markers", "minMarkerSize"),
    descriptor("markers", "maxMarkerSize"),
    descriptor("markers", "markerOpacity"),
    descriptor("labels", "showLabels"),
    descriptor("labels", "labelDensity"),
    descriptor("legend", "showLegend")
  );

  return {
    cards: [
      {
        uid: "quadrants",
        displayName: translate("Format_Quadrants"),
        groups: [
          {
            uid: "thresholds",
            displayName: translate("Format_Thresholds"),
            slices: [
              dropdownSlice("xThresholdMode", "quadrants", "xThresholdMode", translate("Format_XThresholdMode"), settings.xMode, translate),
              dropdownSlice("yThresholdMode", "quadrants", "yThresholdMode", translate("Format_YThresholdMode"), settings.yMode, translate),
              numberSlice("xFixed", "quadrants", "xFixed", translate("Format_XFixed"), settings.xFixed ?? 0),
              numberSlice("yFixed", "quadrants", "yFixed", translate("Format_YFixed"), settings.yFixed ?? 0),
              numberSlice("xBenchmark", "quadrants", "xBenchmark", translate("Format_XBenchmark"), settings.xBenchmark ?? 0),
              numberSlice("yBenchmark", "quadrants", "yBenchmark", translate("Format_YBenchmark"), settings.yBenchmark ?? 0),
              toggleSlice("showRegression", "quadrants", "showRegression", translate("Format_ShowRegression"), settings.showRegression),
              toggleSlice("showSemanticTable", "quadrants", "showSemanticTable", translate("Format_ShowSemanticTable"), settings.showSemanticTable),
              toggleSlice("showQuadrants", "quadrants", "showQuadrants", translate("Format_ShowQuadrants"), settings.showQuadrants),
              toggleSlice("showThresholdLabels", "quadrants", "showThresholdLabels", translate("Format_ShowThresholdLabels"), settings.showThresholdLabels)
            ]
          }
        ],
        revertToDefaultDescriptors: descriptors
      },
      {
        uid: "axes",
        displayName: translate("Format_Axes"),
        groups: [{
          uid: "axisVisibility",
          displayName: translate("Format_AxisVisibility"),
          slices: [
            toggleSlice("showAxes", "axes", "showAxes", translate("Format_ShowAxes"), settings.showAxes),
            toggleSlice("showAxisLabels", "axes", "showAxisLabels", translate("Format_ShowAxisLabels"), settings.showAxisLabels)
          ]
        }],
        revertToDefaultDescriptors: [descriptor("axes", "showAxes"), descriptor("axes", "showAxisLabels")]
      },
      {
        uid: "markers",
        displayName: translate("Format_Markers"),
        groups: [{
          uid: "markerStyle",
          displayName: translate("Format_MarkerStyle"),
          slices: [
            numberSlice("minMarkerSize", "markers", "minMarkerSize", translate("Format_MinMarkerSize"), settings.minMarkerSize),
            numberSlice("maxMarkerSize", "markers", "maxMarkerSize", translate("Format_MaxMarkerSize"), settings.maxMarkerSize),
            sliderSlice("markerOpacity", "markers", "markerOpacity", translate("Format_MarkerOpacity"), settings.markerOpacity)
          ]
        }],
        revertToDefaultDescriptors: [
          descriptor("markers", "minMarkerSize"),
          descriptor("markers", "maxMarkerSize"),
          descriptor("markers", "markerOpacity")
        ]
      },
      {
        uid: "labels",
        displayName: translate("Format_Labels"),
        groups: [{
          uid: "labelStyle",
          displayName: translate("Format_LabelStyle"),
          slices: [
            toggleSlice("showLabels", "labels", "showLabels", translate("Format_ShowLabels"), settings.showLabels),
            numberSlice("labelDensity", "labels", "labelDensity", translate("Format_LabelDensity"), settings.labelDensity)
          ]
        }],
        revertToDefaultDescriptors: [descriptor("labels", "showLabels"), descriptor("labels", "labelDensity")]
      },
      {
        uid: "legend",
        displayName: translate("Format_Legend"),
        groups: [{
          uid: "legendVisibility",
          displayName: translate("Format_LegendVisibility"),
          slices: [toggleSlice("showLegend", "legend", "showLegend", translate("Format_ShowLegend"), settings.showLegend)]
        }],
        revertToDefaultDescriptors: [descriptor("legend", "showLegend")]
      }
    ]
  };
}
