// Generates the offline AppSource sample report as a Power BI project (PBIP).
//
// A .pbix cannot be produced headlessly: its DataModel part is a binary Analysis Services
// backup image. This script emits the source-controlled PBIP equivalent - PBIR report JSON
// plus a TMDL semantic model - which Power BI Desktop converts to .pbix with a single
// "Save as" (see samples/README.md). No .pbix is fabricated here.
//
// Everything is deterministic: fixed identifiers, literal data, and the visual bundle taken
// straight out of the freshly built dist/*.pbiviz.

const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const { matrixRows } = require("./sample-data.cjs");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const capabilities = JSON.parse(fs.readFileSync(path.join(root, manifest.capabilities), "utf8"));
const guid = manifest.visual.guid;
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(root, "dist", packageName);

const PROJECT = "AtlynScatterSample";
const TABLE = "ProductPerformance";
const sampleRoot = path.join(root, "samples", PROJECT);
const reportRoot = path.join(sampleRoot, `${PROJECT}.Report`);
const modelRoot = path.join(sampleRoot, `${PROJECT}.SemanticModel`);

// Schema identifiers are `const` in the published schemas, so these exact URLs are required.
const SCHEMA = {
  pbip: "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
  platform: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
  pbir: "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json",
  pbism: "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
  version: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
  report: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.1.0/schema.json",
  pages: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
  page: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
  visual: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.7.0/schema.json"
};

// Fixed logical identifiers keep regeneration byte-for-byte stable.
const REPORT_LOGICAL_ID = "6f7c2a10-4b1e-4f6a-9d3c-8a5e2b7c1d01";
const MODEL_LOGICAL_ID = "6f7c2a10-4b1e-4f6a-9d3c-8a5e2b7c1d02";

const roleNames = new Set(capabilities.dataRoles.map((role) => role.name));

function fail(message) {
  throw new Error(`Sample report generation failed: ${message}`);
}

