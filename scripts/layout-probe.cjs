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
  buildOverflowDataView,
  stylesheetNeedsShadowRoot,
  harnessHtml,
  runBrowser
} = require("./visual-harness.cjs");
const { evaluateCase } = require("./layout-rules.cjs");

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
  },
  // Small viewports and overflowing content are different tests. These fixtures are sized so
  // the accessible table's scroll container genuinely exceeds its box and can be scrolled.
  {
    id: "overflow-table",
    label: "320 categories, accessible table overflowing and scrolled",
    overflow: { grouped: false, categoryCount: 320 },
    expectScrollOverflow: [".atlyn-scatter__table"]
  },
  {
    id: "overflow-series",
    label: "12 series x 320 categories, legend and table under pressure",
    overflow: { grouped: true, categoryCount: 320, seriesCount: 12 },
    expectScrollOverflow: [".atlyn-scatter__table"]
  },
  {
    id: "overflow-labels",
    label: "Overflowing data with labels at full density",
    overflow: { grouped: false, categoryCount: 320, objects: { labels: { showLabels: true, labelDensity: 100 } } },
    expectScrollOverflow: [".atlyn-scatter__table"]
  },
  {
    id: "overflow-rtl",
    label: "Overflowing data in an RTL locale",
    overflow: { grouped: true, categoryCount: 320, seriesCount: 12 },
    locale: "ar-SA",
    documentDir: "rtl",
    expectScrollOverflow: [".atlyn-scatter__table"]
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

    // ---- Positioned elements -------------------------------------------------------
    // An absolutely positioned element resolves against its nearest positioned ancestor.
    // If none exists up to the root, it resolves against the initial containing block and
    // leaves the root's overflow: hidden entirely, looking contained only by luck.
    function establishesContainingBlock(node, style) {
      if (style.position !== "static") { return true; }
      if (style.transform && style.transform !== "none") { return true; }
      if (style.perspective && style.perspective !== "none") { return true; }
      if (style.filter && style.filter !== "none") { return true; }
      if (style.contain && /paint|layout|strict|content/.test(style.contain)) { return true; }
      if (style.willChange && /transform|perspective|filter/.test(style.willChange)) { return true; }
      return false;
    }
    function scrollingAncestor(node) {
      var p = node.parentElement;
      while (p) {
        var s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX)) { return p; }
        if (p === el) { return null; }
        p = p.parentElement;
      }
      return null;
    }
    out.rootPosition = getComputedStyle(el).position;
    out.positioned = [];
    var everything = el.querySelectorAll("*");
    for (var q = 0; q < everything.length; q += 1) {
      var node3 = everything[q];
      var st3 = getComputedStyle(node3);
      if (st3.position === "static") { continue; }
      var cb = "initial";
      var walk3 = node3.parentElement;
      while (walk3) {
        if (establishesContainingBlock(walk3, getComputedStyle(walk3))) { cb = describe(walk3); break; }
        if (walk3 === el) { break; }
        walk3 = walk3.parentElement;
      }
      var r3 = node3.getBoundingClientRect();
      var hiddenHere = hidden(node3, st3);
      out.positioned.push({
        element: describe(node3),
        position: st3.position,
        zIndex: st3.zIndex,
        containingBlock: cb,
        hasScrollingAncestor: scrollingAncestor(node3) !== null,
        visuallyHidden: hiddenHere,
        box: box(r3),
        // A deliberately hidden 1px box is parked off-flow on purpose; its escape is not a bug.
        escapes: hiddenHere ? [] : escapes(r3)
      });
    }

    // ---- Scrollable regions, actually scrolled -------------------------------------
    // Measuring only at rest is what let a sibling repo's probe pass on a broken layout:
    // its content fit, so nothing scrolled, so sticky positioning never engaged.
    function collectEscapes() {
      var found = [];
      var nodes = el.querySelectorAll("*");
      for (var i2 = 0; i2 < nodes.length; i2 += 1) {
        var n2 = nodes[i2];
        var s2 = getComputedStyle(n2);
        if (hidden(n2, s2)) { continue; }
        var inScroller = false;
        var a2 = n2.parentElement;
        while (a2 && a2 !== el) {
          if (hidden(a2, getComputedStyle(a2)) || scrollsOwnOverflow(a2)) { inScroller = true; break; }
          a2 = a2.parentElement;
        }
        if (inScroller) { continue; }
        var rr = n2.getBoundingClientRect();
        var sd2 = escapes(rr);
        if (sd2.length && (rr.width > 0 || rr.height > 0)) {
          found.push({ element: describe(n2), box: box(rr), overflow: sd2 });
        }
      }
      return found;
    }
    function stickyGroupsIn(container) {
      var byTag = {};
      var nodes = container.querySelectorAll("*");
      for (var i3 = 0; i3 < nodes.length; i3 += 1) {
        var n3 = nodes[i3];
        if (getComputedStyle(n3).position !== "sticky") { continue; }
        var key = describe(n3);
        if (!byTag[key]) { byTag[key] = []; }
        byTag[key].push(round(n3.getBoundingClientRect().top));
      }
      var groups = [];
      for (var k in byTag) {
        if (Object.prototype.hasOwnProperty.call(byTag, k)) {
          groups.push({ element: k, tops: byTag[k] });
        }
      }
      return groups;
    }

    out.scrollRegions = [];
    var candidates = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*")));
    for (var c2 = 0; c2 < candidates.length; c2 += 1) {
      var cand = candidates[c2];
      var cs = getComputedStyle(cand);
      if (!/(auto|scroll)/.test(cs.overflowY) && !/(auto|scroll)/.test(cs.overflowX)) { continue; }
      if (hidden(cand, cs)) { continue; }
      var maxTop = cand.scrollHeight - cand.clientHeight;
      var region = {
        element: describe(cand),
        isRoot: cand === el,
        scrollHeight: cand.scrollHeight,
        clientHeight: cand.clientHeight,
        scrollWidth: cand.scrollWidth,
        clientWidth: cand.clientWidth,
        maxScrollTop: maxTop,
        expectOverflow: false,
        passes: []
      };
      var offsets = maxTop > 1 ? [0, Math.floor(maxTop / 2), maxTop] : [0];
      for (var o2 = 0; o2 < offsets.length; o2 += 1) {
        cand.scrollTop = offsets[o2];
        region.passes.push({
          requestedScrollTop: offsets[o2],
          scrollTop: cand.scrollTop,
          rootScrollTop: el.scrollTop,
          rootScrollLeft: el.scrollLeft,
          regionBox: box(cand.getBoundingClientRect()),
          stickyGroups: stickyGroupsIn(cand),
          escapes: collectEscapes()
        });
      }
      cand.scrollTop = 0;
      out.scrollRegions.push(region);
    }

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
      const data = scenario.overflow
        ? buildOverflowDataView(scenario.overflow)
        : buildDataView(scenario);
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

      // A region is only required to overflow where the visual actually paints it. Marking it
      // here, rather than in the page, keeps the expectation reviewable next to the fixture.
      const expected = scenario.expectScrollOverflow ?? [];
      for (const region of measured.scrollRegions ?? []) {
        region.expectOverflow = expected.some((selector) =>
          region.element.includes(selector.replace(/^\./, "")));
      }
      measured.expectScrollOverflow = expected;
      // Which declared regions the visual actually painted at this viewport, so a region that
      // vanished is reported rather than quietly dropping its own overflow requirement.
      measured.paintedSelectors = expected.filter((selector) => {
        const region = selector === ".atlyn-scatter__table"
          ? measured.regions?.table
          : selector === ".atlyn-scatter__message"
            ? measured.regions?.message
            : undefined;
        return Boolean(region && !region.hidden);
      });
      measured.ruleProblems = evaluateCase(measured);
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
      if (measured.ruleProblems.length) {
        failures += 1;
      }
    }
  }

  console.log(formatTable(rows));
  console.log("");

  // Scroll-time evidence, printed whether or not anything failed: a region that stopped
  // overflowing is the failure mode that makes every other assertion here meaningless.
  console.log("Scrollable regions (measured, then scrolled):");
  const scrollRows = [];
  for (const measured of report.cases) {
    for (const region of measured.scrollRegions ?? []) {
      const offsets = (region.passes ?? []).map((pass) => pass.scrollTop);
      const sticky = (region.passes ?? []).reduce((count, pass) => count + (pass.stickyGroups?.length ?? 0), 0);
      scrollRows.push([
        `${measured.scenario}@${measured.viewport.width}x${measured.viewport.height}`,
        region.element,
        `${region.scrollHeight}/${region.clientHeight}`,
        region.scrollHeight > region.clientHeight + 1 ? "yes" : "no",
        region.expectOverflow ? "required" : "-",
        offsets.join(","),
        String(sticky)
      ]);
    }
  }
  if (scrollRows.length === 0) {
    console.log("  none");
  } else {
    const headers = ["Case", "Region", "scrollH/clientH", "Scrolls", "Expected", "Offsets probed", "Sticky groups"];
    const widths = headers.map((header, index) =>
      Math.max(header.length, ...scrollRows.map((cells) => String(cells[index]).length)));
    const line = (cells) => "  | " + cells.map((cell, index) => String(cell).padEnd(widths[index])).join(" | ") + " |";
    console.log(line(headers));
    console.log("  |" + widths.map((width) => "-".repeat(width + 2)).join("|") + "|");
    for (const cells of scrollRows) {
      console.log(line(cells));
    }
  }
  console.log("");

  const stickyTotal = report.cases.reduce((count, measured) =>
    count + (measured.scrollRegions ?? []).reduce((inner, region) =>
      inner + (region.passes ?? []).reduce((n, pass) => n + (pass.stickyGroups?.length ?? 0), 0), 0), 0);
  const positions = new Map();
  for (const measured of report.cases) {
    for (const element of measured.positioned ?? []) {
      const key = `${element.position}  ${element.element}  containingBlock=${element.containingBlock}  hidden=${element.visuallyHidden}`;
      positions.set(key, (positions.get(key) ?? 0) + 1);
    }
  }
  console.log(`Root computed position: ${report.cases[0]?.rootPosition ?? "unknown"}`);
  console.log(`Sticky groups found across every case: ${stickyTotal}`);
  console.log("Positioned elements (position other than static):");
  if (positions.size === 0) {
    console.log("  none");
  } else {
    for (const [key, count] of positions) {
      console.log(`  ${key}  x${count}`);
    }
  }
  console.log("");

  for (const measured of report.cases) {
    const violations = measured.violations ?? [];
    const selectionViolations = measured.selection?.violations ?? [];
    const focusProblem = measured.focus &&
      (measured.focus.outlineEscapes.length || measured.focus.scrolledRoot || measured.focus.scrolledDocument);
    const ellipsis = measured.computed?.ellipsisWithoutNowrap ?? [];
    const ruleProblems = measured.ruleProblems ?? [];
    if (!violations.length && !selectionViolations.length && !focusProblem && !ellipsis.length && !ruleProblems.length) {
      continue;
    }
    console.log(`--- ${measured.scenario} @ ${measured.viewport.width}x${measured.viewport.height} (${measured.scenarioLabel})`);
    for (const problem of ruleProblems.slice(0, 12)) {
      console.log(`    RULE ${problem}`);
    }
    if (ruleProblems.length > 12) {
      console.log(`    ... ${ruleProblems.length - 12} more rule problems`);
    }
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
