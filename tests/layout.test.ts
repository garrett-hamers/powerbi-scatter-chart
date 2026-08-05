import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  clampMarkerRadius,
  ELLIPSIS,
  isCompact,
  LAYOUT_LIMITS,
  planChromeRows,
  planLayout,
  planMargins,
  truncateToWidth
} from "../src/layout";

const root = path.resolve(__dirname, "..", "..");
const stylesheet = fs.readFileSync(path.join(root, "style", "visual.less"), "utf8");
const visualSource = fs.readFileSync(path.join(root, "src", "visual.ts"), "utf8");

const ALL_ON = {
  showSemanticTable: true,
  showLegend: true,
  showLabels: true,
  showThresholdLabels: true
};

const VIEWPORTS = [
  { name: "large", width: 1280, height: 620 },
  { name: "medium", width: 398, height: 298 },
  { name: "small", width: 258, height: 198 },
  { name: "tiny", width: 178, height: 138 },
  { name: "minimum", width: 80, height: 80 }
];

// Regression for the shipped defect where the accessible point table was appended after a
// height: 100% SVG inside an overflow: hidden root, so it measured 528-1122px tall with
// exactly 0px of it inside the visual at every tile size.
test("reserves real space for the accessible table instead of stacking it past the root", () => {
  for (const viewport of VIEWPORTS) {
    const plan = planLayout(viewport.width, viewport.height, ALL_ON);
    assert.equal(
      plan.chartHeight + plan.tableHeight,
      Math.max(viewport.height, plan.chartHeight),
      `${viewport.name}: chart and table must together fit the tile`
    );
    assert.ok(
      plan.chartHeight + plan.tableHeight <= viewport.height || viewport.height < 2,
      `${viewport.name}: stacked regions overflow the tile`
    );
    if (plan.showTable) {
      assert.ok(plan.tableHeight > 0, `${viewport.name}: a shown table needs a height budget`);
      assert.ok(
        plan.tableHeight <= LAYOUT_LIMITS.maxTableHeight,
        `${viewport.name}: table budget must stay bounded`
      );
      assert.ok(
        plan.chartHeight >= viewport.height - LAYOUT_LIMITS.maxTableHeight,
        `${viewport.name}: the chart must keep the remaining height`
      );
    } else {
      assert.equal(plan.tableHeight, 0, `${viewport.name}: a hidden table must not reserve space`);
      assert.equal(plan.chartHeight, viewport.height, `${viewport.name}: chart takes the whole tile`);
    }
  }
});

test("keeps the accessible table visible wherever the tile can hold it", () => {
  assert.equal(planLayout(1280, 620, ALL_ON).showTable, true);
  assert.equal(planLayout(398, 298, ALL_ON).showTable, true);
  assert.equal(planLayout(258, 198, ALL_ON).showTable, true);
  // Below the floor there is no room to paint both a legible chart and a table, so the
  // table degrades to its screen-reader-only form rather than being silently clipped.
  assert.equal(planLayout(178, 138, ALL_ON).showTable, false);
  assert.equal(planLayout(80, 80, ALL_ON).showTable, false);
  assert.equal(planLayout(1280, 620, { ...ALL_ON, showSemanticTable: false }).showTable, false);
});

