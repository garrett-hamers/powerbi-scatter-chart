import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.resolve(__dirname, "..", "..", "src", "visual.ts"), "utf8");

test("implements host interactions and accessible point navigation", () => {
  for (const token of [
    "createSelectionManager",
    "selectionManager.select",
    "selectionManager.clear",
    "selectionManager.showContextMenu",
    "registerOnSelectCallback",
    "keysForSelection",
    "identity.equals",
    "tooltipService",
    "ArrowRight",
    "ArrowLeft",
    "ArrowUp",
    "ArrowDown",
    "role: \"button\"",
    "aria-pressed",
    "data-selected",
    "atlyn-scatter__semantic-table"
  ]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(source.includes("contextMenuService"), false);
});

test("emits rendering lifecycle events and removes listeners on destroy", () => {
  assert.match(source, /renderingStarted/);
  assert.match(source, /renderingFinished/);
  assert.match(source, /renderingFailed/);
  assert.match(source, /renderingStarted\(options\)/);
  assert.match(source, /renderingFinished\(options\)/);
  assert.match(source, /renderingFailed\(options, message\)/);
  assert.match(source, /public destroy\(\)/);
  assert.match(source, /clearRenderListeners/);
});

test("uses grouped series identities, complete highlights, and touch context menus", () => {
  assert.match(source, /\.withSeries\(values, group\)/);
  assert.match(source, /column\.highlights\?\.\[index\]/);
  assert.match(source, /column\?\.highlights\?\.length/);
  assert.match(source, /isHighlightedValue/);
  assert.match(source, /emptySelectionId/);
  assert.match(source, /pointerType === "touch"/);
  assert.match(source, /setTimeout\(\(\) => this\.showContextMenu/);
  assert.match(source, /renderedPointFromEvent/);
  assert.equal(source.includes("this.addListener(circle"), false);
  assert.match(source, /tooltipService\.enabled\(\)/);
  assert.match(source, /tooltipService\.move/);
});

test("keeps accessibility presentation responsive to host preferences", () => {
  for (const token of [
    "this.rtl ? margin.left + plotWidth : margin.left",
    "document.documentElement.dir === \"rtl\"",
    "foregroundSelected",
    "isHighContrast",
    "prefers-reduced-motion",
    "data-reduced-motion",
    "width < 280 || height < 190"
  ]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renders explicit empty, partial, and bounded-data states", () => {
  assert.match(source, /!model \|\| records\.length === 0/);
  assert.match(source, /model\.partialData/);
  assert.match(source, /model\.receivedCount/);
  assert.match(source, /model\.analyzedCount/);
  assert.match(source, /model\.renderedCount/);
});
