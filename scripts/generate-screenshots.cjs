// Captures the AppSource listing screenshots from the *packaged* bundle and stylesheet, so
// the images always show what actually ships. The offline harness is shared with the layout
// probe (scripts/visual-harness.cjs) rather than duplicated here.
//
// Every scene is asserted at capture time. A single browser run emits both the PNG and a
// probe of the very frame that was photographed (scripts/screenshot-assertions.cjs), and
// the image is only published into assets/screenshots once the scene proved it rendered
// what its caption claims. The PNG is written to .tmp first precisely so a failing scene
// cannot leave an image behind: shipping a screenshot that fails its own checks is the
// exact defect this gate exists to prevent.
//
// The assertions would otherwise be ephemeral, so a publish run also records what it
// measured, and the SHA-256 of every image it wrote, into the committed
// assets/screenshot-manifest.json (scripts/screenshot-manifest.cjs). Capture-time assertions
// prove a file was right when written; the manifest is what still proves it afterwards.
const fs = require("node:fs");
const path = require("node:path");

const {
  root,
  manifest: pbivizManifest,
  packageName,
  packagePath,
  fail,
  resolveBrowser,
  readPackageResources,
  buildDataView,
  stylesheetNeedsShadowRoot,
  harnessHtml,
  runBrowser
} = require("./visual-harness.cjs");
const { flatRows, matrixProducts, matrixRegions } = require("./sample-data.cjs");
const { probeScript, extractProbe, recordScene, evaluateScene, formatFailures } = require("./screenshot-assertions.cjs");
const {
  manifestPath,
  relative,
  sha256,
  buildManifest,
  writeManifest,
  verifyCommittedScreenshots
} = require("./screenshot-manifest.cjs");

const workDirectory = path.join(root, ".tmp", "screenshots");
const outputDirectory = path.join(root, "assets", "screenshots");
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

// --check captures and asserts exactly as a publish run does, but never touches
// assets/screenshots. It is the form CI runs, so a scene that stops rendering fails the
// build without the committed images churning on a differently-fonted Linux runner. It
// still verifies the committed manifest against the committed bytes, which is a hash
// comparison and therefore platform-independent.
const checkOnly = process.argv.includes("--check");

const FLAT_POINTS = flatRows.length;
const GROUPED_POINTS = matrixProducts.length * matrixRegions.length;
const CATEGORIES = [...new Set([...flatRows.map((row) => row[0]), ...matrixProducts])];

// At 1366x768 the layout plan gives the accessible table min(180, round(768 * 0.34)) = 180px
// and the chart the remaining 588px, so the table is a real, visible band and not a token
// row. The floors below sit under those numbers with room for font-stack differences, and
// still sit far above the zero-height render that once shipped.
const MIN_TABLE_VISIBLE_HEIGHT = 120;
const MIN_TABLE_VISIBLE_ROWS = 4;

// The harness hands the visual the whole tile, so the root fills it exactly.
const rootBox = {
  rootWidth: { equals: SCREENSHOT_WIDTH },
  rootHeight: { equals: SCREENSHOT_HEIGHT },
  elementsEscapingRoot: { equals: 0 }
};

// Shared by every scene: the chart surface has to be drawn, and the accessible table has to
// be *visibly* drawn. These are geometry claims, never presence claims, because the table
// was present in the DOM throughout the entire period it was invisible.
function tableExpectations(rowCount) {
  return {
    tablePresent: { equals: true },
    tableHiddenChain: { equals: false },
    tableRenderedHeight: { atLeast: MIN_TABLE_VISIBLE_HEIGHT },
    tableVisibleHeight: { atLeast: MIN_TABLE_VISIBLE_HEIGHT },
    tableVisibleWidth: { atLeast: 400 },
    tableBodyRows: { equals: rowCount },
    tableVisibleRows: { atLeast: MIN_TABLE_VISIBLE_ROWS },
    tableEscapesRoot: { equals: 0 },
    tableRowsEscapingWrapper: { equals: 0 },
    tableHeaderCells: { equals: 5 },
    tableCaptionText: { someMatches: /^Accessible point table \(rendered \d+\)$/ }
  };
}

