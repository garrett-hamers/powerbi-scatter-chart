const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(root, "dist", packageName);
const workDirectory = path.join(root, ".tmp", "screenshots");
const outputDirectory = path.join(root, "assets", "screenshots");
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

// Fully offline sample data. No network access, no generated randomness: the same rows
// produce the same render on every machine.
// Flat dataset - one row per product, used by the single-series scenarios.
const flatRows = [
  ["Aurora Analytics", 41.2, 18.4, 8200000],
  ["Aurora Mobile", 33.8, 24.1, 4100000],
  ["Beacon Reporting", 28.5, 6.2, 5600000],
  ["Cascade Data Prep", 22.4, -3.8, 2400000],
  ["Compass Planning", 36.9, 11.7, 6300000],
  ["Delta Forecasting", 18.2, -9.4, 1500000],
  ["Everest Governance", 44.6, 27.3, 3300000],
  ["Foundry Connectors", 26.1, 2.9, 2100000],
  ["Harbor Streaming", 31.5, 16.2, 3700000],
  ["Ironwood Archive", 16.9, -1.3, 1100000],
  ["Juniper Alerts", 20.9, 5.7, 1000000],
  ["Kestrel Notebooks", 38.4, 14.6, 6900000],
  ["Lantern Catalog", 24.7, 4.1, 4300000],
  ["Meridian Modeling", 47.1, 21.9, 2800000],
  ["Northwind Gateway", 19.8, -6.5, 1900000],
  ["Orchard Lineage", 34.2, 9.8, 5100000],
  ["Pinnacle Semantics", 15.6, -12.1, 1200000],
  ["Quarry Ingest", 29.3, 7.4, 2600000],
  ["Redwood Retention", 27.9, 31.6, 2900000],
  ["Summit Scorecards", 21.3, 12.8, 3100000],
  ["Trellis Workflow", 30.7, 19.4, 3900000],
  ["Umber Masking", 12.4, -4.7, 900000],
  ["Vantage Benchmarks", 42.8, 34.2, 2200000],
  ["Willow Sharing", 25.6, 15.1, 1800000],
  ["Yardstick Metrics", 35.1, 26.8, 3400000],
  ["Zephyr Refresh", 11.7, -14.2, 600000]
];

// Full product-by-region matrix, used by the grouped-series scenario so every
// category/series combination carries a value and no rows are dropped.
const matrixRegions = ["Asia Pacific", "Europe", "Latin America", "North America"];
const matrixProducts = [
  "Aurora Analytics",
  "Beacon Reporting",
  "Cascade Data Prep",
  "Compass Planning",
  "Everest Governance",
  "Foundry Connectors",
  "Harbor Streaming",
  "Juniper Alerts"
];
const matrixCells = {
  "Asia Pacific": [
    [27.9, 31.6, 2900000], [21.3, 12.8, 3100000], [12.4, -4.7, 900000], [30.7, 19.4, 3900000],
    [42.8, 34.2, 2200000], [25.6, 15.1, 1800000], [35.1, 26.8, 3400000], [16.9, -1.3, 1100000]
  ],
  Europe: [
    [38.4, 14.6, 6900000], [24.7, 4.1, 4300000], [19.8, -6.5, 1900000], [34.2, 9.8, 5100000],
    [47.1, 21.9, 2800000], [29.3, 7.4, 2600000], [31.5, 16.2, 3700000], [15.6, -12.1, 1200000]
  ],
  "Latin America": [
    [23.4, 22.7, 1400000], [17.8, 8.3, 1700000], [14.2, -8.9, 800000], [26.8, 13.5, 2000000],
    [39.4, 29.1, 1300000], [20.4, 3.6, 1150000], [28.2, 20.6, 1600000], [11.7, -14.2, 600000]
  ],
  "North America": [
    [41.2, 18.4, 8200000], [28.5, 6.2, 5600000], [22.4, -3.8, 2400000], [36.9, 11.7, 6300000],
    [44.6, 27.3, 3300000], [26.1, 2.9, 2100000], [33.8, 24.1, 4100000], [18.2, -9.4, 1500000]
  ]
};

function fail(message) {
  throw new Error(`Screenshot generation failed: ${message}`);
}

