import assert from "node:assert/strict";
import test from "node:test";
import { buildScatterModel, calculateRegression } from "../src/domain";

test("validates numeric X and Y and classifies inclusive boundaries", () => {
  const model = buildScatterModel([
    { category: "right-high", x: 10, y: 10 },
    { category: "left-high", x: 9, y: 10 },
    { category: "left-low", x: 9, y: 9 },
    { category: "right-low", x: 10, y: 9 },
    { category: "bad-x", x: "10", y: 5 },
    { category: "bad-y", x: 5, y: Number.NaN }
  ], { xMode: "fixed", yMode: "fixed", xFixed: 10, yFixed: 10 });

  assert.equal(model.validCount, 4);
  assert.equal(model.invalidRows, 2);
  assert.equal(model.points[0].quadrant, "upper-right");
  assert.equal(model.points[0].onXThreshold, true);
  assert.equal(model.points[0].onYThreshold, true);
  assert.deepEqual(model.counts, {
    "upper-right": 1,
    "upper-left": 1,
    "lower-left": 1,
    "lower-right": 1
  });
  assert.equal(model.boundaryCount, 3);
});

test("computes visible mean and median provenance", () => {
  const mean = buildScatterModel([
    { category: "a", x: 1, y: 2 },
    { category: "b", x: 3, y: 4 }
  ], { xMode: "mean", yMode: "median" });
  assert.equal(mean.xThreshold.value, 2);
  assert.equal(mean.yThreshold.value, 3);
  assert.match(mean.xThreshold.provenance, /mean of 2/);
  assert.match(mean.yThreshold.provenance, /median of 2/);
});

test("computes explicit OLS equation and R2", () => {
  const model = buildScatterModel([
    { category: "a", x: 1, y: 3 },
    { category: "b", x: 2, y: 5 },
    { category: "c", x: 3, y: 7 }
  ]);
  assert.equal(model.regression.valid, true);
  assert.equal(model.regression.slope, 2);
  assert.equal(model.regression.intercept, 1);
  assert.equal(model.regression.r2, 1);
  assert.equal(model.regression.equation, "y = 2x + 1");
});

test("hides regression for insufficient points or zero X variance", () => {
  assert.equal(calculateRegression([{ category: "a", x: 1, y: 2, tooltips: {}, highlighted: false }]).valid, false);
  const constantX = calculateRegression([
    { category: "a", x: 1, y: 2, tooltips: {}, highlighted: false },
    { category: "b", x: 1, y: 3, tooltips: {}, highlighted: false }
  ]);
  assert.equal(constantX.valid, false);
  assert.match(constantX.reason ?? "", /zero variance/);
});

test("bounds rendering and discloses reduction while retaining all visible statistics", () => {
  const model = buildScatterModel(Array.from({ length: 10001 }, (_, index) => ({
    category: String(index),
    x: index,
    y: index * 2
  })), { maxPoints: 10000 });
  assert.equal(model.receivedCount, 10001);
  assert.equal(model.validCount, 10001);
  assert.equal(model.renderedCount, 10000);
  assert.equal(model.reduced, true);
  assert.equal(model.regression.n, 10001);
  assert.equal(model.counts["upper-right"] + model.counts["upper-left"] + model.counts["lower-left"] + model.counts["lower-right"], 10001);
});