const tableBecause = {
  tableRenderedHeight: "The accessible table once laid out at zero height; a screenshot taken then showed no table at all.",
  tableVisibleHeight: "Height inside the visual root, not DOM presence: the broken build had a table element the whole time.",
  tableVisibleRows: "Rows must actually land inside the table's clipped viewport, or the reader sees an empty band.",
  tableEscapesRoot: "The whole table band once rendered outside the visual root, where the host clips it away before it ever reaches the image.",
  tableRowsEscapingWrapper: "Rows outside the table's own scrollable content box are a layout defect, not scrolling."
};

const scenarios = [
  {
    file: "01-quadrant-overview.png",
    grouped: false,
    objects: null,
    caption: "Default median thresholds with quadrant shading, regression line and bubble sizing.",
    // Claims: every product plotted, four shaded quadrants, both median guides, a fitted
    // regression line, size-varied bubbles, no legend (single series), no data labels.
    expect: {
      ...rootBox,
      svgPresent: { equals: true },
      svgVisibleHeight: { atLeast: 400 },
      points: { equals: FLAT_POINTS },
      pointsOutsideRoot: { equals: 0 },
      pointsFullyVisible: { equals: FLAT_POINTS },
      distinctPointRadii: { atLeast: 10 },
      quadrantBands: { equals: 4 },
      quadrantHatches: { equals: 4 },
      quadrantBandAreaRatio: { atLeast: 0.3 },
      quadrantLabels: { equals: 4 },
      thresholdLines: { equals: 2 },
      thresholdLabelTexts: { everyMatches: /^threshold -?[\d.,]+$/ },
      regressionLines: { equals: 1 },
      annotationTexts: { someMatches: /X threshold: median of \d+ visible points/ },
      legendMarkers: { equals: 0 },
      dataLabels: { equals: 0 },
      ...tableExpectations(FLAT_POINTS)
    },
    because: {
      ...tableBecause,
      regressionLines: "The caption promises a regression line; points alone are not this scene.",
      quadrantBands: "Quadrant shading is the whole point of the scene, and it fails independently of the points.",
      distinctPointRadii: "Bubble sizing is claimed, so every marker sharing one radius means the size encoding is gone.",
      legendMarkers: "A single-series scene must not draw a legend; one appearing means the wrong data view was captured."
    }
  },
  {
    file: "02-series-and-size.png",
    grouped: true,
    objects: null,
    caption: "Grouped series with legend, size-encoded bubbles and per-series colouring.",
    // Claims: the full product-by-region matrix, one legend chip per region carrying the
    // region's own name, a distinct colour per series and size-varied bubbles.
    expect: {
      ...rootBox,
      svgPresent: { equals: true },
      svgVisibleHeight: { atLeast: 400 },
      points: { equals: GROUPED_POINTS },
      pointsOutsideRoot: { equals: 0 },
      pointsFullyVisible: { equals: GROUPED_POINTS },
      distinctPointFills: { atLeast: matrixRegions.length },
      distinctPointRadii: { atLeast: 10 },
      legendMarkers: { equals: matrixRegions.length },
      legendLabelTexts: { sameSet: matrixRegions },
      quadrantBands: { equals: 4 },
      quadrantHatches: { equals: 4 },
      thresholdLines: { equals: 2 },
      regressionLines: { equals: 1 },
      dataLabels: { equals: 0 },
      ...tableExpectations(GROUPED_POINTS)
    },
    because: {
      ...tableBecause,
      legendLabelTexts: "The legend is the scene: if a region is missing from it, the image no longer shows grouped series.",
      distinctPointFills: "Per-series colouring is claimed, so one colour across all markers means the grouping was lost."
    }
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
    caption: "Explicit benchmark thresholds with data labels turned on.",
    // Claims: thresholds explicitly at x=30 / y=10 rather than the medians, provenance text
    // that says so, and a data label on essentially every point. Points rendering correctly
    // is not sufficient for this scene: the thresholds and the labels are what it
    // demonstrates, so each is asserted separately and fails on its own.
    expect: {
      ...rootBox,
      svgPresent: { equals: true },
      svgVisibleHeight: { atLeast: 400 },
      points: { equals: FLAT_POINTS },
      pointsOutsideRoot: { equals: 0 },
      pointsFullyVisible: { equals: FLAT_POINTS },
      thresholdLines: { equals: 2 },
      thresholdLabelTexts: { sameSet: ["threshold 30", "threshold 10"] },
      annotationTexts: { someMatches: /X threshold: benchmark 30; Y threshold: benchmark 10/ },
      dataLabels: { atLeast: 20 },
      quadrantBands: { equals: 4 },
      quadrantHatches: { equals: 4 },
      regressionLines: { equals: 1 },
      legendMarkers: { equals: 0 },
      ...tableExpectations(FLAT_POINTS)
    },
    because: {
      ...tableBecause,
      thresholdLabelTexts: "This scene exists to show explicit benchmarks; median guides here would be the wrong picture even with every point drawn.",
      annotationTexts: "The provenance line must name the benchmarks, otherwise the image claims a threshold source it did not use.",
      dataLabels: "Data labels at full density are half the caption; losing them silently leaves a scene identical to 01."
    }
  }
];

