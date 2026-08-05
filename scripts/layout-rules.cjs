// Verdict rules for the layout probe. The browser measures; this module decides. Keeping the
// judgement out of the page means every rule can be unit-tested against synthetic numbers,
// including failure modes the shipped visual does not currently have.
//
// The rules exist because at-rest geometry is not enough. A sibling repo's probe reported
// "no latent bugs" from a fixture whose content happened to fit:
//
//   scrollHeight 1114 === clientHeight 1114  ->  nothing scrolled
//
// Nothing scrolled, so position: sticky never engaged, and three real defects stayed
// invisible behind assertions that all passed. Overflow has to be forced, then scrolled.

/**
 * A region that is supposed to scroll must actually be scrolling in the fixture, otherwise
 * the scroll-time assertions below are vacuous and would pass on a broken layout.
 */
function assertRegionOverflows(region) {
  const problems = [];
  const vertical = region.scrollHeight > region.clientHeight + 1;
  const horizontal = region.scrollWidth > region.clientWidth + 1;
  if (!vertical && !horizontal) {
    problems.push(
      `${region.element} was expected to overflow but scrollHeight ${region.scrollHeight} ` +
      `=== clientHeight ${region.clientHeight} and scrollWidth ${region.scrollWidth} ` +
      `=== clientWidth ${region.clientWidth}; the fixture stopped overflowing, so every ` +
      `scroll-time assertion for this region is vacuous`
    );
  }
  return problems;
}

/**
 * The companion to assertRegionOverflows: if the region disappeared from the DOM entirely,
 * there is nothing to assert against and the requirement would silently evaporate. Painted
 * regions that were declared scrollable must show up in the measurements.
 */
function assertExpectedRegionsPresent({ expected, scrollRegions, paintedSelectors }) {
  const problems = [];
  for (const selector of expected ?? []) {
    if (!paintedSelectors.includes(selector)) {
      continue;
    }
    const bare = selector.replace(/^\./, "");
    const found = (scrollRegions ?? []).some((region) => region.element.includes(bare));
    if (!found) {
      problems.push(
        `${selector} is painted but was not measured as a scrollable region, so its ` +
        `overflow requirement never ran`
      );
    }
  }
  return problems;
}

/**
 * The cheap invariant that catches sticky headers pinning on top of each other: after a
 * scroll, the top edges of a sticky group must stay strictly increasing and all distinct.
 * Collapsed headers show up as repeated values.
 */
function assertStickyTopsDistinct(group) {
  const problems = [];
  const tops = group.tops ?? [];
  if (tops.length < 2) {
    return problems;
  }
  const duplicates = tops.filter((value, index) => tops.indexOf(value) !== index);
  if (duplicates.length > 0) {
    problems.push(
      `${group.element} sticky tops collapsed onto each other at scrollTop ${group.scrollTop}: ` +
      `[${tops.join(", ")}] repeats ${[...new Set(duplicates)].join(", ")}`
    );
  }
  for (let index = 1; index < tops.length; index += 1) {
    if (tops[index] <= tops[index - 1]) {
      problems.push(
        `${group.element} sticky tops are not strictly increasing at scrollTop ` +
        `${group.scrollTop}: [${tops.join(", ")}]`
      );
      break;
    }
  }
  return problems;
}

/**
 * An absolutely positioned element resolves against its nearest positioned ancestor. When
 * there is none, it resolves against the initial containing block and leaves the visual's
 * overflow: hidden entirely, which looks contained only by luck.
 */
function assertPositionedContainment(element) {
  const problems = [];
  if (element.position === "fixed") {
    problems.push(
      `${element.element} uses position: fixed, which always resolves against the viewport ` +
      `and cannot be clipped by the visual root`
    );
  }
  if (element.position === "absolute" && element.containingBlock === "initial") {
    problems.push(
      `${element.element} is absolutely positioned but no ancestor up to the visual root is ` +
      `positioned, so it resolves against the initial containing block and escapes the ` +
      `root's overflow: hidden`
    );
  }
  if (element.position === "sticky" && !element.hasScrollingAncestor) {
    problems.push(
      `${element.element} uses position: sticky but has no scrolling ancestor, so it can ` +
      `never engage and silently behaves as position: relative`
    );
  }
  if (element.escapes && element.escapes.length > 0) {
    problems.push(
      `${element.element} (position: ${element.position}) escapes the root over ` +
      `${element.escapes.join(", ")}`
    );
  }
  return problems;
}

/**
 * Scrolling a region inside the visual must never scroll the clipped root itself. A root
 * that scrolls means content was parked outside the visible box and something dragged it
 * into view.
 */
