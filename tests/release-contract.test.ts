import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");
const { portablePath } = require("../../scripts/portable-path.cjs") as {
  portablePath: (value: string) => string;
};

test("normalizes release manifest paths across build platforms", () => {
  assert.equal(portablePath("assets\\screenshots\\example.png"), "assets/screenshots/example.png");
  assert.equal(portablePath("assets/screenshots/example.png"), "assets/screenshots/example.png");
});

test("declares direct release tooling and complete audit gates", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as any;
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as any;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  assert.equal(packageJson.scripts.eslint, "npx eslint . --ext .js,.jsx,.ts,.tsx");
  assert.equal(packageJson.scripts.lint, "npx eslint . --ext .js,.jsx,.ts,.tsx");
  assert.equal(packageJson.scripts["lint:full"], "npx eslint . --ext .js,.jsx,.ts,.tsx");
  assert.match(packageJson.scripts.package, /pbiviz package --certification-audit/);
  assert.match(packageJson.scripts["certification-audit"], /npm run eslint/);
  assert.match(packageJson.scripts["certification-audit"], /pbiviz lint/);
  assert.match(packageJson.scripts["certification-audit"], /node scripts\/certification-audit\.cjs/);
  assert.match(packageJson.scripts["certification-audit"], /npm run reproducibility-audit/);
  assert.equal(packageJson.scripts.audit, "npm audit");
  assert.match(packageJson.scripts.package, /npm run clean/);
  assert.match(packageJson.scripts.package, /node scripts\/normalize-pbiviz\.cjs/);
  assert.equal(packageJson.scripts["reproducibility-audit"], "node scripts/reproducibility-audit.cjs");
  assert.equal(packageJson.scripts["publication-audit"], "node scripts/publication-audit.cjs");
  assert.equal(packageJson.scripts["generate-brand-assets"], "node scripts/generate-brand-assets.cjs");
  assert.equal(packageJson.scripts["generate-sample-report"], "node scripts/generate-sample-report.cjs");
  assert.equal(packageJson.scripts.screenshots, "node scripts/generate-screenshots.cjs");
  assert.match(packageJson.scripts["certification-audit"], /npm run publication-audit/);
  assert.equal(packageJson.devDependencies.jszip, "3.10.1");
  assert.equal(packageJson.devDependencies["write-file-atomic"], "5.0.1");
  assert.equal(packageJson.scripts["release-manifest"], "node scripts/release-manifest.cjs");
  assert.equal(packageJson.engines.node, ">=20.19.0");
  assert.equal(lockfile.version, packageJson.version);
  assert.equal(lockfile.packages[""].version, packageJson.version);
  assert.equal(lockfile.packages[""].engines.node, packageJson.engines.node);
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

function pngHeader(filePath: string): { width: number; height: number; bytes: number } {
  const buffer = fs.readFileSync(filePath);
  assert.equal(
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    true,
    `${filePath} must be a PNG`
  );
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${filePath} must expose an IHDR header`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

test("carries the pbiviz metadata AppSource submission requires", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  for (const field of ["name", "displayName", "guid", "visualClassName", "version", "description", "supportUrl"]) {
    assert.equal(typeof manifest.visual[field], "string", `visual.${field} is required`);
    assert.ok(manifest.visual[field].trim().length > 0, `visual.${field} must not be empty`);
  }
  assert.match(manifest.visual.version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.ok(manifest.visual.description.trim().length >= 40);
  assert.equal(manifest.visual.supportUrl, "https://atlyn.io/contact");
  assert.equal(manifest.visual.supportUrl.startsWith("https://"), true);
  assert.equal(manifest.author.name, "Atlyn");
  assert.equal(manifest.author.email, "atlyn.help@gmail.com");
  assert.match(manifest.author.email, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
  for (const reserved of [".example", ".invalid", ".test", ".localhost"]) {
    assert.equal(manifest.author.email.toLowerCase().endsWith(reserved), false, `reserved domain ${reserved}`);
  }
  assert.equal(manifest.assets.icon, "assets/icon.png");
});

test("ships the exact publication image assets AppSource requires", () => {
  const icon = pngHeader(path.join(root, "assets", "icon.png"));
  assert.deepEqual([icon.width, icon.height], [20, 20]);

  const logo = pngHeader(path.join(root, "assets", "partner-center-logo-300x300.png"));
  assert.deepEqual([logo.width, logo.height], [300, 300]);

  const screenshotDirectory = path.join(root, "assets", "screenshots");
  const screenshots = fs.readdirSync(screenshotDirectory).sort();
  assert.deepEqual(screenshots.filter((name) => !name.endsWith(".png")), []);
  assert.ok(screenshots.length >= 1 && screenshots.length <= 5, "AppSource allows 1 to 5 screenshots");
  for (const name of screenshots) {
    const header = pngHeader(path.join(screenshotDirectory, name));
    assert.deepEqual([header.width, header.height], [1366, 768], `${name} must be 1366x768`);
    assert.ok(header.bytes <= 1024 * 1024, `${name} must be 1024 KB or smaller`);
  }
});

test("keeps the submission paperwork and stylesheet wiring in place", () => {
  assert.equal(fs.existsSync(path.join(root, "EULA.md")), true, "EULA.md is required");
  const dossierPath = path.join(root, "docs", "partner-center-submission.md");
  assert.equal(fs.existsSync(dossierPath), true, "docs/partner-center-submission.md is required");
  const dossier = fs.readFileSync(dossierPath, "utf8");
  assert.match(dossier, /https:\/\/atlyn\.io\/legal\/privacy/);
  assert.match(dossier, /https:\/\/atlyn\.io\/contact/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
  const visualSource = fs.readFileSync(path.join(root, "src", "visual.ts"), "utf8");
  assert.match(
    visualSource,
    /import "\.\/\.\.\/style\/visual\.less";/,
    "src/visual.ts must import the stylesheet so it is bundled into the PBIVIZ"
  );
  assert.equal(manifest.style, "style/visual.less");
});
