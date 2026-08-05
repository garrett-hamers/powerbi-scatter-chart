// Offline geometry probe for the packaged Atlyn Scatter visual.
//
// Loads the packaged bundle *and* the packaged stylesheet from dist/*.pbiviz into the
// shared harness, then measures every element with getBoundingClientRect() inside a real
// Chromium layout engine. Asserting that content.css is non-empty would pass on a broken
// layout, so nothing here trusts CSS text: every finding is a measured number.
//
// Generic assertion: no element's border box may escape the visual root, ignoring anything
// inside an ancestor that genuinely scrolls its own overflow. Elements that collapse to a
// near-zero box while they are supposed to be visible are flagged too.
const fs = require("node:fs");
const path = require("node:path");

const {
  root,
  fail,
  resolveBrowser,
  readPackageResources,
  buildDataView,
  stylesheetNeedsShadowRoot,
  harnessHtml,
  runBrowser
} = require("./visual-harness.cjs");

const workDirectory = path.join(root, ".tmp", "layout-probe");
const reportPath = path.join(root, "dist", "layout-probe.json");

// 80x80 is the smallest viewport the visual declares support for: below that it swaps the
// chart for the "too small" status message (see the width < 80 || height < 80 guard).
const MIN_SUPPORTED = 80;

const VIEWPORTS = [
  { name: "large", width: 1280, height: 620 },
  { name: "medium", width: 398, height: 298 },
  { name: "small", width: 258, height: 198 },
  { name: "tiny", width: 178, height: 138 },
  { name: "minimum", width: MIN_SUPPORTED, height: MIN_SUPPORTED }
];

// showSemanticTable lives on the "quadrants" object and defaults to true, so the visible
// accessible data table is the shipped default rather than an opt-in corner case.
const SCENARIOS = [
  {
    id: "default",
    label: "Shipped defaults (median thresholds, accessible table visible)",
    grouped: false,
    objects: null
  },
  {
    id: "table-off",
    label: "Accessible data table hidden",
    grouped: false,
    objects: { quadrants: { showSemanticTable: false } }
  },
  {
    id: "series-legend",
    label: "Grouped series with legend and accessible table",
    grouped: true,
    objects: null
  },
  {
    id: "series-legend-table-off",
    label: "Grouped series with legend, accessible table hidden",
    grouped: true,
    objects: { quadrants: { showSemanticTable: false } }
  },
  {
    id: "labels-dense",
    label: "Data labels at full density",
    grouped: false,
    objects: { labels: { showLabels: true, labelDensity: 100 } }
  },
  {
    id: "high-contrast",
    label: "High contrast palette",
    grouped: true,
    objects: null,
    highContrast: true
  },
  {
    id: "rtl",
    label: "RTL locale (ar-SA)",
    grouped: true,
    objects: null,
    locale: "ar-SA",
    documentDir: "rtl"
  },
  {
    id: "reduced-motion",
    label: "Reduced motion preference",
    grouped: true,
    objects: null,
    reducedMotion: true
  }
];

