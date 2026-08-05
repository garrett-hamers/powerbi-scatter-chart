// Shared offline harness used by the screenshot generator and the layout probe.
// Both load the *packaged* bundle and the *packaged* stylesheet out of the built
// .pbiviz so what gets measured is exactly what ships, never the source tree.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(root, "dist", packageName);

const { flatRows, matrixRegions, matrixProducts, matrixCells } = require("./sample-data.cjs");

function fail(message) {
  throw new Error(message);
}

function resolveBrowser(context = "Screenshot generation") {
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
    `${context} failed: no Chromium-based browser was found. Install Microsoft Edge or Google Chrome, ` +
    "or set ATLYN_BROWSER to the browser executable. Results are never fabricated."
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

// Small viewports and overflowing content are different tests. This fixture is deliberately
// large so the visual's scrollable regions genuinely exceed their containers and can be
// scrolled: a fixture whose content happens to fit makes every scroll-time assertion vacuous.
// Values are generated deterministically so the probe stays reproducible.
function buildOverflowDataView(options = {}) {
  const categoryCount = options.categoryCount ?? 320;
  const seriesCount = options.seriesCount ?? 12;
  const categories = [];
  for (let index = 0; index < categoryCount; index += 1) {
    // Long names on purpose: they stress legend chips, data labels and table columns.
    categories.push(`Portfolio line item ${String(index + 1).padStart(3, "0")} - extended label`);
  }
  const value = (seed, spread, offset) => Math.round(((seed * 37) % spread) * 100) / 100 + offset;
  if (!options.grouped) {
    return {
      grouped: false,
      objects: options.objects ?? null,
      categories,
      margins: categories.map((_, index) => value(index + 1, 60, 5)),
      growth: categories.map((_, index) => value(index + 7, 45, -15)),
      revenue: categories.map((_, index) => value(index + 13, 900, 100))
    };
  }
  const groups = [];
  for (let series = 0; series < seriesCount; series += 1) {
    groups.push({
      name: `Regional operating segment ${String.fromCharCode(65 + series)}`,
      margins: categories.map((_, index) => value(index + series + 1, 60, 5)),
      growth: categories.map((_, index) => value(index + series + 7, 45, -15)),
      revenue: categories.map((_, index) => value(index + series + 13, 900, 100))
    });
  }
  return { grouped: true, objects: options.objects ?? null, categories, groups };
}

// Power BI hands the visual an element inside a shadow root. The harness mirrors that
// whenever the packaged stylesheet relies on :host, and can be forced either way so the
// probe can prove which mode was used instead of assuming.
function stylesheetNeedsShadowRoot(css) {
  return /:host\b/.test(css);
}

function harnessHtml(options) {
  const {
    css,
    js,
    data,
    width,
    height,
    shadowRoot = false,
    locale = "en-US",
    highContrast = false,
    reducedMotion = false,
    allowInteractions = true,
    documentDir = "ltr",
    probeScript = ""
  } = options;
  return `<!doctype html>
<html lang="en" dir="${documentDir}">
<head>
<meta charset="utf-8">
<title>Atlyn Scatter harness</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #atlyn-viewport {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: #ffffff;
  }
</style>
${shadowRoot ? "" : `<style id="atlyn-visual-style">${css}</style>`}
</head>
<body>
<div id="atlyn-viewport"></div>
<script>window.powerbi = window.powerbi || {};</script>
<script>${js}</script>
<script>
(function () {
  var data = ${JSON.stringify(data)};
  var useShadowRoot = ${shadowRoot ? "true" : "false"};
  var cssText = ${JSON.stringify(css)};
  var viewport = document.getElementById("atlyn-viewport");
  var element = document.createElement("div");
  if (useShadowRoot) {
    var shadow = viewport.attachShadow({ mode: "open" });
    var styleNode = document.createElement("style");
    styleNode.textContent = cssText;
    shadow.appendChild(styleNode);
    shadow.appendChild(element);
  } else {
    viewport.appendChild(element);
  }
  window.__atlynRoot = element;
  window.__atlynViewport = viewport;
  window.__atlynShadow = useShadowRoot;

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
  var highContrast = ${highContrast ? "true" : "false"};
  var selectionCallback = null;
  var currentSelection = [];

  if (${reducedMotion ? "true" : "false"} && window.matchMedia) {
    var nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      if (String(query).indexOf("prefers-reduced-motion") !== -1) {
        return { matches: true, media: query, addListener: function () {}, removeListener: function () {} };
      }
      return nativeMatchMedia(query);
    };
  }

  var host = {
    locale: ${JSON.stringify(locale)},
    hostCapabilities: { allowInteractions: ${allowInteractions ? "true" : "false"} },
    colorPalette: {
      isHighContrast: highContrast,
      foreground: { value: highContrast ? "#ffffff" : "#252423" },
      foregroundSelected: { value: highContrast ? "#1aebff" : "#000000" },
      background: { value: highContrast ? "#000000" : "#ffffff" },
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
        select: function (id) { currentSelection = [id]; return Promise.resolve(currentSelection); },
        clear: function () { currentSelection = []; return Promise.resolve(); },
        showContextMenu: function () { return Promise.resolve(); },
        hasSelection: function () { return currentSelection.length > 0; },
        getSelectionIds: function () { return currentSelection; },
        registerOnSelectCallback: function (callback) { selectionCallback = callback; }
      };
    },
    createLocalizationManager: function () {
      return { getDisplayName: function (key) { return key; } };
    },
    createSelectionIdBuilder: selectionIdBuilder
  };
  window.__atlynFireSelection = function (ids) {
    currentSelection = ids;
    if (selectionCallback) { selectionCallback(ids); }
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
  window.__atlynDataView = dataView;

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
    window.__atlynVisual = visual;
    visual.update({
      dataViews: [dataView],
      viewport: { width: ${width}, height: ${height} },
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
${probeScript ? `<script>\n${probeScript}\n</script>` : ""}
</body>
</html>
`;
}

function runBrowser(browser, args, timeout = 120000) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "atlyn-harness-"));
  // Hosted CI images run headless Chromium without a usable sandbox or a large /dev/shm.
  const ciFlags = process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
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
      ...ciFlags,
      `--user-data-dir=${profile}`,
      ...args
    ], { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
    return result;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

module.exports = {
  root,
  manifest,
  packageName,
  packagePath,
  fail,
  resolveBrowser,
  readPackageResources,
  buildDataView,
  buildOverflowDataView,
  stylesheetNeedsShadowRoot,
  harnessHtml,
  runBrowser
};
