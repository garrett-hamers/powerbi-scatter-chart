// Proves the layout regression tests actually catch the defects they were written for.
// Each entry reverts exactly one fix in the working tree, runs the suite, and requires the
// named test to fail. A test that still passes with its fix reverted proves nothing.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

const REVERSIONS = [
  {
    id: "table-outside-root",
    description: "Accessible table stacked past a height:100% SVG inside the clipped root",
    file: "style/visual.less",
    find: `.atlyn-scatter__table {
  flex: 0 0 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  width: 100%;
}`,
    replace: `.atlyn-scatter__table {
  flex: 0 0 auto;
  width: 100%;
}`,
    expectFailing: [
      "every stacked region can actually shrink inside the clipped root",
      "the accessible table scrolls in a wrapper, never on the table box itself"
    ]
  },
  {
    id: "table-scrolls-on-table-box",
    description: "max-height and overflow declared on the <table>, which ignores both",
    file: "style/visual.less",
    find: `.atlyn-scatter__semantic-table {
  border-collapse: collapse;
  font-size: 11px;
  width: 100%;
}`,
    replace: `.atlyn-scatter__semantic-table {
  border-collapse: collapse;
  font-size: 11px;
  max-height: 180px;
  overflow: auto;
  width: 100%;
}`,
    expectFailing: ["the accessible table scrolls in a wrapper, never on the table box itself"]
  },
  {
    id: "root-not-flex",
    description: "Root loses its flex column, so stacked regions fall back to normal flow",
    file: "style/visual.less",
    find: `  display: flex;
  flex-direction: column;`,
    replace: "",
    expectFailing: ["every stacked region can actually shrink inside the clipped root"]
  },
  {
    id: "ellipsis-without-nowrap",
    description: "text-overflow: ellipsis with no white-space: nowrap, so it silently does nothing",
    file: "style/visual.less",
    find: `.atlyn-scatter__message {
  font-size: 13px;`,
    replace: `.atlyn-scatter__message {
  text-overflow: ellipsis;
  font-size: 13px;`,
    expectFailing: ["no ellipsis rule ships without white-space: nowrap"]
  },
  {
    id: "no-table-budget",
    description: "Visible table reserves no height, so the chart claims the whole tile again",
    file: "src/layout.ts",
    find: `  const tableHeight = showTable
    ? Math.min(
      LAYOUT_LIMITS.maxTableHeight,
      Math.max(LAYOUT_LIMITS.minTableHeight, Math.round(height * LAYOUT_LIMITS.tableFraction))
    )
    : 0;`,
    replace: "  const tableHeight = 0;",
    expectFailing: ["reserves real space for the accessible table instead of stacking it past the root"]
  },
  {
    id: "chrome-never-drops",
    description: "Chrome survives every size class, so it overflows narrow tiles again",
    file: "src/layout.ts",
    find: `    showAnnotation: sizeClass === "regular",
    showCounts: !micro,
    showLegend: inputs.showLegend && !micro,
    showQuadrantLabels: !micro,
    showThresholdLabels: inputs.showThresholdLabels && !micro,
    showDataLabels: inputs.showLabels && !micro,
    showDisclosure: !micro`,
    replace: `    showAnnotation: true,
    showCounts: true,
    showLegend: inputs.showLegend,
    showQuadrantLabels: true,
    showThresholdLabels: inputs.showThresholdLabels,
    showDataLabels: inputs.showLabels,
    showDisclosure: true`,
    expectFailing: ["drops decorative chrome before data as the tile shrinks"]
  },
  {
    id: "baseline-clips-ascender",
    description: "First chrome baseline back at y=12, below a 13px ascender",
    file: "src/layout.ts",
    find: `  let cursor = 2;
  let annotationY: number | undefined;
  if (plan.showAnnotation) {
    cursor += Math.ceil(annotationFontSize(width));`,
    replace: `  let cursor = 2;
  let annotationY: number | undefined;
  if (plan.showAnnotation) {
    cursor += 10;`,
    expectFailing: ["the first chrome baseline clears its own ascender"]
  },
  {
    id: "uncapped-marker",
    description: "Marker radius no longer capped against the margin, so the focus ring escapes",
    file: "src/layout.ts",
    find: `  const room = Math.max(2, Math.min(margins.top, margins.bottom, margins.left, margins.right) - 5);
  return Math.max(2, Math.min(radius, room));`,
    replace: "  return radius;",
    expectFailing: ["markers stay small enough that the focus ring stays inside the root"]
  },
  {
    id: "no-truncation",
    description: "Chrome text is no longer trimmed to the measured width",
    file: "src/layout.ts",
    find: `  if (measure(text) <= maxWidth) {
    return text;
  }`,
    replace: "  return text;",
    expectFailing: ["truncates measured text to the available width"]
  },
  {
    id: "rtl-double-flip",
    description: "direction: rtl back on the SVG, double-flipping every mirrored text anchor",
    file: "src/visual.ts",
    find: `      direction: "ltr",`,
    replace: `      direction: this.rtl ? "rtl" : "ltr",`,
    expectFailing: ["the SVG stays in an LTR coordinate space so mirrored anchors are not flipped twice"]
  },
  {
    id: "root-not-positioned",
    description: "Root drops position: relative, so absolute descendants resolve against the viewport",
    file: "style/visual.less",
    find: `  overflow: hidden;
  position: relative;`,
    replace: "  overflow: hidden;",
    expectFailing: ["the root establishes the containing block its absolute descendants rely on"]
  },
  {
    id: "sticky-without-scroll-rule",
    description: "Sticky positioning introduced without the probe rule that guards it",
    file: "style/visual.less",
    find: `.atlyn-scatter__semantic-table th,`,
    replace: `.atlyn-scatter__semantic-table th {
  position: sticky;
  top: 0;
}

.atlyn-scatter__semantic-table th,`,
    expectFailing: ["records that no sticky or fixed positioning ships today"]
  }
];