// Runs inside the page. Everything below is ES5 so it survives any Chromium the CI image ships.
const PROBE_SCRIPT = `
(function () {
  var EPS = 0.5;
  var NEAR_ZERO = 4;
  var out = {
    failed: window.__atlynFailed || null,
    shadowRoot: !!window.__atlynShadow,
    pointCount: window.__atlynPointCount || 0,
    root: null,
    regions: {},
    violations: [],
    collapsed: [],
    focus: null,
    selection: null,
    computed: {}
  };
  try {
    var el = window.__atlynRoot;
    var scope = el.getRootNode();
    var rootRect = el.getBoundingClientRect();
    out.root = box(rootRect);

    function box(r) {
      return {
        left: round(r.left), top: round(r.top),
        right: round(r.right), bottom: round(r.bottom),
        width: round(r.width), height: round(r.height)
      };
    }
    function round(v) { return Math.round(v * 100) / 100; }
    function describe(node) {
      var name = node.tagName ? node.tagName.toLowerCase() : "?";
      var cls = node.getAttribute && node.getAttribute("class");
      if (cls) { name += "." + String(cls).trim().split(/\\s+/).join("."); }
      var id = node.getAttribute && node.getAttribute("id");
      if (id) { name += "#" + id; }
      return name;
    }

    function hidden(node, style) {
      if (style.display === "none" || style.visibility === "hidden") { return true; }
      // The visually-hidden pattern intentionally parks a 1px clipped box off-flow.
      if (style.clipPath && style.clipPath.indexOf("inset(50%") !== -1) { return true; }
      if (style.clip && style.clip.indexOf("rect(0px, 0px, 0px, 0px)") !== -1) { return true; }
      return false;
    }

    // An ancestor only excuses overflow when it actually scrolls: a <table> reports
    // overflow:auto in getComputedStyle but never becomes a scroll container, so the
    // exemption must be proven by geometry, not by the declared property.
    function scrollsOwnOverflow(node) {
      var style = getComputedStyle(node);
      var oy = style.overflowY, ox = style.overflowX;
      var scrollable = oy === "auto" || oy === "scroll" || ox === "auto" || ox === "scroll";
      if (!scrollable) { return false; }
      if (node.clientHeight <= 0 && node.clientWidth <= 0) { return false; }
      var rect = node.getBoundingClientRect();
      var inside = rect.left >= rootRect.left - EPS && rect.right <= rootRect.right + EPS &&
        rect.top >= rootRect.top - EPS && rect.bottom <= rootRect.bottom + EPS;
      if (!inside) { return false; }
      var clips = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1 ||
        (node.clientHeight > 0 && Math.abs(node.clientHeight - rect.height) < node.clientHeight);
      return clips;
    }

    function escapes(rect) {
      var sides = [];
      if (rect.left < rootRect.left - EPS) { sides.push("left:" + round(rootRect.left - rect.left)); }
      if (rect.top < rootRect.top - EPS) { sides.push("top:" + round(rootRect.top - rect.top)); }
      if (rect.right > rootRect.right + EPS) { sides.push("right:" + round(rect.right - rootRect.right)); }
      if (rect.bottom > rootRect.bottom + EPS) { sides.push("bottom:" + round(rect.bottom - rootRect.bottom)); }
      return sides;
    }

    function hasContent(node) {
      if (node.tagName && node.tagName.toLowerCase() === "text") { return true; }
      var text = (node.textContent || "").trim();
      return text.length > 0;
    }

    function walk(node, insideScroller, depth) {
      var children = node.children ? Array.prototype.slice.call(node.children) : [];
      for (var i = 0; i < children.length; i += 1) {
        var child = children[i];
        var style = getComputedStyle(child);
        if (hidden(child, style)) { continue; }
        var rect = child.getBoundingClientRect();
        var childScroller = insideScroller || scrollsOwnOverflow(child);
        if (!insideScroller) {
          var sides = escapes(rect);
          if (sides.length && (rect.width > 0 || rect.height > 0)) {
            out.violations.push({
              element: describe(child),
              depth: depth,
              box: box(rect),
              overflow: sides,
              text: (child.textContent || "").trim().slice(0, 90)
            });
          }
        }
        if (rect.height < NEAR_ZERO && hasContent(child) && rect.width > NEAR_ZERO) {
          out.collapsed.push({ element: describe(child), box: box(rect), text: (child.textContent || "").trim().slice(0, 60) });
        }
        walk(child, childScroller, depth + 1);
      }
    }

    walk(el, false, 1);

    function regionOf(selector) {
      var node = el.querySelector(selector);
      if (!node) { return null; }
      var style = getComputedStyle(node);
      var rect = node.getBoundingClientRect();
      // A region counts as hidden when it, or any ancestor up to the root, is hidden:
      // the accessible table lives inside a wrapper that carries the hidden styling.
      var hiddenChain = hidden(node, style);
      var walkUp = node.parentElement;
      while (!hiddenChain && walkUp && walkUp !== el) {
        if (hidden(walkUp, getComputedStyle(walkUp))) { hiddenChain = true; }
        walkUp = walkUp.parentElement;
      }
      return {
        present: true,
        hidden: hiddenChain,
        box: box(rect),
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        overflowY: style.overflowY,
        maxHeight: style.maxHeight,
        visibleHeight: round(Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top))),
        visibleWidth: round(Math.max(0, Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left)))
      };
    }
    out.regions.svg = regionOf(".atlyn-scatter__svg");
    out.regions.table = regionOf(".atlyn-scatter__table");
    out.regions.tableInner = regionOf(".atlyn-scatter__semantic-table");
    out.regions.message = regionOf(".atlyn-scatter__message");
    out.regions.legend = regionOf(".atlyn-scatter__legend");
    out.regions.annotations = regionOf(".atlyn-scatter__annotations");

    var rootStyle = getComputedStyle(el);
    out.computed.rootOverflow = rootStyle.overflow;
    out.computed.rootColor = rootStyle.color;
    out.computed.rootBackground = rootStyle.backgroundColor;
    out.computed.fontFamily = rootStyle.fontFamily;
    out.computed.direction = rootStyle.direction;
    out.computed.dir = el.getAttribute("dir");
    out.computed.highContrast = el.getAttribute("data-high-contrast");
    out.computed.reducedMotion = el.getAttribute("data-reduced-motion");
    out.computed.sizeClass = el.getAttribute("data-size");

    // text-overflow: ellipsis only works on a single line, so any ellipsis rule that
    // forgets white-space: nowrap silently does nothing and the text wraps instead.
    out.computed.ellipsisWithoutNowrap = [];
    var all = el.querySelectorAll("*");
    for (var a = 0; a < all.length; a += 1) {
      var s = getComputedStyle(all[a]);
      if (s.textOverflow === "ellipsis" && s.whiteSpace !== "nowrap" && s.whiteSpace !== "pre") {
        out.computed.ellipsisWithoutNowrap.push(describe(all[a]));
      }
    }

    // Keyboard focus: the outline must stay inside the root and focusing must not scroll
    // the clipped root (a scrolled root means content was parked outside the visible box).
    var point = el.querySelector(".atlyn-scatter__point");
    if (point) {
      var beforeScroll = { top: el.scrollTop, left: el.scrollLeft, docTop: document.scrollingElement ? document.scrollingElement.scrollTop : 0 };
      point.focus({ preventScroll: false });
      var focusRect = point.getBoundingClientRect();
      var focusStyle = getComputedStyle(point);
      var outlineWidth = parseFloat(focusStyle.outlineWidth) || 0;
      var offset = parseFloat(focusStyle.outlineOffset) || 0;
      var pad = outlineWidth + offset;
      out.focus = {
        active: scope.activeElement ? describe(scope.activeElement) : null,
        box: box(focusRect),
        r: point.getAttribute("r"),
        cy: point.getAttribute("cy"),
        outlineWidth: outlineWidth,
        outlineOffset: offset,
        outlineEscapes: escapes({
          left: focusRect.left - pad, right: focusRect.right + pad,
          top: focusRect.top - pad, bottom: focusRect.bottom + pad
        }),
        scrolledRoot: el.scrollTop !== beforeScroll.top || el.scrollLeft !== beforeScroll.left,
        scrolledDocument: (document.scrollingElement ? document.scrollingElement.scrollTop : 0) !== beforeScroll.docTop,
        documentScrollBefore: beforeScroll.docTop,
        documentScrollAfter: document.scrollingElement ? document.scrollingElement.scrollTop : 0,
        documentScrollHeight: document.scrollingElement ? document.scrollingElement.scrollHeight : 0,
        documentClientHeight: document.scrollingElement ? document.scrollingElement.clientHeight : 0,
        rootScrollTop: el.scrollTop,
        rootScrollLeft: el.scrollLeft
      };
    }

    // Selection state re-render must not change the geometry contract either.
    if (window.__atlynFireSelection && window.__atlynDataView) {
      var key = null;
      var firstPoint = el.querySelector(".atlyn-scatter__point");
      if (firstPoint) { key = firstPoint.getAttribute("data-identity-key"); }
      if (key !== null) {
        window.__atlynFireSelection([{
          getKey: function () { return key; },
          equals: function (other) { return !!other && typeof other.getKey === "function" && other.getKey() === key; },
          includes: function () { return false; }
        }]);
        var selectedNodes = el.querySelectorAll(".atlyn-scatter__point--selected");
        // Re-read the root box: the re-render replaced every child, and comparing against a
        // stale rect would report the harness scroll position as a product defect.
        rootRect = el.getBoundingClientRect();
        var selViolations = [];
        var selAll = el.querySelectorAll("*");
        for (var s2 = 0; s2 < selAll.length; s2 += 1) {
          var node2 = selAll[s2];
          var st2 = getComputedStyle(node2);
          if (hidden(node2, st2)) { continue; }
          var insideScroll = false;
          var p2 = node2.parentElement;
          while (p2 && p2 !== el) {
            if (hidden(p2, getComputedStyle(p2)) || scrollsOwnOverflow(p2)) { insideScroll = true; break; }
            p2 = p2.parentElement;
          }
          if (insideScroll) { continue; }
          var r2 = node2.getBoundingClientRect();
          var sd = escapes(r2);
          if (sd.length && (r2.width > 0 || r2.height > 0)) {
            selViolations.push({ element: describe(node2), box: box(r2), overflow: sd });
          }
        }
        out.selection = {
          selectedCount: selectedNodes.length,
          rootBox: box(rootRect),
          violations: selViolations
        };
      }
    }
  } catch (error) {
    out.probeError = String(error && error.stack ? error.stack : error);
  }

  var pre = document.createElement("pre");
  pre.id = "atlyn-probe-result";
  pre.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
  document.body.appendChild(pre);
})();
`;

