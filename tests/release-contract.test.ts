import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");

test("declares direct release tooling and complete audit gates", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as any;
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as any;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  assert.equal(packageJson.scripts.lint, "npx eslint . --ext .js,.jsx,.ts,.tsx");
  assert.equal(packageJson.scripts["lint:full"], "npx eslint . --ext .js,.jsx,.ts,.tsx");
  assert.match(packageJson.scripts["certification-audit"], /pbiviz lint/);
  assert.match(packageJson.scripts["certification-audit"], /node scripts\/certification-audit\.cjs/);
  assert.match(packageJson.scripts["certification-audit"], /npm run reproducibility-audit/);
  assert.equal(packageJson.scripts.audit, "npm audit");
  assert.match(packageJson.scripts.package, /npm run clean/);
  assert.match(packageJson.scripts.package, /node scripts\/normalize-pbiviz\.cjs/);
  assert.equal(packageJson.scripts["reproducibility-audit"], "node scripts/reproducibility-audit.cjs");
  assert.equal(packageJson.devDependencies.jszip, "3.10.1");
  assert.equal(packageJson.devDependencies["write-file-atomic"], "5.0.1");
  assert.equal(packageJson.scripts["release-manifest"], "node scripts/release-manifest.cjs");
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [dependency, version] of Object.entries(packageJson[section])) {
      assert.equal(lockfile.packages[""][section][dependency], version);
    }
  }
  assert.equal(manifest.visual.version, `${packageJson.version}.0`);
  assert.equal(manifest.capabilities, "capabilities.json");
  assert.equal(manifest.visual.guid, "atlynScatter");
});

test("keeps source metadata internally consistent", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as any;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, manifest.capabilities), "utf8")) as any;
  assert.equal(manifest.visual.name, manifest.visual.guid);
  assert.equal(manifest.visual.version, `${packageJson.version}.0`);
  assert.deepEqual(capabilities.privileges, []);
  assert.equal(manifest.dependencies, null);
  assert.equal(fs.existsSync(path.join(root, manifest.style)), true);
  assert.equal(fs.existsSync(path.join(root, manifest.assets.icon)), true);
});

test("includes source metadata required for release review", () => {
  for (const file of ["LICENSE", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} is required`);
  }
});
