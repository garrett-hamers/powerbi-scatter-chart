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
  assert.equal(mapping.conditions[0].Category.min, 1);
  assert.equal(mapping.conditions[0].X.min, 1);
  assert.equal(mapping.conditions[0].Y.min, 1);
  assert.equal(mapping.categorical.categories.dataReductionAlgorithm.window.count, 10000);
  assert.equal(mapping.categorical.values.group.by, "Series");
  const selectedRoles = mapping.categorical.values.group.select.map((item: any) => item.for.in);
  assert.deepEqual(selectedRoles, ["X", "Y", "Size", "Gradient", "Tooltips"]);
  assert.equal(capabilities.supportsEmptyDataView, true);
  assert.equal("supportsLandingPage" in capabilities, false);
});

test("keeps formatting, localization, and privilege metadata aligned", () => {
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8")) as any;
  const resources = JSON.parse(fs.readFileSync(
    path.join(root, "stringResources", "en-US", "resources.resjson"),
    "utf8"
  )) as Record<string, string>;
  assert.deepEqual(capabilities.privileges, []);
  for (const objectName of ["quadrants", "axes", "markers", "labels", "legend"]) {
    assert.ok(capabilities.objects[objectName]);
    assert.ok(capabilities.objects[objectName].displayNameKey);
    for (const property of Object.values(capabilities.objects[objectName].properties) as any[]) {
      assert.ok(property.displayNameKey);
      assert.equal(typeof resources[property.displayNameKey], "string");
    }
  }
  for (const role of capabilities.dataRoles) {
    assert.equal(typeof resources[role.displayNameKey], "string");
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")).stringResources, []);
});