function extractResult(dom) {
  const match = dom.match(/<pre id="atlyn-probe-result">([\s\S]*?)<\/pre>/);
  if (!match) {
    const error = dom.match(/<pre id=['"]atlyn-error['"]>([\s\S]*?)<\/pre>/);
    fail(`probe produced no result${error ? `: ${error[1].slice(0, 500)}` : `. DOM head: ${dom.slice(0, 400)}`}`);
  }
  return JSON.parse(Buffer.from(match[1].trim(), "base64").toString("utf8"));
}

function runCase(browser, htmlPath, viewport) {
  const result = runBrowser(browser, [
    // The browser content area must comfortably exceed the tile, otherwise focusing a point
    // scrolls the document and the harness scroll offset looks like a layout escape.
    `--window-size=${Math.max(viewport.width + 80, 800)},${Math.max(viewport.height + 240, 700)}`,
    "--dump-dom",
    "--virtual-time-budget=4000",
    `file:///${htmlPath.replace(/\\/g, "/")}`
  ]);
  if (result.error) {
    fail(`browser could not start: ${result.error.message}`);
  }
  if (!result.stdout) {
    fail(`browser produced no DOM.\nstderr: ${result.stderr}`);
  }
  return extractResult(result.stdout);
}

function formatTable(rows) {
  const headers = ["Scenario", "Tile", "Root", "SVG h", "Table h", "Table visible h", "Escapes", "Worst overflow"];
  const body = rows.map((row) => [
    row.scenario,
    `${row.width}x${row.height}`,
    `${row.root.width}x${row.root.height}`,
    row.svgHeight,
    row.tableHeight,
    row.tableVisibleHeight,
    String(row.violationCount),
    row.worst
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...body.map((cells) => String(cells[index]).length)));
  const line = (cells) => "| " + cells.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ") + " |";
  return [
    line(headers),
    "|" + widths.map((width) => "-".repeat(width + 2)).join("|") + "|",
    ...body.map(line)
  ].join("\n");
}

(async () => {
  const browser = resolveBrowser("Layout probe");
  const resources = await readPackageResources();
  const needsShadow = stylesheetNeedsShadowRoot(resources.css);
  fs.rmSync(workDirectory, { recursive: true, force: true });
  fs.mkdirSync(workDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  console.log(`Browser: ${browser}`);
  console.log(`Bundle:  ${resources.origin} (${resources.js.length} bytes JS, ${resources.css.length} bytes CSS)`);
  console.log(`Stylesheet uses :host -> ${needsShadow}; harness attaches a shadow root -> ${needsShadow}`);
  console.log("");

  const rows = [];
  const report = {
    generatedBy: "scripts/layout-probe.cjs",
    bundleBytes: resources.js.length,
    cssBytes: resources.css.length,
    shadowRoot: needsShadow,
    minimumSupported: MIN_SUPPORTED,
    cases: []
  };
  let failures = 0;

  for (const scenario of SCENARIOS) {
    for (const viewport of VIEWPORTS) {
      const data = buildDataView(scenario);
      const html = harnessHtml({
        css: resources.css,
        js: resources.js,
        data,
        width: viewport.width,
        height: viewport.height,
        shadowRoot: needsShadow,
        locale: scenario.locale ?? "en-US",
        highContrast: scenario.highContrast ?? false,
        reducedMotion: scenario.reducedMotion ?? false,
        documentDir: scenario.documentDir ?? "ltr",
        probeScript: PROBE_SCRIPT
      });
      const htmlPath = path.join(workDirectory, `${scenario.id}-${viewport.name}.html`);
      fs.writeFileSync(htmlPath, html, "utf8");
      const measured = runCase(browser, htmlPath, viewport);
      measured.scenario = scenario.id;
      measured.scenarioLabel = scenario.label;
      measured.viewport = viewport;
      report.cases.push(measured);

      if (measured.failed || measured.probeError) {
        failures += 1;
      }
      const violations = measured.violations ?? [];
      const selectionViolations = measured.selection?.violations ?? [];
      const worst = violations
        .concat(selectionViolations)
        .flatMap((violation) => violation.overflow.map((side) => Number(side.split(":")[1])))
        .reduce((max, value) => Math.max(max, value), 0);
      rows.push({
        scenario: scenario.id,
        width: viewport.width,
        height: viewport.height,
        root: measured.root ?? { width: 0, height: 0 },
        svgHeight: measured.regions?.svg?.box.height ?? "-",
        tableHeight: measured.regions?.table
          ? (measured.regions.table.hidden ? "hidden" : measured.regions.table.box.height)
          : "-",
        tableVisibleHeight: measured.regions?.table
          ? (measured.regions.table.hidden ? "hidden" : measured.regions.table.visibleHeight)
          : "-",
        violationCount: violations.length,
        worst: worst ? `${worst}px` : "-"
      });
      if (violations.length || selectionViolations.length) {
        failures += 1;
      }
      if (measured.focus && (measured.focus.outlineEscapes.length || measured.focus.scrolledRoot || measured.focus.scrolledDocument)) {
        failures += 1;
      }
      if ((measured.computed?.ellipsisWithoutNowrap ?? []).length) {
        failures += 1;
      }
    }
  }

  console.log(formatTable(rows));
  console.log("");

  for (const measured of report.cases) {
    const violations = measured.violations ?? [];
    const selectionViolations = measured.selection?.violations ?? [];
    const focusProblem = measured.focus &&
      (measured.focus.outlineEscapes.length || measured.focus.scrolledRoot || measured.focus.scrolledDocument);
    const ellipsis = measured.computed?.ellipsisWithoutNowrap ?? [];
    if (!violations.length && !selectionViolations.length && !focusProblem && !ellipsis.length) {
      continue;
    }
    console.log(`--- ${measured.scenario} @ ${measured.viewport.width}x${measured.viewport.height} (${measured.scenarioLabel})`);
    for (const violation of violations.slice(0, 12)) {
      console.log(`    ESCAPES ${violation.element} box=${violation.box.width}x${violation.box.height} at (${violation.box.left},${violation.box.top}) over ${violation.overflow.join(", ")}${violation.text ? ` :: "${violation.text}"` : ""}`);
    }
    if (violations.length > 12) {
      console.log(`    ... ${violations.length - 12} more`);
    }
    for (const violation of selectionViolations.slice(0, 6)) {
      console.log(`    ESCAPES(selected) ${violation.element} over ${violation.overflow.join(", ")}`);
    }
    if (focusProblem) {
      console.log(`    FOCUS outlineEscapes=${JSON.stringify(measured.focus.outlineEscapes)} scrolledRoot=${measured.focus.scrolledRoot} scrolledDocument=${measured.focus.scrolledDocument}`);
    }
    for (const element of ellipsis) {
      console.log(`    ELLIPSIS-WITHOUT-NOWRAP ${element}`);
    }
    console.log("");
  }

  for (const measured of report.cases) {
    for (const collapsed of measured.collapsed ?? []) {
      console.log(`COLLAPSED ${measured.scenario}@${measured.viewport.width}x${measured.viewport.height} ${collapsed.element} height=${collapsed.box.height} :: "${collapsed.text}"`);
    }
  }

  report.failures = failures;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${path.relative(root, reportPath)} (${failures} failing checks).`);
  if (failures > 0) {
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
