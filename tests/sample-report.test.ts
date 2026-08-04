import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(__dirname, "..", "..");
const sampleRoot = path.join(root, "samples", "AtlynScatterSample");
const reportRoot = path.join(sampleRoot, "AtlynScatterSample.Report");
const modelRoot = path.join(sampleRoot, "AtlynScatterSample.SemanticModel");
const pagesRoot = path.join(reportRoot, "definition", "pages");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")) as any;
const capabilities = JSON.parse(fs.readFileSync(path.join(root, manifest.capabilities), "utf8")) as any;
const guid = manifest.visual.guid as string;

function readJson(...segments: string[]): any {
  return JSON.parse(fs.readFileSync(path.join(...segments), "utf8"));
}

function pageNames(): string[] {
  return fs.readdirSync(pagesRoot).filter((entry) => entry !== "pages.json").sort();
}

function visualDocuments(): any[] {
  const documents: any[] = [];
  for (const pageName of pageNames()) {
    const visualsRoot = path.join(pagesRoot, pageName, "visuals");
    for (const visualName of fs.readdirSync(visualsRoot)) {
      documents.push(readJson(visualsRoot, visualName, "visual.json"));
    }
  }
  return documents;
}

test("ships every part the PBIR sample report needs", () => {
  for (const relative of [
    "AtlynScatterSample.pbip",
    "AtlynScatterSample.Report/.platform",
    "AtlynScatterSample.Report/definition.pbir",
    "AtlynScatterSample.Report/definition/version.json",
    "AtlynScatterSample.Report/definition/report.json",
    "AtlynScatterSample.Report/definition/pages/pages.json",
    `AtlynScatterSample.Report/CustomVisuals/${guid}/package.json`,
    `AtlynScatterSample.Report/CustomVisuals/${guid}/resources/${guid}.pbiviz.json`,
    "AtlynScatterSample.SemanticModel/.platform",
    "AtlynScatterSample.SemanticModel/definition.pbism",
    "AtlynScatterSample.SemanticModel/definition/database.tmdl",
    "AtlynScatterSample.SemanticModel/definition/model.tmdl",
    "AtlynScatterSample.SemanticModel/definition/tables/ProductPerformance.tmdl"
  ]) {
    assert.equal(fs.existsSync(path.join(sampleRoot, relative)), true, `${relative} is required`);
  }

  const pages = pageNames();
  assert.ok(pages.length >= 1, "the sample report needs at least one page");
  const pagesMetadata = readJson(pagesRoot, "pages.json");
  assert.deepEqual([...pagesMetadata.pageOrder].sort(), pages);
  assert.ok(pages.includes(pagesMetadata.activePageName));
  for (const pageName of pages) {
    const page = readJson(pagesRoot, pageName, "page.json");
    assert.equal(page.name, pageName, "page name must match its folder");
    assert.equal(page.displayOption, "FitToPage");
    assert.ok(page.displayName.length > 0);
  }

  // The report definition points at the local semantic model, never a remote connection.
  const pbir = readJson(reportRoot, "definition.pbir");
  assert.equal(pbir.datasetReference.byPath.path, "../AtlynScatterSample.SemanticModel");
  assert.equal("byConnection" in pbir.datasetReference, false);
});

test("binds the visual by GUID to real capability data roles", () => {
  const roleNames = new Set<string>(capabilities.dataRoles.map((role: { name: string }) => role.name));
  const documents = visualDocuments();
  assert.equal(documents.length, pageNames().length, "every page carries one visual");

  for (const document of documents) {
    assert.equal(document.visual.visualType, guid, "visualType must be the pbiviz GUID");
    assert.equal(typeof document.name, "string");
    assert.ok(document.position.height > 0 && document.position.width > 0);

    const queryState = document.visual.query.queryState;
    const boundRoles = Object.keys(queryState);
    assert.ok(boundRoles.length > 0, "the visual must bind at least one role");
    for (const role of boundRoles) {
      assert.equal(roleNames.has(role), true, `queryState key "${role}" is not a capabilities data role`);
      assert.ok(Array.isArray(queryState[role].projections) && queryState[role].projections.length > 0);
      for (const projection of queryState[role].projections) {
        assert.ok(projection.field, "each projection needs a field");
        assert.equal(typeof projection.queryRef, "string");
      }
    }
    for (const required of ["Category", "X", "Y"]) {
      assert.equal(boundRoles.includes(required), true, `capabilities require the ${required} role`);
    }
  }

  // Percentages must aggregate with Average (Function 1); summing a rate across regions
  // would misreport every product on the pages that do not bind Series.
  for (const document of visualDocuments()) {
    for (const role of ["X", "Y"]) {
      const aggregation = document.visual.query.queryState[role].projections[0].field.Aggregation;
      assert.equal(aggregation.Function, 1, `${role} must use the Average aggregation`);
    }
    const size = document.visual.query.queryState.Size?.projections[0].field.Aggregation;
    assert.equal(size.Function, 0, "Size must use the Sum aggregation");
  }
});

test("embeds the visual so the report renders with no store lookup", () => {
  const report = readJson(reportRoot, "definition", "report.json");
  assert.equal("publicCustomVisuals" in report, false, "publicCustomVisuals resolves from AppSource and breaks offline use");
  assert.equal("organizationCustomVisuals" in report, false);

  const custom = report.resourcePackages.find((entry: any) => entry.type === "CustomVisual");
  assert.ok(custom, "a CustomVisual resource package is required");
  assert.equal(custom.name, guid);
  assert.deepEqual(custom.items, [
    { name: `${guid}.pbiviz.json`, path: `${guid}.pbiviz.json`, type: "CustomVisualMetadata" }
  ]);

  const embedded = readJson(reportRoot, "CustomVisuals", guid, "resources", `${guid}.pbiviz.json`);
  assert.equal(embedded.visual.guid, guid);
  assert.equal(embedded.visual.version, manifest.visual.version);
  assert.ok(embedded.content.js.length > 0, "the embedded bundle must not be empty");
  assert.ok(embedded.content.css.includes(".atlyn-scatter"), "the embedded stylesheet must be present");
});

test("sources the sample data from inline literals only", () => {
  const tmdl = fs.readFileSync(
    path.join(modelRoot, "definition", "tables", "ProductPerformance.tmdl"),
    "utf8"
  );
  assert.match(tmdl, /partition ProductPerformance = m/);
  assert.match(tmdl, /mode: import/);
  assert.match(tmdl, /#table\(/, "data must come from an inline table literal");

  const insecureProtocol = `${"http"}://`;
  const secureProtocol = `${"https"}://`;
  for (const connector of [
    "Sql.Database",
    "Web.Contents",
    "File.Contents",
    "Excel.Workbook",
    "Csv.Document",
    "OData.Feed",
    "Odbc.DataSource",
    "SharePoint.",
    "AzureStorage.",
    "Folder.Files",
    insecureProtocol,
    secureProtocol
  ]) {
    assert.equal(tmdl.includes(connector), false, `${connector} would require an external connection`);
  }

  // 32 product-and-region rows, so a refresh needs no credentials and no network.
  const rows = tmdl.split("\n").filter((line) => /^\s*\{".+", ".+",/.test(line));
  assert.equal(rows.length, 32);
});
