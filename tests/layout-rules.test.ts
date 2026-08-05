import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

// Resolved at runtime from the emitted dist-tests/tests/ location.
const rules = require("../../scripts/layout-rules.cjs") as {
  assertRegionOverflows: (region: Record<string, unknown>) => string[];
  assertExpectedRegionsPresent: (input: {
    expected?: string[];
    scrollRegions?: Array<{ element: string }>;
    paintedSelectors: string[];
  }) => string[];
  assertStickyTopsDistinct: (group: { element: string; tops: number[]; scrollTop?: number }) => string[];
  assertPositionedContainment: (element: Record<string, unknown>) => string[];
  assertRootDidNotScroll: (pass: Record<string, unknown>) => string[];
  evaluateCase: (measured: Record<string, unknown>) => string[];
};

// Keeps the import above honest about where the rules live.
test("the rules module ships in scripts/", () => {
  assert.equal(path.basename("../../scripts/layout-rules.cjs"), "layout-rules.cjs");
});

// The exact failure that let a sibling repo's probe report "no latent bugs": the fixture's
// content fit its container, so nothing scrolled and every scroll-time assertion was vacuous.
test("fails loudly when a region that must overflow has stopped overflowing", () => {
  const notScrolling = rules.assertRegionOverflows({
    element: "div.atlyn-scatter__table",
    scrollHeight: 1114,
    clientHeight: 1114,
    scrollWidth: 400,
    clientWidth: 400
  });
  assert.equal(notScrolling.length, 1);
  assert.match(notScrolling[0], /stopped overflowing/);
  assert.match(notScrolling[0], /vacuous/);

  assert.deepEqual(
    rules.assertRegionOverflows({
      element: "div.atlyn-scatter__table",
      scrollHeight: 6114,
      clientHeight: 180,
      scrollWidth: 400,
      clientWidth: 400
    }),
    []
  );
});

test("fails when a declared scrollable region is painted but never measured", () => {
  const missing = rules.assertExpectedRegionsPresent({
    expected: [".atlyn-scatter__table"],
    scrollRegions: [],
    paintedSelectors: [".atlyn-scatter__table"]
  });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /never ran/);

  // Not painted at this viewport, so there is nothing to require.
  assert.deepEqual(
    rules.assertExpectedRegionsPresent({
      expected: [".atlyn-scatter__table"],
      scrollRegions: [],
      paintedSelectors: []
    }),
    []
  );
  assert.deepEqual(
    rules.assertExpectedRegionsPresent({
      expected: [".atlyn-scatter__table"],
      scrollRegions: [{ element: "div.atlyn-scatter__table" }],
      paintedSelectors: [".atlyn-scatter__table"]
    }),
    []
  );
});

// The cheap invariant that catches sticky headers pinning on top of each other. This visual
// ships no sticky positioning, so the rule is proved against the sibling repo's measured
// numbers rather than against a defect that has to be introduced here first.
test("catches sticky headers collapsing onto each other after a scroll", () => {
  const atRest = rules.assertStickyTopsDistinct({
    element: "th.sticky",
    tops: [105, 142, 179, 216, 253, 290],
    scrollTop: 0
  });
  assert.deepEqual(atRest, [], "at rest the bug is invisible, which is the whole problem");

  const scrolled = rules.assertStickyTopsDistinct({
    element: "th.sticky",
    tops: [67, 67, 67, 67, 73, 110],
    scrollTop: 180
  });
  assert.ok(scrolled.length > 0, "four headers pinned to the same top must be caught");
  assert.match(scrolled[0], /collapsed onto each other/);
  assert.match(scrolled.join(" "), /67/);
});

test("catches sticky tops that go backwards even without duplicates", () => {
  const problems = rules.assertStickyTopsDistinct({
    element: "th.sticky",
    tops: [100, 90, 120],
    scrollTop: 40
  });
  assert.ok(problems.some((p) => /not strictly increasing/.test(p)), problems.join(" | "));
});

test("ignores sticky groups too small to have an ordering", () => {
  assert.deepEqual(rules.assertStickyTopsDistinct({ element: "th", tops: [42], scrollTop: 0 }), []);
  assert.deepEqual(rules.assertStickyTopsDistinct({ element: "th", tops: [], scrollTop: 0 }), []);
});

