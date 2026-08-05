// Captures the AppSource listing screenshots from the *packaged* bundle and stylesheet, so
// the images always show what actually ships. The offline harness is shared with the layout
// probe (scripts/visual-harness.cjs) rather than duplicated here.
const fs = require("node:fs");
const path = require("node:path");

const {
  root,
  packageName,
  fail,
  resolveBrowser,
  readPackageResources,
  buildDataView,
  stylesheetNeedsShadowRoot,
  harnessHtml,
  runBrowser
} = require("./visual-harness.cjs");

const workDirectory = path.join(root, ".tmp", "screenshots");
const outputDirectory = path.join(root, "assets", "screenshots");
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

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

function capture(browser, htmlPath, pngPath) {
  const result = runBrowser(browser, [
    `--window-size=${SCREENSHOT_WIDTH},${SCREENSHOT_HEIGHT}`,
    "--virtual-time-budget=4000",
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`
  ]);
  if (result.error) {
    fail(`Screenshot generation failed: browser could not start: ${result.error.message}`);
  }
  if (!fs.existsSync(pngPath)) {
    fail(`Screenshot generation failed: browser produced no screenshot.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

(async () => {
  const browser = resolveBrowser("Screenshot generation");
  const resources = await readPackageResources();
  const shadowRoot = stylesheetNeedsShadowRoot(resources.css);
  fs.rmSync(workDirectory, { recursive: true, force: true });
  fs.mkdirSync(workDirectory, { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  console.log(`Using browser: ${browser}`);
  console.log(`Using bundle from ${packageName} (${resources.origin}, ${resources.js.length} bytes of JS, ${resources.css.length} bytes of CSS)`);

  for (const scenario of scenarios) {
    const htmlPath = path.join(workDirectory, `${scenario.file}.html`);
    const pngPath = path.join(outputDirectory, scenario.file);
    fs.writeFileSync(htmlPath, harnessHtml({
      css: resources.css,
      js: resources.js,
      data: buildDataView(scenario),
      width: SCREENSHOT_WIDTH,
      height: SCREENSHOT_HEIGHT,
      shadowRoot
    }), "utf8");
    fs.rmSync(pngPath, { force: true });
    capture(browser, htmlPath, pngPath);
    const header = readPngHeader(pngPath);
    if (header.width !== SCREENSHOT_WIDTH || header.height !== SCREENSHOT_HEIGHT) {
      fail(`Screenshot generation failed: ${scenario.file} is ${header.width}x${header.height}, expected ${SCREENSHOT_WIDTH}x${SCREENSHOT_HEIGHT}.`);
    }
    if (header.bytes > MAX_SCREENSHOT_BYTES) {
      fail(`Screenshot generation failed: ${scenario.file} is ${header.bytes} bytes, above the ${MAX_SCREENSHOT_BYTES} byte AppSource limit.`);
    }
    console.log(`Captured ${scenario.file} (${header.width}x${header.height}, ${header.bytes} bytes) - ${scenario.caption}`);
  }
})().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
