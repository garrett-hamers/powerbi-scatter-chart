// Capture-time content assertions for the AppSource listing screenshots.
//
// Why this exists: the listing screenshots were once captured from a build where the
// accessible data table rendered at 0px visible height with its rows outside the visual
// root. The images shipped showing no table at all, and nothing noticed, because the
// screenshot pipeline only checked that the output was a 1366x768 PNG under the size cap.
// Those are properties of the *file*, not of the *scene*.
//
// No static property of a PNG separates a correct render from a wrong-but-plausible one:
// distinct-colour floors, blankness heuristics and golden-image diffs all either pass a
// blank render or fail a legitimately flat one, and golden diffs additionally break on
// Chrome versions, font availability and rasteriser changes. The only place the question
// can be answered is *at capture*, inside the page, while the thing that was supposed to
// be drawn is still addressable. So the probe below runs in the same browser process and
// the same frame that produces the PNG, and the generator refuses to publish an image
// whose scene did not measure up.
//
// Presence in the DOM is deliberately not enough. The table existed in the DOM the entire
// time it was broken; querySelector would have found it. Every claim about the table is
// therefore a *geometry* claim: rendered height, rows actually intersecting the visual
// root, rows escaping it.

const ELLIPSIS = "\u2026";

// Runs inside the page, immediately after the harness has rendered the visual. ES5 only,
// so it survives whatever Chromium the machine or the CI image happens to ship. The result
// is base64-encoded into a display:none <pre> so it can never appear in the screenshot.
function probeScript(categories) {
  return `
(function () {
  var CATEGORIES = ${JSON.stringify(categories)};
  var ELLIPSIS = ${JSON.stringify(ELLIPSIS)};
  var out = { probeError: null, renderError: null, metrics: {} };
  function round(value) { return Math.round(value * 100) / 100; }
  try {
    var el = window.__atlynRoot;
    if (!el) { throw new Error("harness never created a visual root"); }
    out.renderError = window.__atlynFailed ? String(window.__atlynFailed) : null;
    var rootRect = el.getBoundingClientRect();
    var m = out.metrics;
    m.rootWidth = round(rootRect.width);
    m.rootHeight = round(rootRect.height);

    function textOf(node) { return (node.textContent || "").replace(/\\s+/g, " ").trim(); }
    function all(selector) { return Array.prototype.slice.call(el.querySelectorAll(selector)); }
    function overlap(rect) {
      // How much of a box actually lands inside the visual root. A region that renders
      // outside the root is clipped away by the host and is invisible to the reader even
      // though getBoundingClientRect reports a healthy size for it.
      return {
        height: Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top)),
        width: Math.max(0, Math.min(rect.right, rootRect.right) - Math.max(rect.left, rootRect.left))
      };
    }
    function distinct(values) {
      var seen = {};
      var count = 0;
      for (var i = 0; i < values.length; i += 1) {
        var key = String(values[i]);
        if (!Object.prototype.hasOwnProperty.call(seen, key)) { seen[key] = true; count += 1; }
      }
      return count;
    }
    function describe(node) {
      var name = node.tagName ? node.tagName.toLowerCase() : "?";
      var cls = node.getAttribute && node.getAttribute("class");
      if (cls) { name += "." + String(cls).trim().split(/\\s+/).join("."); }
      return name;
    }

    var svg = el.querySelector(".atlyn-scatter__svg");
    m.svgPresent = !!svg;
    if (svg) {
      var svgVisible = overlap(svg.getBoundingClientRect());
      m.svgVisibleWidth = round(svgVisible.width);
      m.svgVisibleHeight = round(svgVisible.height);
    } else {
      m.svgVisibleWidth = 0;
      m.svgVisibleHeight = 0;
    }

    var points = all(".atlyn-scatter__point");
    m.points = points.length;
    var radii = [];
    var fills = [];
    var pointsOutsideRoot = 0;
    var pointsFullyVisible = 0;
    for (var p = 0; p < points.length; p += 1) {
      radii.push(points[p].getAttribute("r"));
      fills.push(points[p].getAttribute("fill"));
      var pr = points[p].getBoundingClientRect();
      var po = overlap(pr);
      if (po.height <= 0 || po.width <= 0) { pointsOutsideRoot += 1; }
      else if (po.height >= pr.height - 0.5 && po.width >= pr.width - 0.5) { pointsFullyVisible += 1; }
    }
    m.pointsOutsideRoot = pointsOutsideRoot;
    m.pointsFullyVisible = pointsFullyVisible;
    m.distinctPointRadii = distinct(radii);
    m.distinctPointFills = distinct(fills);

    // Quadrant shading is two stacked rects per quadrant: a tinted fill plus a hatch
    // overlay that keeps the quadrants distinguishable without relying on colour alone.
    var rects = svg ? Array.prototype.slice.call(svg.children).filter(function (node) {
      return node.tagName && node.tagName.toLowerCase() === "rect";
    }) : [];
    var bands = 0;
    var hatches = 0;
    var bandArea = 0;
    for (var r = 0; r < rects.length; r += 1) {
      var fill = rects[r].getAttribute("fill") || "";
      var box = rects[r].getBoundingClientRect();
      var vis = overlap(box);
      if (fill.indexOf("url(") === 0) {
        if (vis.width > 1 && vis.height > 1) { hatches += 1; }
      } else if (vis.width > 1 && vis.height > 1) {
        bands += 1;
        bandArea += vis.width * vis.height;
      }
    }
    m.quadrantBands = bands;
    m.quadrantHatches = hatches;
    m.quadrantBandAreaRatio = rootRect.width * rootRect.height > 0
      ? round(bandArea / (rootRect.width * rootRect.height))
      : 0;

    var texts = svg ? Array.prototype.slice.call(svg.querySelectorAll("text")) : [];
    var quadrantLabels = [];
    var thresholdLabels = [];
    var dataLabels = [];
    var legendLabels = [];
    // Labels are trimmed to the room available, so a category label may arrive truncated
    // with a trailing ellipsis. Matching the surviving stem keeps the count honest.
    function matchesCategory(value) {
      var stem = value.charAt(value.length - 1) === ELLIPSIS
        ? value.slice(0, -1).replace(/\\s+$/, "")
        : value;
      if (stem.length === 0) { return false; }
      for (var c = 0; c < CATEGORIES.length; c += 1) {
        if (CATEGORIES[c] === value) { return true; }
        if (value !== stem && CATEGORIES[c].indexOf(stem) === 0) { return true; }
      }
      return false;
    }
    for (var t = 0; t < texts.length; t += 1) {
      var node = texts[t];
      var value = textOf(node);
      if (!value) { continue; }
      var vbox = overlap(node.getBoundingClientRect());
      if (vbox.width <= 0 || vbox.height <= 0) { continue; }
      if (/^(Upper|Lower) (right|left) \\(\\d+\\)$/.test(value)) { quadrantLabels.push(value); continue; }
      if (value.indexOf("threshold ") === 0) { thresholdLabels.push(value); continue; }
      if (matchesCategory(value)) { dataLabels.push(value); }
    }
    m.quadrantLabels = quadrantLabels.length;
    m.quadrantLabelTexts = quadrantLabels;
    m.thresholdLabelTexts = thresholdLabels;
    m.dataLabels = dataLabels.length;

    var lines = svg ? Array.prototype.slice.call(svg.querySelectorAll("line")) : [];
    var thresholdLines = 0;
    var regressionLines = 0;
    for (var l = 0; l < lines.length; l += 1) {
      var dash = lines[l].getAttribute("stroke-dasharray") || "";
      var lbox = overlap(lines[l].getBoundingClientRect());
      var drawn = lbox.width > 1 || lbox.height > 1;
      if (!drawn) { continue; }
      if (dash === "5 4") { thresholdLines += 1; }
      if (dash === "7 3") { regressionLines += 1; }
    }
    m.thresholdLines = thresholdLines;
    m.regressionLines = regressionLines;

    // Legend chips are the only circles in the chart that are not data points.
    var legendMarkers = 0;
    var circles = svg ? Array.prototype.slice.call(svg.querySelectorAll("circle")) : [];
    for (var q = 0; q < circles.length; q += 1) {
      if (circles[q].classList && circles[q].classList.contains("atlyn-scatter__point")) { continue; }
      var cbox = overlap(circles[q].getBoundingClientRect());
      if (cbox.width > 0 && cbox.height > 0) { legendMarkers += 1; }
    }
    m.legendMarkers = legendMarkers;
    var group = svg ? svg.querySelector("g") : null;
    var annotationNodes = group ? Array.prototype.slice.call(group.querySelectorAll("text")) : [];
    m.annotationTexts = annotationNodes.map(textOf).filter(function (value) { return value.length > 0; });
    // Series names ride on legend text nodes, which are the chart text nodes left over once
    // quadrant, threshold, data-label, axis and annotation text is accounted for.
    for (var g = 0; g < texts.length; g += 1) {
      var candidate = texts[g];
      if (group && group.contains(candidate)) { continue; }
      var candidateText = textOf(candidate);
      if (!candidateText) { continue; }
      if (/^(Upper|Lower) (right|left) \\(\\d+\\)$/.test(candidateText)) { continue; }
      if (candidateText.indexOf("threshold ") === 0) { continue; }
      if (matchesCategory(candidateText)) { continue; }
      var prev = candidate.previousElementSibling;
      if (prev && prev.tagName && prev.tagName.toLowerCase() === "circle" &&
        !(prev.classList && prev.classList.contains("atlyn-scatter__point"))) {
        legendLabels.push(candidateText);
      }
    }
    m.legendLabelTexts = legendLabels;

    // ---- Accessible data table -------------------------------------------------------
    // The historical defect: this wrapper was in the DOM, reported a plausible height, and
    // rendered entirely outside the visual root, so the reader saw nothing. Presence is
    // therefore never asserted on its own; everything below is measured geometry.
    var wrapper = el.querySelector(".atlyn-scatter__table");
    m.tablePresent = !!wrapper;
    m.tableVisibleHeight = 0;
    m.tableVisibleWidth = 0;
    m.tableRenderedHeight = 0;
    m.tableBodyRows = 0;
    m.tableVisibleRows = 0;
    m.tableEscapesRoot = 0;
    m.tableRowsEscapingWrapper = 0;
    m.tableHeaderCells = 0;
    m.tableCaptionText = "";
    m.tableHiddenChain = false;
    if (wrapper) {
      var style = getComputedStyle(wrapper);
      var hiddenChain = style.display === "none" || style.visibility === "hidden" ||
        (style.clipPath && style.clipPath.indexOf("inset(50%") !== -1);
      var up = wrapper.parentElement;
      while (!hiddenChain && up && up !== el) {
        var upStyle = getComputedStyle(up);
        if (upStyle.display === "none" || upStyle.visibility === "hidden") { hiddenChain = true; }
        up = up.parentElement;
      }
      m.tableHiddenChain = !!hiddenChain;
      var wrapperRect = wrapper.getBoundingClientRect();
      var wrapperVisible = overlap(wrapperRect);
      m.tableRenderedHeight = round(wrapperRect.height);
      m.tableVisibleHeight = round(wrapperVisible.height);
      m.tableVisibleWidth = round(wrapperVisible.width);
      var caption = wrapper.querySelector("caption");
      m.tableCaptionText = caption ? textOf(caption) : "";
      m.tableHeaderCells = wrapper.querySelectorAll("thead th").length;
      var rows = Array.prototype.slice.call(wrapper.querySelectorAll("tbody tr"));
      m.tableBodyRows = rows.length;
      // The wrapper is the band the reader actually sees, so it must sit wholly inside the
      // visual root. The broken build put this box outside the root entirely.
      var escapeSides = 0;
      if (wrapperRect.left < rootRect.left - 0.5) { escapeSides += 1; }
      if (wrapperRect.top < rootRect.top - 0.5) { escapeSides += 1; }
      if (wrapperRect.right > rootRect.right + 0.5) { escapeSides += 1; }
      if (wrapperRect.bottom > rootRect.bottom + 0.5) { escapeSides += 1; }
      m.tableEscapesRoot = escapeSides;
      // The wrapper scrolls its own overflow, so a row only counts as read-able when it
      // lands inside the wrapper's clipped viewport *and* inside the visual root. Rows
      // parked below the fold are legitimate scrolling; rows outside the wrapper's own
      // scrollable content box are a layout defect.
      var clipTop = Math.max(wrapperRect.top, rootRect.top);
      var clipBottom = Math.min(wrapperRect.bottom, rootRect.bottom);
      var clipLeft = Math.max(wrapperRect.left, rootRect.left);
      var clipRight = Math.min(wrapperRect.right, rootRect.right);
      var contentTop = wrapperRect.top - wrapper.scrollTop;
      var contentBottom = contentTop + wrapper.scrollHeight;
      for (var i2 = 0; i2 < rows.length; i2 += 1) {
        var rr = rows[i2].getBoundingClientRect();
        var visibleHeight = Math.min(rr.bottom, clipBottom) - Math.max(rr.top, clipTop);
        var visibleWidth = Math.min(rr.right, clipRight) - Math.max(rr.left, clipLeft);
        if (visibleHeight > 1 && visibleWidth > 1) { m.tableVisibleRows += 1; }
        if (rr.left < wrapperRect.left - 0.5 || rr.right > wrapperRect.right + 0.5 ||
          rr.top < contentTop - 0.5 || rr.bottom > contentBottom + 0.5) {
          m.tableRowsEscapingWrapper += 1;
        }
      }
    }

    // Generic backstop: content painted outside the clipped root is content the reader
    // never sees, whatever it is. Anything inside a genuinely scrolling ancestor is exempt.
    function scrolls(node) {
      var s = getComputedStyle(node);
      var scrollable = s.overflowY === "auto" || s.overflowY === "scroll" ||
        s.overflowX === "auto" || s.overflowX === "scroll";
      return scrollable && (node.clientHeight > 0 || node.clientWidth > 0);
    }
    var escaped = [];
    var everything = el.querySelectorAll("*");
    for (var e = 0; e < everything.length; e += 1) {
      var candidate2 = everything[e];
      var cs = getComputedStyle(candidate2);
      if (cs.display === "none" || cs.visibility === "hidden") { continue; }
      if (cs.clipPath && cs.clipPath.indexOf("inset(50%") !== -1) { continue; }
      var exempt = false;
      var walk = candidate2.parentElement;
      while (walk && walk !== el) {
        var ws = getComputedStyle(walk);
        if (ws.display === "none" || ws.visibility === "hidden" ||
          (ws.clipPath && ws.clipPath.indexOf("inset(50%") !== -1) || scrolls(walk)) { exempt = true; break; }
        walk = walk.parentElement;
      }
      if (exempt) { continue; }
      var box2 = candidate2.getBoundingClientRect();
      if (box2.width <= 0 && box2.height <= 0) { continue; }
      if (box2.left < rootRect.left - 0.5 || box2.top < rootRect.top - 0.5 ||
        box2.right > rootRect.right + 0.5 || box2.bottom > rootRect.bottom + 0.5) {
        if (escaped.length < 8) { escaped.push(describe(candidate2)); }
      }
    }
    m.elementsEscapingRoot = escaped.length;
    m.escapingSample = escaped;
  } catch (error) {
    out.probeError = String(error && error.stack ? error.stack : error);
  }

  var pre = document.createElement("pre");
  pre.id = "atlyn-scene-probe";
  pre.style.display = "none";
  pre.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(out))));
  document.body.appendChild(pre);
})();
`;
}

