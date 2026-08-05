import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");

// Resolved at runtime from the emitted dist-tests/tests/ location, so the literal path the
// linter requires points back at the repository's scripts/ directory.
const { inspectPackage, isSourceTreeShaped } = require("../../scripts/pbiviz-structure.cjs") as {
  inspectPackage: (input: {
    entries: string[];
    fileEntries: string[];
    manifest?: unknown;
    resource?: unknown;
    guid: string;
    version: string;
  }) => string[];
  isSourceTreeShaped: (entry: string) => boolean;
};

const manifestSource = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const GUID: string = manifestSource.visual.guid;
const VERSION: string = manifestSource.visual.version;
const RESOURCE = `resources/${GUID}.pbiviz.json`;

function goodManifest(): Record<string, unknown> {
  return {
    version: VERSION,
    resources: [{ resourceId: "rId0", sourceType: 5, file: RESOURCE }],
    visual: { guid: GUID },
    metadata: { pbivizjson: { resourceId: "rId0" } }
  };
}

function goodResource(): Record<string, unknown> {
  return {
    visual: { guid: GUID },
    capabilities: {},
    content: {
      js: "window.powerbi = window.powerbi || {};",
      css: ".atlyn-scatter { color: #252423; }",
      iconBase64: "data:image/png;base64,iVBORw0KGgo="
    }
  };
}

function inspectGood(overrides: Partial<Parameters<typeof inspectPackage>[0]> = {}): string[] {
  return inspectPackage({
    entries: ["package.json", "resources/", RESOURCE],
    fileEntries: ["package.json", RESOURCE],
    manifest: goodManifest(),
    resource: goodResource(),
    guid: GUID,
    version: VERSION,
    ...overrides
  });
}

test("accepts the two-entry layout the webpack plugin produces", () => {
  assert.deepEqual(inspectGood(), []);
});

// The exact shape a sibling repo shipped: a source tree in a zip, with no manifest and no
// resources/ directory. Every content-level check would pass on it because there is no
// content to check, which is precisely why the container needs its own assertion.
test("rejects a source-tree-shaped archive with no manifest", () => {
  const entries = [
    "pbiviz.json",
    "capabilities.json",
    "style/visual.less",
    "visual.js",
    "assets/icon.png",
    "stringResources/en-US/resources.resjson"
  ];
  const problems = inspectPackage({
    entries,
    fileEntries: entries,
    manifest: undefined,
    resource: undefined,
    guid: GUID,
    version: VERSION
  });
  assert.ok(problems.length > 0, "a source-tree archive must be rejected");
  assert.ok(
    problems.some((p) => /source-tree shaped/.test(p)),
    `expected a source-tree diagnosis, got: ${problems.join(" | ")}`
  );
  assert.ok(
    problems.some((p) => /package\.json manifest entry is missing/.test(p)),
    `expected a missing-manifest diagnosis, got: ${problems.join(" | ")}`
  );
});

test("rejects a manifest whose resource pointer does not resolve", () => {
  const manifest = goodManifest();
  (manifest.resources as Array<Record<string, unknown>>)[0].file = "resources/wrong-name.pbiviz.json";
  const problems = inspectGood({ manifest });
  assert.ok(
    problems.some((p) => /does not resolve to a zip entry/.test(p)),
    `expected an unresolved-pointer diagnosis, got: ${problems.join(" | ")}`
  );
});

test("rejects a resourceId that does not match the declared resource", () => {
  const manifest = goodManifest();
  (manifest.metadata as { pbivizjson: { resourceId: string } }).pbivizjson.resourceId = "rId7";
  const problems = inspectGood({ manifest });
  assert.ok(
    problems.some((p) => /metadata\.pbivizjson\.resourceId/.test(p)),
    `expected a resourceId mismatch, got: ${problems.join(" | ")}`
  );
});

test("rejects a resource that is not declared with sourceType 5", () => {
  const manifest = goodManifest();
  delete (manifest.resources as Array<Record<string, unknown>>)[0].sourceType;
  const problems = inspectGood({ manifest });
  assert.ok(
    problems.some((p) => /sourceType must be 5/.test(p)),
    `expected a sourceType diagnosis, got: ${problems.join(" | ")}`
  );
});

test("rejects an archive that smuggles extra files alongside the two entries", () => {
  const entries = ["package.json", "resources/", RESOURCE, "visual.js"];
  const problems = inspectGood({ entries, fileEntries: ["package.json", RESOURCE, "visual.js"] });
  assert.ok(
    problems.some((p) => /source-tree shaped/.test(p)),
    `expected a stray-entry diagnosis, got: ${problems.join(" | ")}`
  );
  assert.ok(
    problems.some((p) => /exactly two file entries/.test(p)),
    `expected an entry-count diagnosis, got: ${problems.join(" | ")}`
  );
});

test("rejects an inline resource with no stylesheet, the bug that hid a broken layout", () => {
  const resource = goodResource();
  (resource.content as Record<string, unknown>).css = "";
  const problems = inspectGood({ resource });
  assert.ok(
    problems.some((p) => /content\.css is missing or empty/.test(p)),
    `expected a missing-stylesheet diagnosis, got: ${problems.join(" | ")}`
  );
});

test("classifies source-tree markers without touching the real package", () => {
  for (const entry of ["pbiviz.json", "capabilities.json", "visual.js", "style/visual.less", "assets/icon.png", "stringResources/en-US/resources.resjson"]) {
    assert.equal(isSourceTreeShaped(entry), true, `${entry} must be recognised as source-tree shaped`);
  }
  for (const entry of ["package.json", RESOURCE]) {
    assert.equal(isSourceTreeShaped(entry), false, `${entry} is a legitimate package entry`);
  }
});