function resolveBrowser() {
  const candidates = [
    process.env.ATLYN_BROWSER,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return fail(
    "no Chromium-based browser was found. Install Microsoft Edge or Google Chrome, " +
    "or set ATLYN_BROWSER to the browser executable. Screenshots are never fabricated."
  );
}

async function readPackageResources() {
  if (!fs.existsSync(packagePath)) {
    fail(`${path.relative(root, packagePath)} is missing. Run "npm run package" first.`);
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(packagePath));
  const names = Object.keys(zip.files);
  for (const name of names) {
    if (!name.startsWith("resources/") || !name.endsWith(".json")) {
      continue;
    }
    const parsed = JSON.parse(await zip.files[name].async("string"));
    if (parsed?.content?.js) {
      return { js: parsed.content.js, css: parsed.content.css ?? "", origin: name };
    }
  }
  const jsEntry = names.find((name) => name.startsWith("resources/") && name.endsWith(".js"));
  const cssEntry = names.find((name) => name.startsWith("resources/") && name.endsWith(".css"));
  if (jsEntry) {
    return {
      js: await zip.files[jsEntry].async("string"),
      css: cssEntry ? await zip.files[cssEntry].async("string") : "",
      origin: jsEntry
    };
  }
  return fail(`could not locate the built bundle inside ${packageName}. Entries: ${names.join(", ")}`);
}

function buildDataView(scenario) {
  if (scenario.grouped) {
    return {
      grouped: true,
      objects: scenario.objects ?? null,
      categories: matrixProducts,
      groups: matrixRegions.map((region) => ({
        name: region,
        margins: matrixCells[region].map((cell) => cell[0]),
        growth: matrixCells[region].map((cell) => cell[1]),
        revenue: matrixCells[region].map((cell) => cell[2])
      }))
    };
  }
  return {
    grouped: false,
    objects: scenario.objects ?? null,
    categories: flatRows.map((row) => row[0]),
    margins: flatRows.map((row) => row[1]),
    growth: flatRows.map((row) => row[2]),
    revenue: flatRows.map((row) => row[3])
  };
}

const scenarios = [
  {
    file: "01-quadrant-overview.png",
    grouped: false,
    objects: null,
    caption: "Default median thresholds with quadrant shading, regression line and bubble sizing."
  },
  {
    file: "02-series-and-size.png",
    grouped: true,
    objects: null,
    caption: "Grouped series with legend, size-encoded bubbles and per-series colouring."
  },
  {
    file: "03-benchmark-thresholds.png",
    grouped: false,
    objects: {
      quadrants: {
        xThresholdMode: "benchmark",
        yThresholdMode: "benchmark",
        xBenchmark: 30,
        yBenchmark: 10
      },
      labels: { showLabels: true, labelDensity: 100 }
    },
    caption: "Explicit benchmark thresholds with data labels turned on."
  }
];

function harnessHtml(css, js, data) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Atlyn Scatter screenshot harness</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #atlyn-host {
    width: ${SCREENSHOT_WIDTH}px;
    height: ${SCREENSHOT_HEIGHT}px;
    overflow: hidden;
    background: #ffffff;
  }
