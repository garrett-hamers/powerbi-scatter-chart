import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");

test("keeps the stable visual identity and certification-first capabilities", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8")) as any;
  assert.equal(manifest.visual.guid, "atlynScatter");
  assert.equal(manifest.visual.name, "atlynScatter");
  assert.deepEqual(capabilities.privileges, []);
  assert.equal(capabilities.supportsHighlight, true);
  assert.equal(capabilities.supportsMultiVisualSelection, true);
  assert.equal(capabilities.supportsKeyboardFocus, true);
  const roleNames = capabilities.dataRoles.map((role: { name: string }) => role.name);
  assert.deepEqual(roleNames, ["Category", "X", "Y", "Series", "Size", "Gradient", "Tooltips"]);
});

test("declares bounded categorical reduction and the complete optional role contract", () => {
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8")) as any;
  const mapping = capabilities.dataViewMappings[0];
  assert.equal(mapping.categorical.categories.dataReductionAlgorithm.window.count, 10000);
  const selectedRoles = mapping.categorical.values.select.map((item: any) => item.for.in);
  assert.deepEqual(selectedRoles, ["X", "Y", "Series", "Size", "Gradient", "Tooltips"]);
});
