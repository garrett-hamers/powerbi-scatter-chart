// Measures whether capture is bit-reproducible on this machine, and under which browser flags.
//
// Why this exists as a committed tool rather than a one-off: the screenshot manifest's note
// makes a measured claim about re-capture reproducibility, and a measurement nobody can repeat
// is the same unverifiable claim this pipeline exists to eliminate. Anyone can now re-run it.
//
// Why the claim needs measuring at all: sibling repos disagree. powerbi-hierarchy-explorer
// measured 6-15 pixels of 1,049,088 moving between otherwise identical runs, the signature of
// subpixel coverage computed in float and rounded to integer tipping either side of a boundary.
// powerbi-control-chart measured five byte-identical captures under every flag configuration.
// Both are correct measurements of different repositories: reproducibility is content- and
// build-dependent, so it must be measured per repo rather than assumed in either direction.
//
// Method, following powerbi-control-chart: capture each scene N times with a fresh browser
// process and a fresh user-data-dir every time, hash the PNGs, and report *distinct hashes over
// N* rather than pass/fail. A single identical pair proves nothing when the jitter is
// intermittent by nature. Flag configurations are varied too, because a flag can change what is
// drawn without changing whether it reproduces, and those two effects are easy to conflate.
//
// This is a diagnostic, not a gate. It is deliberately not wired into CI: it is slow, and
// nothing in the pipeline depends on renders being reproducible.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  root,
  packageName,
  resolveBrowser,
  readPackageResources,
  buildDataView,
  stylesheetNeedsShadowRoot,
  harnessHtml,
  runBrowser
} = require("./visual-harness.cjs");
const { scenarios } = require("./generate-screenshots.cjs");

const workDirectory = path.join(root, ".tmp", "determinism");
const SCREENSHOT_WIDTH = 1366;
const SCREENSHOT_HEIGHT = 768;

const runsArgument = process.argv.find((argument) => argument.startsWith("--runs="));
const RUNS = Math.max(2, Number(runsArgument?.slice("--runs=".length) ?? 5));

// runBrowser always prepends these. Dropping one means filtering it back out of that list.
const CONFIGURATIONS = [
  { id: "shipped", label: "shipped harness flags", drop: [] },
  { id: "no-disable-gpu", label: "without --disable-gpu", drop: ["--disable-gpu"] },
  { id: "no-font-hinting", label: "without --font-render-hinting", drop: ["--font-render-hinting=none"] },
  { id: "no-color-profile", label: "without --force-color-profile", drop: ["--force-color-profile=srgb"] },
  {
    id: "bare",
    label: "bare (headless only)",
    drop: [
      "--disable-gpu",
      "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--force-color-profile=srgb",
      "--font-render-hinting=none"
    ]
  }
];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Each call is a fresh browser process, and runBrowser mints and deletes a fresh user-data-dir
// around it, so no state survives between captures.
function captureOnce(browser, htmlPath, pngPath, drop) {
  fs.rmSync(pngPath, { force: true });
  const result = runBrowser(browser, [
    `--window-size=${SCREENSHOT_WIDTH},${SCREENSHOT_HEIGHT}`,
    "--virtual-time-budget=4000",
    `--screenshot=${pngPath}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`
  ], 120000, drop);
  if (result.error || !fs.existsSync(pngPath)) {
    throw new Error(`capture failed: ${result.error?.message ?? result.stderr?.slice(0, 300)}`);
  }
  return sha256(fs.readFileSync(pngPath));
}

(async () => {
  const browser = resolveBrowser("Determinism probe");
  const resources = await readPackageResources();
  const shadowRoot = stylesheetNeedsShadowRoot(resources.css);
  fs.rmSync(workDirectory, { recursive: true, force: true });
  fs.mkdirSync(workDirectory, { recursive: true });

  console.log(`Browser: ${browser}`);
  console.log(`Bundle:  ${packageName} (${resources.js.length} bytes JS, ${resources.css.length} bytes CSS)`);
  console.log(`Method:  ${RUNS} captures per scene per configuration, fresh browser process and profile each time.`);
  console.log("Reporting distinct SHA-256 values over N, because one identical pair proves nothing.");
  console.log("");

  for (const scenario of scenarios) {
    const htmlPath = path.join(workDirectory, `${scenario.file}.html`);
    fs.writeFileSync(htmlPath, harnessHtml({
      css: resources.css,
      js: resources.js,
      data: buildDataView(scenario),
      width: SCREENSHOT_WIDTH,
      height: SCREENSHOT_HEIGHT,
      shadowRoot
    }), "utf8");
  }

  let unstable = 0;
  const rows = [];
  for (const configuration of CONFIGURATIONS) {
    for (const scenario of scenarios) {
      const htmlPath = path.join(workDirectory, `${scenario.file}.html`);
      const pngPath = path.join(workDirectory, `${configuration.id}-${scenario.file}`);
      const hashes = [];
      for (let run = 0; run < RUNS; run += 1) {
        hashes.push(captureOnce(browser, htmlPath, pngPath, configuration.drop));
      }
      const distinct = new Set(hashes);
      if (distinct.size > 1) {
        unstable += 1;
      }
      rows.push({
        configuration: configuration.label,
        scene: scenario.file,
        distinct: distinct.size,
        verdict: distinct.size === 1 ? "STABLE" : "JITTERS",
        hash: hashes[0].slice(0, 12)
      });
    }
  }

  const headers = ["Configuration", "Scene", "Verdict", `Distinct / ${RUNS}`, "First hash"];
  const body = rows.map((row) => [row.configuration, row.scene, row.verdict, String(row.distinct), row.hash]);
  const widths = headers.map((header, index) => Math.max(header.length, ...body.map((cells) => cells[index].length)));
  const line = (cells) => "| " + cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ") + " |";
  console.log(line(headers));
  console.log("|" + widths.map((width) => "-".repeat(width + 2)).join("|") + "|");
  for (const cells of body) {
    console.log(line(cells));
  }
  console.log("");

  // Distinct output hashes across configurations are expected and are not instability: a flag
  // can change what is drawn while the drawing still reproduces exactly.
  const byConfiguration = new Map();
  for (const row of rows) {
    byConfiguration.set(row.configuration, (byConfiguration.get(row.configuration) ?? new Set()).add(row.hash));
  }
  const shipped = rows.filter((row) => row.configuration === CONFIGURATIONS[0].label).map((row) => row.hash).join(",");
  for (const configuration of CONFIGURATIONS.slice(1)) {
    const other = rows.filter((row) => row.configuration === configuration.label).map((row) => row.hash).join(",");
    console.log(`${configuration.label}: output ${other === shipped ? "matches" : "differs from"} the shipped flags.`);
  }
  console.log("");
  console.log(unstable === 0
    ? `Every configuration produced 1 distinct hash over ${RUNS} runs: capture is bit-reproducible on this machine and browser build.`
    : `${unstable} scene/configuration pairs produced more than one distinct hash: capture is NOT bit-reproducible here.`);
  console.log("This is a property of this machine, browser build and drawn content. It is not a");
  console.log("property the pipeline relies on, and it must be re-measured elsewhere rather than assumed.");
})().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