// The Cohort caption bug: the root computed position: static, so an absolutely positioned
// element resolved against the initial containing block and escaped overflow: hidden.
test("catches an absolutely positioned element with no positioned ancestor", () => {
  const escaped = rules.assertPositionedContainment({
    element: "caption",
    position: "absolute",
    containingBlock: "initial",
    escapes: []
  });
  assert.equal(escaped.length, 1);
  assert.match(escaped[0], /initial containing block/);

  assert.deepEqual(
    rules.assertPositionedContainment({
      element: "div.atlyn-scatter__table--visually-hidden",
      position: "absolute",
      containingBlock: "div.atlyn-scatter",
      escapes: []
    }),
    []
  );
});

test("rejects position: fixed outright and sticky with nothing to stick to", () => {
  const fixed = rules.assertPositionedContainment({
    element: "div.banner",
    position: "fixed",
    containingBlock: "initial",
    escapes: []
  });
  assert.ok(fixed.some((p) => /cannot be clipped by the visual root/.test(p)), fixed.join(" | "));

  const orphanSticky = rules.assertPositionedContainment({
    element: "th.sticky",
    position: "sticky",
    containingBlock: "div.atlyn-scatter",
    hasScrollingAncestor: false,
    escapes: []
  });
  assert.ok(orphanSticky.some((p) => /never engage/.test(p)), orphanSticky.join(" | "));
});

test("reports a positioned element whose box leaves the root", () => {
  const problems = rules.assertPositionedContainment({
    element: "div.overlay",
    position: "absolute",
    containingBlock: "div.atlyn-scatter",
    escapes: ["bottom:412"]
  });
  assert.ok(problems.some((p) => /escapes the root over bottom:412/.test(p)), problems.join(" | "));
});

test("requires that scrolling an inner region never scrolls the clipped root", () => {
  assert.deepEqual(
    rules.assertRootDidNotScroll({ element: "div.table", scrollTop: 200, rootScrollTop: 0, rootScrollLeft: 0 }),
    []
  );
  const dragged = rules.assertRootDidNotScroll({
    element: "div.table",
    scrollTop: 200,
    rootScrollTop: 48,
    rootScrollLeft: 0
  });
  assert.equal(dragged.length, 1);
  assert.match(dragged[0], /root must never scroll/);
});

test("evaluateCase gathers every rule over one measured case", () => {
  const problems = rules.evaluateCase({
    expectScrollOverflow: [".atlyn-scatter__table"],
    paintedSelectors: [".atlyn-scatter__table"],
    scrollRegions: [
      {
        element: "div.atlyn-scatter__table",
        expectOverflow: true,
        scrollHeight: 500,
        clientHeight: 500,
        scrollWidth: 300,
        clientWidth: 300,
        passes: [
          {
            scrollTop: 0,
            rootScrollTop: 12,
            rootScrollLeft: 0,
            stickyGroups: [{ element: "th.sticky", tops: [10, 10, 40] }],
            escapes: [{ element: "tr", overflow: ["bottom:9"] }]
          }
        ]
      }
    ],
    positioned: [
      { element: "caption", position: "absolute", containingBlock: "initial", escapes: [] }
    ]
  });
  const joined = problems.join(" | ");
  assert.match(joined, /stopped overflowing/);
  assert.match(joined, /root must never scroll/);
  assert.match(joined, /collapsed onto each other/);
  assert.match(joined, /escapes the root over bottom:9/);
  assert.match(joined, /initial containing block/);
});

test("evaluateCase is silent on a healthy case", () => {
  assert.deepEqual(
    rules.evaluateCase({
      expectScrollOverflow: [".atlyn-scatter__table"],
      paintedSelectors: [".atlyn-scatter__table"],
      scrollRegions: [
        {
          element: "div.atlyn-scatter__table",
          expectOverflow: true,
          scrollHeight: 6114,
          clientHeight: 180,
          scrollWidth: 300,
          clientWidth: 300,
          passes: [
            { scrollTop: 0, rootScrollTop: 0, rootScrollLeft: 0, stickyGroups: [], escapes: [] },
            { scrollTop: 5934, rootScrollTop: 0, rootScrollLeft: 0, stickyGroups: [], escapes: [] }
          ]
        }
      ],
      positioned: [
        {
          element: "div.atlyn-scatter__table--visually-hidden",
          position: "absolute",
          containingBlock: "div.atlyn-scatter",
          escapes: []
        }
      ]
    }),
    []
  );
});