</style>
<style>${css}</style>
</head>
<body>
<div id="atlyn-host"></div>
<script>window.powerbi = window.powerbi || {};</script>
<script>${js}</script>
<script>
(function () {
  var data = ${JSON.stringify(data)};

  function selectionIdBuilder() {
    var parts = [];
    var builder = {
      withCategory: function (category, index) { parts.push("c" + index); return builder; },
      withSeries: function (values, group) {
        parts.push("s" + String(group && group.name !== undefined ? group.name : "all"));
        return builder;
      },
      withMeasure: function (measure) { parts.push("m" + measure); return builder; },
      createSelectionId: function () {
        var key = parts.join("|") || "empty";
        return {
          getKey: function () { return key; },
          equals: function (other) { return !!other && typeof other.getKey === "function" && other.getKey() === key; },
          getSelector: function () { return { data: parts.slice() }; },
          includes: function () { return false; }
        };
      }
    };
    return builder;
  }

  var themeColors = [
    "#118DFF", "#12239E", "#E66C37", "#6B007B",
    "#E044A7", "#744EC2", "#D9B300", "#D64550"
  ];
  var assignedColors = {};
  var assignedCount = 0;

  var host = {
    locale: "en-US",
    hostCapabilities: { allowInteractions: true },
    colorPalette: {
      isHighContrast: false,
      foreground: { value: "#252423" },
      foregroundSelected: { value: "#000000" },
      background: { value: "#ffffff" },
      getColor: function (key) {
        var name = String(key);
        if (!Object.prototype.hasOwnProperty.call(assignedColors, name)) {
          assignedColors[name] = themeColors[assignedCount % themeColors.length];
          assignedCount += 1;
        }
        return { value: assignedColors[name] };
      }
    },
    tooltipService: {
      enabled: function () { return false; },
      show: function () {},
      move: function () {},
      hide: function () {}
    },
    eventService: {
      renderingStarted: function () {},
      renderingFinished: function () { window.__atlynRendered = true; },
      renderingFailed: function (options, reason) { window.__atlynFailed = reason || "unknown"; }
    },
    createSelectionManager: function () {
      return {
        select: function () { return Promise.resolve([]); },
        clear: function () { return Promise.resolve(); },
        showContextMenu: function () { return Promise.resolve(); },
        hasSelection: function () { return false; },
        getSelectionIds: function () { return []; },
        registerOnSelectCallback: function () {}
      };
    },
    createLocalizationManager: function () {
      return { getDisplayName: function (key) { return key; } };
    },
    createSelectionIdBuilder: selectionIdBuilder
  };

  function column(displayName, role, values, type) {
    return {
      source: {
        displayName: displayName,
        queryName: displayName,
        roles: role,
        type: type || { numeric: true },
        format: undefined
      },
      values: values
    };
  }

  var category = {
    source: {
      displayName: "Product",
      queryName: "Product",
      roles: { Category: true },
      type: { text: true }
    },
    values: data.categories,
    identity: data.categories.map(function (name, index) { return { key: name + index }; })
  };

  var values;
  if (data.grouped) {
    var groups = data.groups.map(function (group) {
      return {
        name: group.name,
        identity: { key: group.name },
        values: [
          column("Gross margin %", { X: true }, group.margins),
          column("YoY revenue growth %", { Y: true }, group.growth),
          column("Revenue", { Size: true }, group.revenue)
        ]
      };
    });
    values = [];
    groups.forEach(function (group) {
      group.values.forEach(function (item) { values.push(item); });
    });
    values.grouped = function () { return groups; };
  } else {
    values = [
      column("Gross margin %", { X: true }, data.margins),
      column("YoY revenue growth %", { Y: true }, data.growth),
      column("Revenue", { Size: true }, data.revenue)
    ];
    values.grouped = function () { return [{ values: values }]; };
  }

  var dataView = {
    metadata: {
      columns: [category.source].concat(values.map(function (item) { return item.source; })),
      objects: data.objects || undefined
    },
    categorical: { categories: [category], values: values }
  };

  var element = document.getElementById("atlyn-host");
  var plugin = window.powerbi && window.powerbi.visuals && window.powerbi.visuals.plugins
    ? window.powerbi.visuals.plugins["${manifest.visual.guid}"]
    : undefined;
  if (!plugin) {
    document.body.innerHTML = "<pre id='atlyn-error'>PLUGIN_NOT_FOUND: " +
      Object.keys((window.powerbi && window.powerbi.visuals && window.powerbi.visuals.plugins) || {}).join(",") +
      "</pre>";
    window.__atlynFailed = "plugin-not-found";
    return;
  }
  try {
    var visual = plugin.create({ element: element, host: host });
    visual.update({
      dataViews: [dataView],
      viewport: { width: ${SCREENSHOT_WIDTH}, height: ${SCREENSHOT_HEIGHT} },
      type: 2,
      jsonFilters: [],
      operationKind: 0
    });
    window.__atlynPointCount = element.querySelectorAll(".atlyn-scatter__point").length;
  } catch (error) {
    document.body.innerHTML = "<pre id='atlyn-error'>UPDATE_FAILED: " + (error && error.stack ? error.stack : error) + "</pre>";
    window.__atlynFailed = String(error);
  }
})();
</script>
</body>
</html>
`;
}

function readPngHeader(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    fail(`${path.relative(root, filePath)} is not a PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length
  };
}

function capture(browser, htmlPath, pngPath) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "atlyn-shot-"));
  try {
    const result = spawnSync(browser, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
      `--user-data-dir=${profile}`,
      `--window-size=${SCREENSHOT_WIDTH},${SCREENSHOT_HEIGHT}`,
      "--virtual-time-budget=4000",
      `--screenshot=${pngPath}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`
    ], { encoding: "utf8", timeout: 120000 });
    if (result.error) {
      fail(`browser could not start: ${result.error.message}`);
    }
    if (!fs.existsSync(pngPath)) {
      fail(`browser produced no screenshot.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

(async () => {
  const browser = resolveBrowser();
  const resources = await readPackageResources();
  fs.rmSync(workDirectory, { recursive: true, force: true });
  fs.mkdirSync(workDirectory, { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  console.log(`Using browser: ${browser}`);
  console.log(`Using bundle from ${packageName} (${resources.origin}, ${resources.js.length} bytes of JS)`);

  for (const scenario of scenarios) {
    const htmlPath = path.join(workDirectory, `${scenario.file}.html`);
    const pngPath = path.join(outputDirectory, scenario.file);
    fs.writeFileSync(htmlPath, harnessHtml(resources.css, resources.js, buildDataView(scenario)), "utf8");
    fs.rmSync(pngPath, { force: true });
    capture(browser, htmlPath, pngPath);
    const header = readPngHeader(pngPath);
    if (header.width !== SCREENSHOT_WIDTH || header.height !== SCREENSHOT_HEIGHT) {
      fail(`${scenario.file} is ${header.width}x${header.height}, expected ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}.`);
    }
    if (header.bytes > MAX_SCREENSHOT_BYTES) {
      fail(`${scenario.file} is ${header.bytes} bytes, above the ${MAX_SCREENSHOT_BYTES} byte AppSource limit.`);
    }
    console.log(`Captured ${scenario.file} (${header.width}x${header.height}, ${header.bytes} bytes) - ${scenario.caption}`);
  }
})().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
