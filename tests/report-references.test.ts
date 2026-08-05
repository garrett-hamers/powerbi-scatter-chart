import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");

// Resolved at runtime from the emitted dist-tests/tests/ location.
const { inspectReportReferences, customVisualItemPath } = require("../../scripts/report-references.cjs") as {
  inspectReportReferences: (input: {
    report: unknown;
    exists: (relativePath: string) => boolean;
  }) => string[];
  customVisualItemPath: (packageName: string, itemPath: string) => string;
};

const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const GUID: string = manifest.visual.guid;

const reportRoot = path.join(
  root, "samples", "AtlynScatterSample", "AtlynScatterSample.Report"
);

function realReport(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(reportRoot, "definition", "report.json"), "utf8"));
}

function realExists(relativePath: string): boolean {
  return fs.existsSync(path.join(reportRoot, ...relativePath.split("/")));
}

test("the shipped sample report resolves every file it claims to ship", () => {
  assert.deepEqual(inspectReportReferences({ report: realReport(), exists: realExists }), []);
});

test("a CustomVisual item resolves under CustomVisuals/<name>/resources/", () => {
  assert.equal(
    customVisualItemPath(GUID, `${GUID}.pbiviz.json`),
    `CustomVisuals/${GUID}/resources/${GUID}.pbiviz.json`
  );
  // The rule is only meaningful if that path is where the file actually lives.
  assert.equal(realExists(customVisualItemPath(GUID, `${GUID}.pbiviz.json`)), true);
});

// The exact defect that stopped two sibling repos' sample reports from opening in Power BI
// Desktop: a SharedResources package claiming BaseThemes/CY24SU10.json ships inside the
// report, when CY24SU10 is a base theme built into Desktop and exists nowhere in samples/.
test("rejects a SharedResources package claiming a base theme ships in the report", () => {
  const report = realReport() as { resourcePackages: unknown[] };
  report.resourcePackages = [
    {
      name: "SharedResources",
      type: "SharedResources",
      items: [{ name: "CY24SU10", path: "BaseThemes/CY24SU10.json", type: "BaseTheme" }]
    },
    ...report.resourcePackages
  ];
  const problems = inspectReportReferences({ report, exists: realExists });
  assert.ok(problems.length > 0, "the defect that broke two sibling repos must be caught");
  assert.match(problems.join(" | "), /base theme ships inside the report/);
  assert.match(problems.join(" | "), /referenced through themeCollection/);
});

test("catches the base theme smuggled in under a different package type", () => {
  const report = realReport() as { resourcePackages: unknown[] };
  report.resourcePackages = [
    { name: "Themes", type: "CustomTheme", items: [{ name: "CY24SU10", path: "BaseThemes/CY24SU10.json" }] },
    ...report.resourcePackages
  ];
  assert.match(
    inspectReportReferences({ report, exists: realExists }).join(" | "),
    /base theme ships inside the report/
  );
});

test("rejects a CustomVisual pointer that does not resolve on disk", () => {
  const report = realReport() as { resourcePackages: Array<Record<string, unknown>> };
  const custom = report.resourcePackages.find((entry) => entry.type === "CustomVisual") as
    { items: Array<Record<string, unknown>> };
  custom.items = [{ name: "missing.pbiviz.json", path: "missing.pbiviz.json", type: "CustomVisualMetadata" }];
  const problems = inspectReportReferences({ report, exists: realExists });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not exist/);
  assert.match(problems[0], /fails to open the report/);
});

test("rejects a CustomVisual package renamed away from its folder", () => {
  const report = realReport() as { resourcePackages: Array<Record<string, unknown>> };
  const custom = report.resourcePackages.find((entry) => entry.type === "CustomVisual") as
    Record<string, unknown>;
  custom.name = "atlynScatterRenamed";
  assert.match(
    inspectReportReferences({ report, exists: realExists }).join(" | "),
    /does not exist/
  );
});

test("reports an unrecognised package type instead of passing over it", () => {
  const report = realReport() as { resourcePackages: unknown[] };
  report.resourcePackages = [
    { name: "Mystery", type: "SomethingNew", items: [{ name: "a", path: "a.json" }] },
    ...report.resourcePackages
  ];
  assert.match(
    inspectReportReferences({ report, exists: realExists }).join(" | "),
    /unrecognised package type/
  );
});

test("requires the themeCollection the report schema mandates", () => {
  const withoutTheme = realReport();
  delete (withoutTheme as Record<string, unknown>).themeCollection;
  assert.match(
    inspectReportReferences({ report: withoutTheme, exists: realExists }).join(" | "),
    /missing themeCollection\.baseTheme/
  );

  // Naming the base theme here is a reference to what Desktop already has, and is correct.
  const report = realReport() as { themeCollection: { baseTheme: { name: string; type: string } } };
  assert.equal(report.themeCollection.baseTheme.name, "CY24SU10");
  assert.equal(report.themeCollection.baseTheme.type, "SharedResources");
  assert.deepEqual(inspectReportReferences({ report, exists: realExists }), []);
});

test("notices a report that embeds no visual at all", () => {
  const report = realReport() as Record<string, unknown>;
  report.resourcePackages = [];
  assert.match(
    inspectReportReferences({ report, exists: realExists }).join(" | "),
    /declares no resourcePackages/
  );
});
