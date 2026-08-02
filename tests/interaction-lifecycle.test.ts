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
    "tooltipService",
    "contextMenuService",
    "ArrowRight",
    "ArrowLeft",
    "ArrowUp",
    "ArrowDown",
    "role: \"button\"",
    "atlyn-scatter__semantic-table"
  ]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("emits rendering lifecycle events and removes listeners on destroy", () => {
  assert.match(source, /renderingStarted/);
  assert.match(source, /renderingFinished/);
  assert.match(source, /renderingFailed/);
  assert.match(source, /public destroy\(\)/);
  assert.match(source, /clearRenderListeners/);
});