function assertRootDidNotScroll(pass) {
  const problems = [];
  if (pass.rootScrollTop !== 0 || pass.rootScrollLeft !== 0) {
    problems.push(
      `scrolling ${pass.element} to ${pass.scrollTop} moved the visual root itself to ` +
      `(${pass.rootScrollLeft}, ${pass.rootScrollTop}); the root must never scroll`
    );
  }
  return problems;
}

/**
 * Applies every rule to one probe case and returns a flat list of problems.
 */
function evaluateCase(measured) {
  const problems = [];
  problems.push(...assertExpectedRegionsPresent({
    expected: measured.expectScrollOverflow,
    scrollRegions: measured.scrollRegions,
    paintedSelectors: measured.paintedSelectors ?? []
  }));
  for (const region of measured.scrollRegions ?? []) {
    if (region.expectOverflow) {
      problems.push(...assertRegionOverflows(region));
    }
    for (const pass of region.passes ?? []) {
      problems.push(...assertRootDidNotScroll({ ...pass, element: region.element }));
      for (const escape of pass.escapes ?? []) {
        problems.push(
          `at scrollTop ${pass.scrollTop} of ${region.element}, ${escape.element} escapes ` +
          `the root over ${escape.overflow.join(", ")}`
        );
      }
      for (const group of pass.stickyGroups ?? []) {
        problems.push(...assertStickyTopsDistinct({ ...group, scrollTop: pass.scrollTop }));
      }
    }
  }
  for (const element of measured.positioned ?? []) {
    problems.push(...assertPositionedContainment(element));
  }
  return problems;
}

/**
 * Does one candidate ancestor genuinely excuse a descendant's overflow?
 *
 * Two traps, both of which have bitten a probe in this portfolio:
 *
 * 1. A `<table>` reports `overflow: auto` from getComputedStyle and *never* becomes a scroll
 *    container — `overflow` is inert on a `display: table` box. A probe that tests the
 *    declared property accepts it as a scroller and exempts everything beneath it, so the
 *    defect it exists to catch becomes invisible. The exemption must be proven by geometry.
 * 2. The visual root frequently declares `overflow: auto` itself. If the root is allowed to
 *    exempt its own descendants, *no escape can ever be reported* and every case goes green.
 *    The root is never an exempting ancestor: escaping it is precisely what is being measured.
 *
 * Takes measured facts rather than DOM nodes so both traps can be exercised without a browser.
 *
 * @param {object} candidate
 * @param {boolean} candidate.isRoot the visual root, which can never exempt
 * @param {string} candidate.overflowX computed overflow-x
 * @param {string} candidate.overflowY computed overflow-y
 * @param {number} candidate.clientWidth
 * @param {number} candidate.clientHeight
 * @param {number} candidate.scrollWidth
 * @param {number} candidate.scrollHeight
 * @param {number} candidate.rectHeight border-box height
 * @param {boolean} candidate.insideRoot whether its own box sits within the root
 */
function isExemptingAncestor(candidate) {
  if (!candidate || candidate.isRoot) {
    return false;
  }
  const scrollable = ["auto", "scroll"].includes(candidate.overflowY) ||
    ["auto", "scroll"].includes(candidate.overflowX);
  if (!scrollable) {
    return false;
  }
  // A box with no content area cannot clip anything, and a `display: table` box reports
  // clientWidth/clientHeight of 0 for this purpose.
  if (candidate.clientHeight <= 0 && candidate.clientWidth <= 0) {
    return false;
  }
  // An ancestor that has itself escaped the root cannot excuse a descendant for escaping it.
  if (!candidate.insideRoot) {
    return false;
  }
  const overflows = candidate.scrollHeight > candidate.clientHeight + 1 ||
    candidate.scrollWidth > candidate.clientWidth + 1;
  const boundsItsContent = candidate.clientHeight > 0 &&
    Math.abs(candidate.clientHeight - candidate.rectHeight) < candidate.clientHeight;
  return overflows || boundsItsContent;
}

/**
 * Walks an ancestor chain, nearest first, and returns the first genuinely exempting ancestor.
 * The chain must stop at the root: the root itself is included only so it can be rejected,
 * which is what keeps a scrolling root from blinding the whole probe.
 */
function exemptingAncestor(chain) {
  for (const candidate of chain ?? []) {
    if (isExemptingAncestor(candidate)) {
      return candidate;
    }
    if (candidate?.isRoot) {
      return undefined;
    }
  }
  return undefined;
}

module.exports = {
  assertRegionOverflows,
  assertExpectedRegionsPresent,
  assertStickyTopsDistinct,
  assertPositionedContainment,
  assertRootDidNotScroll,
  isExemptingAncestor,
  exemptingAncestor,
  evaluateCase
};