// Regression for the flex-column-in-a-clipped-box pattern: without min-height: 0 a stacked
// region refuses to shrink below its content and is silently clipped by the hidden root.
test("every stacked region can actually shrink inside the clipped root", () => {
  const rootRule = stylesheet.match(/\.atlyn-scatter \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(rootRule, /display:\s*flex/);
  assert.match(rootRule, /flex-direction:\s*column/);
  for (const selector of [".atlyn-scatter", ".atlyn-scatter__svg", ".atlyn-scatter__message", ".atlyn-scatter__table"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = stylesheet.match(new RegExp(`${escaped} \\{[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(rule, `${selector} must exist in the stylesheet`);
    assert.match(rule as string, /min-height:\s*0/, `${selector} must set min-height: 0`);
  }
});

// Regression for the second half of the same defect: max-height and overflow are ignored on
// a display: table box, so declaring them on the <table> produced no scroll container at all.
test("the accessible table scrolls in a wrapper, never on the table box itself", () => {
  const tableRule = stylesheet.match(/\.atlyn-scatter__semantic-table \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(tableRule.length > 0, "the semantic table rule must exist");
  assert.doesNotMatch(tableRule, /overflow:/, "overflow on a <table> never creates a scroll container");
  assert.doesNotMatch(tableRule, /max-height:/, "max-height on a <table> is ignored");
  const wrapperRule = stylesheet.match(/\.atlyn-scatter__table \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(wrapperRule, /overflow:\s*auto/);
  assert.match(visualSource, /wrapper\.className = `atlyn-scatter__table/);
  assert.match(visualSource, /wrapper\.appendChild\(table\)/);
  assert.match(visualSource, /this\.root\.appendChild\(wrapper\)/);
});

// text-overflow: ellipsis only applies to a single line, so an ellipsis rule that forgets
// white-space: nowrap silently does nothing and the text wraps instead.
test("no ellipsis rule ships without white-space: nowrap", () => {
  const rules = stylesheet.match(/[^{}]+\{[^{}]*\}/g) ?? [];
  for (const rule of rules) {
    if (!/text-overflow:\s*ellipsis/.test(rule)) {
      continue;
    }
    assert.match(rule, /white-space:\s*(nowrap|pre)/, `ellipsis without nowrap in: ${rule}`);
  }
});

// Regression for chrome that marched out of the clipped viewport: the provenance line
// measured 550px wide inside a 398px tile and the quadrant counts 335px inside 258px.
test("drops decorative chrome before data as the tile shrinks", () => {
  const large = planLayout(1280, 620, ALL_ON);
  assert.equal(large.sizeClass, "regular");
  assert.equal(large.showAnnotation, true);
  assert.equal(large.showLegend, true);

  const narrow = planLayout(300, 298, ALL_ON);
  assert.equal(narrow.sizeClass, "narrow");
  assert.equal(narrow.showAnnotation, false, "the long provenance line goes first");
  assert.equal(narrow.showCounts, true, "the quadrant summary outlives the provenance line");
  assert.equal(narrow.showTable, true, "data outlives chrome");

  const short = planLayout(398, 200, ALL_ON);
  assert.equal(short.sizeClass, "short");
  assert.equal(short.showAnnotation, false);
  assert.equal(short.showTable, true);

  const micro = planLayout(178, 138, ALL_ON);
  assert.equal(micro.sizeClass, "micro");
  for (const dropped of ["showAnnotation", "showCounts", "showLegend", "showQuadrantLabels", "showThresholdLabels", "showDataLabels", "showDisclosure"] as const) {
    assert.equal(micro[dropped], false, `${dropped} must be dropped at micro size`);
  }
  // Data survives: the chart keeps the whole tile and the table stays in the a11y tree.
  assert.equal(micro.chartHeight, 138);
});

// Regression for the first chrome baseline sitting at y=12 with a 13px font, which pushed
// the glyph ascenders 2px above the top of the clipped root on a 1280px tile.
test("the first chrome baseline clears its own ascender", () => {
  for (const viewport of VIEWPORTS) {
    const plan = planLayout(viewport.width, viewport.height, ALL_ON);
    const rows = planChromeRows(viewport.width, plan);
    const fontSize = Math.min(13, Math.max(10, viewport.width / 80));
    if (rows.annotationY !== undefined) {
      assert.ok(
        rows.annotationY >= fontSize,
        `${viewport.name}: baseline ${rows.annotationY} is above the ${fontSize}px ascender`
      );
    }
    if (rows.countsY !== undefined) {
      assert.ok(rows.countsY >= 10, `${viewport.name}: counts baseline clips its ascender`);
    }
    const margins = planMargins(viewport.width, plan.chartHeight, rows.chromeBottom);
    assert.ok(
      margins.top >= rows.chromeBottom,
      `${viewport.name}: the plot must start below the surviving chrome`
    );
    assert.ok(
      margins.top + margins.bottom < plan.chartHeight,
      `${viewport.name}: margins must leave room for a plot`
    );
  }
});

// Regression for the focus ring escaping the clipped root: a 12px marker sitting on the
// top edge of the plot put its 2px outline with 2px offset outside a 80x80 tile.
test("markers stay small enough that the focus ring stays inside the root", () => {
  for (const viewport of VIEWPORTS) {
    const plan = planLayout(viewport.width, viewport.height, ALL_ON);
    const rows = planChromeRows(viewport.width, plan);
    const margins = planMargins(viewport.width, plan.chartHeight, rows.chromeBottom);
    for (const requested of [4, 12, 24]) {
      const radius = clampMarkerRadius(requested, margins);
      assert.ok(radius >= 2, "markers never vanish");
      assert.ok(radius <= requested, "markers never grow beyond the request");
      const ringReach = radius + 4;
      for (const side of [margins.top, margins.bottom, margins.left, margins.right]) {
        assert.ok(
          ringReach <= side || side < 6,
          `${viewport.name}: a ${requested}px marker reaches ${ringReach}px into a ${side}px margin`
        );
      }
    }
  }
  // Large tiles must not be penalised by the cap.
  const largePlan = planLayout(1280, 620, ALL_ON);
  const largeRows = planChromeRows(1280, largePlan);
  assert.equal(clampMarkerRadius(24, planMargins(1280, largePlan.chartHeight, largeRows.chromeBottom)), 24);
});

test("truncates measured text to the available width", () => {
  const measure = (candidate: string) => candidate.length * 10;
  assert.equal(truncateToWidth("short", 1000, measure), "short");
  assert.equal(truncateToWidth("", 10, measure), "");
  assert.equal(truncateToWidth("anything", 0, measure), "");
  assert.equal(truncateToWidth("anything", -5, measure), "");
  const trimmed = truncateToWidth("abcdefghij", 45, measure);
  assert.ok(trimmed.endsWith(ELLIPSIS), `expected an ellipsis, got ${trimmed}`);
  assert.ok(measure(trimmed) <= 45, `${trimmed} still exceeds the budget`);
  assert.equal(truncateToWidth("abcdefghij", 5, measure), "");
});

test("the SVG stays in an LTR coordinate space so mirrored anchors are not flipped twice", () => {
  // direction: rtl on the <svg> swaps what text-anchor start/end mean. Every x coordinate
  // already mirrors itself, so setting it would double-flip the chrome out of the viewport.
  assert.match(visualSource, /direction: "ltr"/);
  assert.doesNotMatch(visualSource, /direction: this\.rtl \? "rtl" : "ltr"/);
  // The HTML root still carries dir so the accessible table reads right-to-left.
  assert.match(visualSource, /this\.root\.setAttribute\("dir", this\.rtl \? "rtl" : "ltr"\)/);
});

test("marks the rendered size class on the root for the shipped stylesheet", () => {
  assert.match(visualSource, /this\.root\.setAttribute\("data-size"/);
  assert.equal(planLayout(1280, 620, ALL_ON).sizeClass, "regular");
  assert.equal(planLayout(1280, 200, ALL_ON).sizeClass, "short");
  assert.equal(planLayout(300, 620, ALL_ON).sizeClass, "narrow");
  assert.equal(planLayout(199, 620, ALL_ON).sizeClass, "micro");
  assert.equal(planLayout(620, 149, ALL_ON).sizeClass, "micro");
  assert.equal(isCompact(279, 620), true);
  assert.equal(isCompact(1280, 189), true);
  assert.equal(isCompact(1280, 620), false);
});
