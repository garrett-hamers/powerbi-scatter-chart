import assert from "node:assert/strict";
import test from "node:test";
import powerbi from "powerbi-visuals-api";
import { buildFormattingModel, readVisualSettings } from "../src/settings";

function dataViewWithObjects(objects: powerbi.DataViewObjects): powerbi.DataView {
  return { metadata: { objects } } as powerbi.DataView;
}

test("round-trips persisted formatting values into typed visual settings", () => {
  const settings = readVisualSettings(dataViewWithObjects({
    quadrants: {
      xThresholdMode: "benchmark",
      yThresholdMode: "fixed",
      xBenchmark: 12.5,
      yFixed: -3,
      showRegression: false,
      showSemanticTable: false,
      showQuadrants: false,
      showThresholdLabels: false
    },
    axes: { showAxes: false, showAxisLabels: false },
    markers: { minMarkerSize: 6, maxMarkerSize: 18, markerOpacity: 0.42 },
    labels: { showLabels: true, labelDensity: 70 },
    legend: { showLegend: false }
  }));

  assert.equal(settings.xMode, "benchmark");
  assert.equal(settings.yMode, "fixed");
  assert.equal(settings.xBenchmark, 12.5);
  assert.equal(settings.yFixed, -3);
  assert.equal(settings.showRegression, false);
  assert.equal(settings.showSemanticTable, false);
  assert.equal(settings.showQuadrants, false);
  assert.equal(settings.showThresholdLabels, false);
  assert.equal(settings.showAxes, false);
  assert.equal(settings.showAxisLabels, false);
  assert.equal(settings.minMarkerSize, 6);
  assert.equal(settings.maxMarkerSize, 18);
  assert.equal(settings.markerOpacity, 0.42);
  assert.equal(settings.showLabels, true);
  assert.equal(settings.labelDensity, 70);
  assert.equal(settings.showLegend, false);
});

test("clamps persisted marker and label settings to safe rendering bounds", () => {
  const settings = readVisualSettings(dataViewWithObjects({
    markers: { minMarkerSize: 100, maxMarkerSize: 1, markerOpacity: 4 },
    labels: { labelDensity: -10 }
  }));
  assert.equal(settings.minMarkerSize, 24);
  assert.equal(settings.maxMarkerSize, 24);
  assert.equal(settings.markerOpacity, 1);
  assert.equal(settings.labelDensity, 1);
});

test("emits API-5.1 formatting slices for every persisted setting surface", () => {
  const settings = readVisualSettings();
  const model = buildFormattingModel(settings, (key) => key);
  const serialized = JSON.stringify(model);
  for (const descriptor of [
    '"objectName":"quadrants"',
    '"objectName":"axes"',
    '"objectName":"markers"',
    '"objectName":"labels"',
    '"objectName":"legend"',
    '"propertyName":"xThresholdMode"',
    '"propertyName":"showRegression"',
    '"propertyName":"showSemanticTable"',
    '"propertyName":"markerOpacity"',
    '"propertyName":"labelDensity"',
    '"propertyName":"showLegend"'
  ]) {
    assert.match(serialized, new RegExp(descriptor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(model.cards.length, 5);
});
