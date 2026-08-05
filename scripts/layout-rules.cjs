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

module.exports = {
  assertRegionOverflows,
  assertExpectedRegionsPresent,
  assertStickyTopsDistinct,
  assertPositionedContainment,
  assertRootDidNotScroll,
  evaluateCase
};
