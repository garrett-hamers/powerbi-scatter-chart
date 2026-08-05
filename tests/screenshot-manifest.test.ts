import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Compiled tests run from dist-tests/tests, so the require points back at the repository's
// scripts/ directory.
const { inspectCaptureBinding } = require("../../scripts/screenshot-manifest.cjs") as {
  inspectCaptureBinding: (manifest: unknown, context: unknown) => string[];
};

const root = path.resolve(__dirname, "..", "..");
const manifestPath = path.join(root, "assets", "screenshot-manifest.json");

interface Scene {
  file: string;
  caption: string;
}

function committedManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
}

// The context the certification audit builds from the freshly packaged artifact. Derived from
// the committed manifest so the baseline is, by construction, the passing case.
function matchingContext(manifest: Record<string, unknown>): Record<string, unknown> {
  const capture = manifest.capture as Record<string, unknown>;
  return {
    visual: manifest.visual,
    packageName: capture.bundle,
    bundleSha256: capture.bundleSha256,
    bundleOrigin: capture.bundleOrigin,
    bundleJsBytes: capture.bundleJsBytes,
    bundleCssBytes: capture.bundleCssBytes,
    scenarios: (manifest.scenes as Scene[]).map((scene) => ({ file: scene.file, caption: scene.caption }))
  };
}

test("the committed screenshot manifest matches the visual it records", () => {
  const manifest = committedManifest();
  assert.deepEqual(inspectCaptureBinding(manifest, matchingContext(manifest)), []);
});

// The defect this gate exists for: the visual changes, the screenshots are not re-captured,
// and the committed images silently depict a build that no longer exists. That is exactly how
// screenshots of a zero-height accessible table reached the submission assets.
test("a bundle rebuilt without re-capturing the screenshots is rejected", () => {
  const manifest = committedManifest();
  const context = matchingContext(manifest);
  context.bundleSha256 = "0".repeat(64);
  const problems = inspectCaptureBinding(manifest, context);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /captured from a different build of the visual/);
  assert.match(problems[0], /Run "npm run screenshots"/);
});

// A same-length edit leaves the byte counts untouched, so the hash has to be the check that
// decides. Flipping a boolean default is precisely this shape.
test("a same-length bundle edit is still caught, because the hash is the deciding check", () => {
  const manifest = committedManifest();
  const context = matchingContext(manifest);
  context.bundleSha256 = "a".repeat(64);
  const problems = inspectCaptureBinding(manifest, context);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /captured from a different build/);
});

test("every recorded capture field is compared against the packaged visual", () => {
  const cases: Array<[string, (context: Record<string, unknown>) => void, RegExp]> = [
    ["packageName", (context) => { context.packageName = "atlynScatter.9.9.9.9.pbiviz"; }, /capture\.bundle /],
    ["bundleOrigin", (context) => { context.bundleOrigin = "resources/other.json"; }, /capture\.bundleOrigin/],
    ["bundleJsBytes", (context) => { context.bundleJsBytes = 1; }, /capture\.bundleJsBytes/],
    ["bundleCssBytes", (context) => { context.bundleCssBytes = 1; }, /capture\.bundleCssBytes/]
  ];
  for (const [label, mutate, expected] of cases) {
    const manifest = committedManifest();
    const context = matchingContext(manifest);
    mutate(context);
    const problems = inspectCaptureBinding(manifest, context);
    assert.equal(problems.length, 1, `${label} should produce exactly one problem`);
    assert.match(problems[0], expected);
  }
});

test("a version bump without re-capturing the screenshots is rejected", () => {
  const manifest = committedManifest();
  const context = matchingContext(manifest);
  context.visual = { ...(manifest.visual as Record<string, unknown>), version: "9.9.9.9" };
  const problems = inspectCaptureBinding(manifest, context);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /visual\.version/);
});

// A hand-edited manifest is the other way a recorded value stops describing reality.
test("a doctored manifest is rejected", () => {
  const manifest = committedManifest();
  manifest.generatedBy = "hand-written";
  (manifest.capture as Record<string, unknown>).tile = { width: 800, height: 600 };
  const problems = inspectCaptureBinding(manifest, matchingContext(manifest));
  assert.equal(problems.length, 3);
  assert.ok(problems.some((problem) => /generatedBy/.test(problem)));
  assert.ok(problems.some((problem) => /capture\.tile\.width/.test(problem)));
  assert.ok(problems.some((problem) => /capture\.tile\.height/.test(problem)));
});

test("a scene added to the generator but never captured is rejected", () => {
  const manifest = committedManifest();
  const context = matchingContext(manifest);
  (context.scenarios as Scene[]).push({ file: "04-new-scene.png", caption: "A scene nobody captured." });
  const problems = inspectCaptureBinding(manifest, context);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /04-new-scene\.png/);
});

// Re-describing a scene without re-capturing leaves an image that no longer illustrates the
// claim its caption makes.
test("a scene re-described without being re-captured is rejected", () => {
  const manifest = committedManifest();
  const context = matchingContext(manifest);
  (context.scenarios as Scene[])[0].caption = "Something the picture does not show.";
  const problems = inspectCaptureBinding(manifest, context);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /re-described without being re-captured/);
});