function runSuite() {
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  const build = spawnSync(process.execPath, [tsc, "-p", "tsconfig.test.json"], {
    cwd: root, encoding: "utf8", timeout: 300000
  });
  if (build.status !== 0) {
    return { compiled: false, output: `${build.stdout ?? ""}${build.stderr ?? ""}` };
  }
  // The default reporter depends on the Node version and on whether stdout is a TTY, so it
  // is pinned here: TAP is stable and machine readable everywhere.
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "dist-tests/tests/layout.test.js"],
    { cwd: root, encoding: "utf8", timeout: 300000 }
  );
  return { compiled: true, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, status: result.status };
}

function failingTestNames(output) {
  const names = new Set();
  for (const match of output.matchAll(/^not ok \d+ - (.+?)\s*$/gm)) {
    names.add(match[1].trim());
  }
  // Tolerate the spec reporter too, in case the pin is ever dropped.
  for (const match of output.matchAll(/^\u2716 (.+?) \(/gm)) {
    names.add(match[1].trim());
  }
  return names;
}

(function main() {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  const results = [];
  let allProven = true;
  for (const reversion of REVERSIONS) {
    const filePath = path.join(root, reversion.file);
    const original = fs.readFileSync(filePath, "utf8");
    // Anchors are written with LF; the working tree may hold CRLF. The original bytes are
    // restored verbatim afterwards, so normalising only affects the temporary edit.
    const normalized = original.replace(/\r\n/g, "\n");
    if (!normalized.includes(reversion.find)) {
      console.error(`SKIP ${reversion.id}: anchor text not found in ${reversion.file}. Update the anchor.`);
      allProven = false;
      results.push({ id: reversion.id, proven: false, reason: "anchor-not-found" });
      continue;
    }
    fs.writeFileSync(filePath, normalized.replace(reversion.find, reversion.replace), "utf8");
    let outcome;
    try {
      outcome = runSuite();
    } finally {
      fs.writeFileSync(filePath, original, "utf8");
    }
    // A reverted fix that no longer compiles also proves the code depends on it, but the
    // point of the exercise is a red test, so only assertion failures count.
    const failing = outcome.compiled ? failingTestNames(outcome.output) : new Set();
    const missed = reversion.expectFailing.filter((name) => !failing.has(name));
    const proven = outcome.compiled && missed.length === 0;
    if (!proven) {
      allProven = false;
    }
    results.push({
      id: reversion.id,
      description: reversion.description,
      proven,
      compiled: outcome.compiled,
      expected: reversion.expectFailing,
      observedFailures: [...failing],
      missed
    });
    const mark = proven ? "PROVEN" : "NOT PROVEN";
    console.log(`${mark}  ${reversion.id} - ${reversion.description}`);
    if (!proven) {
      console.log(`    compiled=${outcome.compiled} expected=${JSON.stringify(reversion.expectFailing)}`);
      console.log(`    observed failures=${JSON.stringify([...failing])}`);
      if (!outcome.compiled) {
        console.log(`    build output: ${outcome.output.slice(0, 600)}`);
      }
    }
  }
  // Leave the tree exactly as it was found.
  const rebuild = runSuite();
  if (!rebuild.compiled || rebuild.status !== 0) {
    console.error("Restored tree does not pass its own suite; something was left modified.");
    console.error(rebuild.output.slice(-2000));
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(
    path.join(root, "dist", "regression-proof.json"),    `${JSON.stringify({ generatedBy: "scripts/prove-regressions.cjs", results }, null, 2)}\n`,
    "utf8"
  );
  console.log(`\n${results.filter((item) => item.proven).length}/${results.length} fixes proven by a failing test.`);
  if (!allProven) {
    process.exitCode = 1;
  }
})();