function extractProbe(dom) {
  const match = dom.match(/<pre id="atlyn-scene-probe"[^>]*>([\s\S]*?)<\/pre>/);
  if (!match) {
    const rendered = dom.match(/<pre id=['"]atlyn-error['"]>([\s\S]*?)<\/pre>/);
    return {
      probeError: rendered
        ? `the visual never rendered: ${rendered[1].slice(0, 400)}`
        : `the page produced no probe result. DOM head: ${dom.slice(0, 300)}`,
      metrics: {}
    };
  }
  return JSON.parse(Buffer.from(match[1].trim(), "base64").toString("utf8"));
}

function formatValue(value) {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

// A rule is one clause so a failure names exactly one broken claim.
function checkRule(actual, rule) {
  if (Object.prototype.hasOwnProperty.call(rule, "equals")) {
    return actual === rule.equals ? null : `expected ${rule.equals}, measured ${formatValue(actual)}`;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "atLeast")) {
    return typeof actual === "number" && actual >= rule.atLeast
      ? null
      : `expected at least ${rule.atLeast}, measured ${formatValue(actual)}`;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "atMost")) {
    return typeof actual === "number" && actual <= rule.atMost
      ? null
      : `expected at most ${rule.atMost}, measured ${formatValue(actual)}`;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "sameSet")) {
    const expected = [...rule.sameSet].sort();
    const measured = [...(Array.isArray(actual) ? actual : [])].sort();
    return expected.length === measured.length && expected.every((value, index) => value === measured[index])
      ? null
      : `expected exactly ${JSON.stringify(expected)}, measured ${formatValue(actual)}`;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "someMatches")) {
    const values = Array.isArray(actual) ? actual : [String(actual)];
    return values.some((value) => rule.someMatches.test(value))
      ? null
      : `expected one entry matching ${rule.someMatches}, measured ${formatValue(actual)}`;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "everyMatches")) {
    const values = Array.isArray(actual) ? actual : [String(actual)];
    const offender = values.find((value) => !rule.everyMatches.test(value));
    return values.length > 0 && offender === undefined
      ? null
      : `expected every entry to match ${rule.everyMatches}, measured ${formatValue(actual)}`;
  }
  if (Object.prototype.hasOwnProperty.call(rule, "noneMatches")) {
    const values = Array.isArray(actual) ? actual : [String(actual)];
    const offender = values.find((value) => rule.noneMatches.test(value));
    return offender === undefined
      ? null
      : `expected no entry matching ${rule.noneMatches}, measured ${JSON.stringify(offender)}`;
  }
  throw new Error(`unsupported expectation rule: ${JSON.stringify(rule)}`);
}

function evaluateScene(scene, probe) {
  const failures = [];
  if (probe.probeError) {
    failures.push({ metric: "probe", why: probe.probeError });
    return failures;
  }
  if (probe.renderError) {
    failures.push({ metric: "render", why: `the visual reported a render failure: ${probe.renderError}` });
  }
  for (const [metric, rule] of Object.entries(scene.expect)) {
    if (!Object.prototype.hasOwnProperty.call(probe.metrics, metric)) {
      failures.push({ metric, why: "the probe never measured this metric" });
      continue;
    }
    const why = checkRule(probe.metrics[metric], rule);
    if (why) {
      failures.push({ metric, why, because: scene.because?.[metric] });
    }
  }
  return failures;
}

function formatFailures(scene, failures) {
  const lines = [
    `Screenshot generation failed: scene ${scene.file} did not render what it claims to show.`,
    `  Scene: ${scene.caption}`
  ];
  for (const failure of failures) {
    lines.push(`  - ${failure.metric}: ${failure.why}`);
    if (failure.because) {
      lines.push(`      ${failure.because}`);
    }
  }
  lines.push("  No image was written for this scene. Fix the render, then re-run.");
  return lines.join("\n");
}

module.exports = { probeScript, extractProbe, evaluateScene, formatFailures };
