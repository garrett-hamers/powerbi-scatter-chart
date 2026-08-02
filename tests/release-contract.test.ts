import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");

test("declares direct release tooling and complete audit gates", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as any;
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as any;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  assert.equal(packageJson.scripts.lint, "eslint . --max-warnings=0");
  assert.equal(packageJson.scripts["lint:full"], "eslint . --max-warnings=0");
  assert.equal(packageJson.scripts["certification-audit"], "pbiviz lint");
  assert.equal(packageJson.scripts.audit, "npm audit --audit-level=low");
  for (const dependency of ["typescript", "eslint", "@eslint/js", "eslint-plugin-powerbi-visuals"]) {
    assert.equal(typeof packageJson.devDependencies[dependency], "string");
    assert.equal(typeof lockfile.packages[""].devDependencies[dependency], "string");
  }
  assert.equal(manifest.visual.version, `${packageJson.version}.0`);
  assert.equal(manifest.capabilities, "capabilities.json");
  assert.equal(manifest.visual.guid, "atlynScatter");
});

test("includes source metadata required for release review", () => {
  for (const file of ["LICENSE", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is required`);
  }
});