function readPngHeader(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    fail(`Screenshot generation failed: ${path.relative(root, filePath)} is not a PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length
  };
}

// One browser run produces the PNG and the probe together, so the assertions describe the
// exact frame that was photographed rather than a second, hopefully identical, render.
function capture(browser, htmlPath, pngPath) {
  const result = runBrowser(browser, [
    `--window-size=${SCREENSHOT_WIDTH},${SCREENSHOT_HEIGHT}`,
    "--virtual-time-budget=4000",
    `--screenshot=${pngPath}`,
    "--dump-dom",
    `file:///${htmlPath.replace(/\\/g, "/")}`
  ]);
  if (result.error) {
    fail(`Screenshot generation failed: browser could not start: ${result.error.message}`);
  }
  if (!fs.existsSync(pngPath)) {
    fail(`Screenshot generation failed: browser produced no screenshot.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  if (!result.stdout) {
    fail(`Screenshot generation failed: browser produced no DOM to assert against.\nstderr: ${result.stderr}`);
  }
  return result.stdout;
}

// Exported so the audits can check the committed manifest still describes the scenes this
// generator actually defines. Requiring this file must therefore not start a capture.
module.exports = { scenarios };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}

async function main() {
  const browser = resolveBrowser("Screenshot generation");
  const resources = await readPackageResources();
  const shadowRoot = stylesheetNeedsShadowRoot(resources.css);
  fs.rmSync(workDirectory, { recursive: true, force: true });
  fs.mkdirSync(workDirectory, { recursive: true });
  if (!checkOnly) {
    fs.mkdirSync(outputDirectory, { recursive: true });
  }
  console.log(`Using browser: ${browser}`);
  console.log(`Using bundle from ${packageName} (${resources.origin}, ${resources.js.length} bytes of JS, ${resources.css.length} bytes of CSS)`);
  console.log(checkOnly
    ? "Mode: --check (scenes are captured and asserted; assets/screenshots is left untouched)"
    : "Mode: publish (a scene is only written to assets/screenshots once its assertions pass)");

  const scene = probeScript(CATEGORIES);
  const records = [];
  for (const scenario of scenarios) {
    const htmlPath = path.join(workDirectory, `${scenario.file}.html`);
    const stagedPath = path.join(workDirectory, scenario.file);
    const publishedPath = path.join(outputDirectory, scenario.file);
    fs.writeFileSync(htmlPath, harnessHtml({
      css: resources.css,
      js: resources.js,
      data: buildDataView(scenario),
      width: SCREENSHOT_WIDTH,
      height: SCREENSHOT_HEIGHT,
      shadowRoot,
      probeScript: scene
    }), "utf8");
    fs.rmSync(stagedPath, { force: true });

    const dom = capture(browser, htmlPath, stagedPath);
    const probe = extractProbe(dom);
    const failures = evaluateScene(scenario, probe);
    if (failures.length > 0) {
      // Never leave the previous image sitting in place looking current while the scene it
      // depicts no longer renders. Removing it makes the failure impossible to overlook.
      if (!checkOnly && fs.existsSync(publishedPath)) {
        fs.rmSync(publishedPath, { force: true });
        console.error(`Removed the stale ${path.relative(root, publishedPath)}: its scene no longer renders.`);
      }
      fail(formatFailures(scenario, failures));
    }

    const header = readPngHeader(stagedPath);
    if (header.width !== SCREENSHOT_WIDTH || header.height !== SCREENSHOT_HEIGHT) {
      fail(`Screenshot generation failed: ${scenario.file} is ${header.width}x${header.height}, expected ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}.`);
    }
    if (header.bytes > MAX_SCREENSHOT_BYTES) {
      fail(`Screenshot generation failed: ${scenario.file} is ${header.bytes} bytes, above the ${MAX_SCREENSHOT_BYTES} byte AppSource limit.`);
    }
    if (!checkOnly) {
      fs.copyFileSync(stagedPath, publishedPath);
    }

    // Hash the bytes that were actually published, so the manifest vouches for the file in
    // the repository rather than for the staged copy it was made from.
    const publishedBytes = fs.readFileSync(checkOnly ? stagedPath : publishedPath);
    records.push({
      file: scenario.file,
      caption: scenario.caption,
      png: {
        width: header.width,
        height: header.height,
        bytes: publishedBytes.length,
        sha256: sha256(publishedBytes)
      },
      assertions: recordScene(scenario, probe)
    });

    const m = probe.metrics;
    console.log(`${checkOnly ? "Verified" : "Captured"} ${scenario.file} (${header.width}x${header.height}, ${header.bytes} bytes) - ${scenario.caption}`);
    console.log(
      `  asserted: ${m.points} points, ${m.quadrantBands} quadrant bands, ${m.thresholdLines} threshold guides, ` +
      `${m.regressionLines} regression line, ${m.legendMarkers} legend chips, ${m.dataLabels} data labels, ` +
      `table ${m.tableVisibleHeight}px visible with ${m.tableVisibleRows}/${m.tableBodyRows} rows in view`
    );
  }

  if (!checkOnly) {
    writeManifest(buildManifest({
      visual: {
        name: pbivizManifest.visual.name,
        version: pbivizManifest.visual.version,
        guid: pbivizManifest.visual.guid
      },
      bundle: packageName,
      bundleSha256: sha256(fs.readFileSync(packagePath)),
      bundleOrigin: resources.origin,
      bundleJsBytes: resources.js.length,
      bundleCssBytes: resources.css.length
    }, records));
    console.log(`Recorded ${records.length} scenes and their image hashes in ${relative(manifestPath)}.`);
  }

  // In --check this compares the committed manifest against the committed bytes, never
  // against the render just produced: a Linux capture is legitimately a different image, but
  // the recorded hash must still describe what is in the repository. After a publish run it
  // is a self-check that what was just written verifies.
  const problems = verifyCommittedScreenshots();
  if (problems.length > 0) {
    fail(
      "Screenshot verification failed: the committed images no longer match the capture that asserted them.\n" +
      problems.map((problem) => `  - ${problem}`).join("\n")
    );
  }
  console.log(`Verified ${relative(manifestPath)} against the committed images: every screenshot still hashes to what its capture recorded.`);
}