function requireRole(name) {
  if (!roleNames.has(name)) {
    fail(`"${name}" is not a data role in ${manifest.capabilities}.`);
  }
  return name;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

// A grouping role binds a column directly.
function columnProjection(column) {
  return {
    field: {
      Column: {
        Expression: { SourceRef: { Entity: TABLE } },
        Property: column
      }
    },
    queryRef: `${TABLE}.${column}`,
    nativeQueryRef: column
  };
}

// A measure role binds an aggregation. Function 0 is Sum, Function 1 is Average.
//
// Percentages must use Average: the model grain is one row per product and region, so on the
// pages that do not bind Series, Sum would add a product's margin across all four regions and
// produce a meaningless total. Average returns the per-product rate, and on the page that does
// bind Series each group is a single row, so Average returns that row's value unchanged.
function aggregateProjection(column, aggregate) {
  const functions = { sum: 0, average: 1 };
  const labels = { sum: "Sum", average: "Average" };
  return {
    field: {
      Aggregation: {
        Expression: {
          Column: {
            Expression: { SourceRef: { Entity: TABLE } },
            Property: column
          }
        },
        Function: functions[aggregate]
      }
    },
    queryRef: `${labels[aggregate]}(${TABLE}.${column})`,
    nativeQueryRef: `${labels[aggregate]} of ${column}`
  };
}

function textLiteral(value) {
  return { expr: { Literal: { Value: `'${value}'` } } };
}

function numberLiteral(value) {
  return { expr: { Literal: { Value: `${value}D` } } };
}

function boolLiteral(value) {
  return { expr: { Literal: { Value: value ? "true" : "false" } } };
}

const pages = [
  {
    name: "pageQuadrantOverview",
    displayName: "1 - Quadrant overview",
    visualName: "visualQuadrantOverview",
    title: "Product performance by margin and growth",
    withSeries: false,
    objects: undefined
  },
  {
    name: "pageSeriesBreakdown",
    displayName: "2 - Series breakdown",
    visualName: "visualSeriesBreakdown",
    title: "Margin and growth by product and region",
    withSeries: true,
    objects: undefined
  },
  {
    name: "pageBenchmarkThresholds",
    displayName: "3 - Benchmark thresholds",
    visualName: "visualBenchmarkThresholds",
    title: "Performance against a 30% margin and 10% growth benchmark",
    withSeries: false,
    objects: {
      quadrants: [
        {
          properties: {
            xThresholdMode: textLiteral("benchmark"),
            yThresholdMode: textLiteral("benchmark"),
            xBenchmark: numberLiteral(30),
            yBenchmark: numberLiteral(10)
          }
        }
      ],
      labels: [
        {
          properties: {
            showLabels: boolLiteral(true),
            labelDensity: numberLiteral(100)
          }
        }
      ]
    }
  }
];

function visualJson(page) {
  const queryState = {
    [requireRole("Category")]: { projections: [columnProjection("Product")] },
    [requireRole("X")]: { projections: [aggregateProjection("Gross margin %", "average")] },
    [requireRole("Y")]: { projections: [aggregateProjection("Revenue growth %", "average")] },
    [requireRole("Size")]: { projections: [aggregateProjection("Revenue", "sum")] }
  };
  if (page.withSeries) {
    queryState[requireRole("Series")] = { projections: [columnProjection("Region")] };
  }

  const visual = {
    visualType: guid,
    query: { queryState },
    visualContainerObjects: {
      title: [{ properties: { text: textLiteral(page.title) } }]
    },
    drillFilterOtherVisuals: true
  };
  if (page.objects) {
    visual.objects = page.objects;
  }

  return {
    $schema: SCHEMA.visual,
    name: page.visualName,
    position: { x: 40, y: 40, z: 0, height: 800, width: 1520, tabOrder: 0 },
    visual
  };
}

function tmdlRows() {
  return matrixRows()
    .map((row) => `\t\t\t\t        {"${row.product}", "${row.region}", ${row.margin}, ${row.growth}, ${row.revenue}}`)
    .join(",\n");
}

// The sample data is a DAX calculated table, not a Power Query partition. A calculated table has
// no data source at all, so the model carries no connection, prompts for no credentials, and needs
// no refresh: the engine materialises it while loading the model. An M partition would leave the
// project with empty tables until the owner ran a manual refresh.
function tableTmdl() {
  const columnAggregates = {
    Product: "none",
    Region: "none",
    "Gross margin %": "average",
    "Revenue growth %": "average",
    Revenue: "sum"
  };
  const columnTypes = {
    Product: "STRING",
    Region: "STRING",
    "Gross margin %": "DOUBLE",
    "Revenue growth %": "DOUBLE",
    Revenue: "DOUBLE"
  };
  const columnNames = Object.keys(columnAggregates);

  const columns = columnNames.map((column) => {
    const quoted = /^[A-Za-z_][A-Za-z0-9_]*$/.test(column) ? column : `'${column}'`;
    return [
      `\tcolumn ${quoted}`,
      `\t\tsummarizeBy: ${columnAggregates[column]}`,
      "\t\tisNameInferred",
      `\t\tsourceColumn: [${column}]`,
      "",
      "\t\tannotation SummarizationSetBy = Automatic"
    ].join("\n");
  });

  const declarations = columnNames
    .map((column) => `\t\t\t\t    "${column}", ${columnTypes[column]},`)
    .join("\n");

  return [
    "/// Offline sample data for the Atlyn Scatter AppSource listing. Defined as a DAX calculated",
    "/// table so the model has no data source, needs no credentials, and needs no refresh.",
    `table ${TABLE}`,
    "",
    columns.join("\n\n"),
    "",
    `\tpartition ${TABLE} = calculated`,
    "\t\tmode: import",
    "\t\tsource =",
    "\t\t\t\tDATATABLE(",
    declarations,
    "\t\t\t\t    {",
    tmdlRows(),
    "\t\t\t\t    }",
    "\t\t\t\t)",
    ""
  ].join("\n");
}

async function writeCustomVisual() {
  if (!fs.existsSync(packagePath)) {
    fail(`${path.relative(root, packagePath)} is missing. Run "npm run package" first.`);
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(packagePath));
  const entries = Object.keys(zip.files).filter((entry) => !zip.files[entry].dir);
  const resourceEntry = entries.find((entry) => entry.startsWith("resources/") && entry.endsWith(".json"));
  if (!resourceEntry) {
    fail(`could not locate the resource descriptor inside ${packageName}.`);
  }

  const target = path.join(reportRoot, "CustomVisuals", guid);
  fs.rmSync(target, { recursive: true, force: true });

  // The report embeds the unzipped package so it renders with no AppSource lookup.
  const metadata = await zip.files["package.json"].async("string");
  writeText(path.join(target, "package.json"), metadata);
  const resource = await zip.files[resourceEntry].async("string");
  writeText(path.join(target, "resources", `${guid}.pbiviz.json`), resource);
  return { metadataBytes: metadata.length, resourceBytes: resource.length };
}

(async () => {
  fs.rmSync(sampleRoot, { recursive: true, force: true });

  writeJson(path.join(sampleRoot, `${PROJECT}.pbip`), {
    $schema: SCHEMA.pbip,
    version: "1.0",
    artifacts: [{ report: { path: `${PROJECT}.Report` } }],
    settings: { enableAutoRecovery: true }
  });

  writeJson(path.join(reportRoot, ".platform"), {
    $schema: SCHEMA.platform,
    metadata: { type: "Report", displayName: PROJECT },
    config: { version: "2.0", logicalId: REPORT_LOGICAL_ID }
  });

  writeJson(path.join(reportRoot, "definition.pbir"), {
    $schema: SCHEMA.pbir,
    version: "4.0",
    datasetReference: { byPath: { path: `../${PROJECT}.SemanticModel` } }
  });

  writeJson(path.join(reportRoot, "definition", "version.json"), {
    $schema: SCHEMA.version,
    version: "2.0.0"
  });

  // themeCollection is required by the report schema. SharedResources means the theme ships
  // with Power BI, so no theme file has to travel with the report.
  // resourcePackages embeds the visual. publicCustomVisuals is deliberately absent: it
  // resolves the visual from the AppSource store, which would break offline use.
  writeJson(path.join(reportRoot, "definition", "report.json"), {
    $schema: SCHEMA.report,
    themeCollection: {
      baseTheme: {
        name: "CY24SU10",
        reportVersionAtImport: "5.55",
        type: "SharedResources"
      }
    },
    resourcePackages: [
      {
        name: guid,
        type: "CustomVisual",
        items: [
          {
            name: `${guid}.pbiviz.json`,
            path: `${guid}.pbiviz.json`,
            type: "CustomVisualMetadata"
          }
        ]
      }
    ]
  });

  writeJson(path.join(reportRoot, "definition", "pages", "pages.json"), {
    $schema: SCHEMA.pages,
    pageOrder: pages.map((page) => page.name),
    activePageName: pages[0].name
  });

  for (const page of pages) {
    const pageDirectory = path.join(reportRoot, "definition", "pages", page.name);
    writeJson(path.join(pageDirectory, "page.json"), {
      $schema: SCHEMA.page,
      name: page.name,
      displayName: page.displayName,
      displayOption: "FitToPage",
      height: 900,
      width: 1600
    });
    writeJson(path.join(pageDirectory, "visuals", page.visualName, "visual.json"), visualJson(page));
  }

  const embedded = await writeCustomVisual();

  writeJson(path.join(modelRoot, ".platform"), {
    $schema: SCHEMA.platform,
    metadata: { type: "SemanticModel", displayName: PROJECT },
    config: { version: "2.0", logicalId: MODEL_LOGICAL_ID }
  });

  writeJson(path.join(modelRoot, "definition.pbism"), {
    $schema: SCHEMA.pbism,
    version: "4.2",
    settings: {}
  });

  writeText(path.join(modelRoot, "definition", "database.tmdl"), [
    "database",
    "\tcompatibilityLevel: 1550",
    ""
  ].join("\n"));

  writeText(path.join(modelRoot, "definition", "model.tmdl"), [
    "model Model",
    "\tculture: en-US",
    "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
    "\tsourceQueryCulture: en-US",
    "",
    `ref table ${TABLE}`,
    ""
  ].join("\n"));

  writeText(path.join(modelRoot, "definition", "tables", `${TABLE}.tmdl`), tableTmdl());

  console.log(`Sample report written to ${path.relative(root, sampleRoot).split(path.sep).join("/")}`);
  console.log(`  visualType ${guid} on ${pages.length} pages`);
  console.log(`  ${matrixRows().length} inline rows in ${TABLE}`);
  console.log(`  embedded visual: package.json ${embedded.metadataBytes} bytes, resources ${embedded.resourceBytes} bytes`);
})().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
