# Atlyn Scatter

Atlyn Scatter is a certification-first Power BI custom visual for explainable quadrant
analysis. It keeps the stable visual GUID `atlynScatter`, uses local SVG rendering, exposes
threshold provenance and inclusive boundary semantics, and computes ordinary-least-squares
regression explicitly.

The visual has no network privileges or external runtime assets. It uses host-provided
selection, highlight, tooltip, context-menu, accessibility, localization, high-contrast,
RTL, reduced-motion, and export surfaces.

## Development

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run build
npm run package
npm run reproducibility-audit
npm run certification-audit
npm run layout-probe
npm run prove-regressions
npm run publication-audit
npm run audit
```

Use Node.js 20.19 or newer. `npm run certification-audit` starts from a clean output directory,
runs Microsoft's packaged-code certification audit and the complete automated
release gate, including two clean package runs with byte-for-byte and SHA-256 equality. Those two
runs package under timezones on opposite sides of UTC (`Etc/GMT+12` and `Etc/GMT-14`), so a
build whose bytes depend on the builder's clock fails the gate. The generated package is written
to `dist/atlynScatter.1.0.6.0.pbiviz`. Packaging normalizes ZIP entry order, timestamps (to a
fixed UTC-anchored DOS timestamp), permissions, and compression before an atomic replacement.
Package metadata is sourced from `pbiviz.json` and `capabilities.json`; stale PBIVIZ files are
rejected. The audit also opens the generated package and asserts that the bundled script, the
compiled stylesheet, and a 20x20 PNG icon are all present, and that the archive is a loadable
container: a `package.json` manifest plus exactly one `resources/<GUID>.pbiviz.json`, with
`resources[0].sourceType` 5, a `file` pointer that resolves to a real entry, a
`metadata.pbivizjson.resourceId` that matches it, and no source-tree entries. That container
check exists because a source-tree-shaped zip passes every content-level assertion while being
completely unresolvable by the host. `npm run release-manifest` writes
`dist/release-manifest.json` with the source commit, exact package filename, byte size, SHA-256,
and the SHA-256 of every publication asset. The release manifest is the immutable-artifact
record: never overwrite a package or manifest at an existing versioned location.

## Layout probe

Asserting that the packaged `content.css` is non-empty would pass on a completely broken
layout, so `npm run layout-probe` measures the shipped product instead of describing it. It
extracts the bundle **and** the stylesheet from `dist/*.pbiviz`, loads them into the shared
offline harness (`scripts/visual-harness.cjs`, also used by the screenshot generator) with a
mock `IVisualHost`, and reads real geometry with `getBoundingClientRect()` in headless
Chromium. The harness attaches a shadow root when — and only when — the packaged stylesheet
actually uses `:host`, which it currently does not; the probe prints which mode it used.

The generic assertion is that no element's border box may escape the visual root, ignoring
anything inside an ancestor that *genuinely* scrolls its own overflow. That distinction
matters: a `<table>` reports `overflow: auto` in `getComputedStyle` but never becomes a
scroll container, so the exemption is proven by geometry rather than by the declared
property. The probe also flags elements whose height collapses to near zero while they are
supposed to be visible, and any `text-overflow: ellipsis` that ships without
`white-space: nowrap` — ellipsis only applies to a single line, so without it the rule
silently does nothing and the text wraps instead.

Every scenario is measured at 1280x620, 398x298, 258x198, 178x138 and 80x80, the smallest
viewport the visual declares support for. Alongside the default rendering it exercises
keyboard focus (outline containment, and whether focusing scrolls the clipped root),
selection state, the high-contrast palette, an RTL locale, and the reduced-motion
preference. Results are written to `dist/layout-probe.json` and the command exits non-zero
on any violation.

### Overflow, scrolling and positioning

Small viewports and overflowing content are different tests, and measuring only at rest
hides a whole class of bug. A sibling repo's probe reported "no latent bugs" from a fixture
whose content happened to fit its container:

```
scrollHeight 1114 === clientHeight 1114  ->  nothing scrolled
```

Nothing scrolled, so `position: sticky` never engaged, and three real defects stayed
invisible behind assertions that all passed. So the probe also runs deliberately
overflowing fixtures — 320 categories, up to 12 series — **scrolls every scrollable region**
to its top, midpoint and maximum, and re-measures at each offset. A region declared
scrollable must prove it is actually scrolling (`scrollHeight > clientHeight`) and must
still be present in the measurements, so the suite fails loudly if a fixture stops
overflowing rather than silently passing on a vacuous assertion.

Positioning is checked explicitly. Every element whose computed `position` is not `static`
is resolved to the ancestor that establishes its containing block. An absolutely positioned
element with no positioned ancestor resolves against the initial containing block and
escapes the root's `overflow: hidden` entirely, looking contained only by luck; `position:
fixed` can never be clipped by the root at all; and `position: sticky` with no scrolling
ancestor silently behaves as `position: relative`. Where sticky elements do exist, their
bounding-rect `top` values after a scroll must be strictly increasing and all distinct,
which is the cheap invariant that catches sticky headers pinning on top of each other.

The verdict rules live in `scripts/layout-rules.cjs` as pure functions, so
`tests/layout-rules.test.ts` can drive each one with the failure it exists to catch —
including the sticky-collapse numbers from the sibling repo — rather than only with numbers
this visual currently produces.

`npm run prove-regressions` closes the loop on the regression tests: it reverts each layout
fix individually in the working tree, re-runs `tests/layout.test.ts`, and requires the
matching test to go red. A test that still passes with its fix reverted proves nothing, so
the command fails if any fix is not demonstrably covered. It restores every file it touches
and writes `dist/regression-proof.json`.

## AppSource publication

[`docs/partner-center-submission.md`](docs/partner-center-submission.md) records the concrete
final value of every Microsoft Partner Center submission field, plus the manual steps that
remain. [`EULA.md`](EULA.md) is the end-user licence agreement for the AppSource listing.

`npm run publication-audit` (also run as part of `npm run certification-audit`) verifies the
submission surface deterministically:

- `assets/icon.png` is a valid PNG, exactly 20x20, and not a placeholder.
- `assets/partner-center-logo-300x300.png` is a valid PNG, exactly 300x300.
- both brand assets match a pixel-for-pixel regeneration by `scripts/generate-brand-assets.cjs`.
- `assets/screenshots/` holds 1 to 5 PNG files, each exactly 1366x768 and at most 1024 KB.
- the offline sample report in `samples/` embeds the visual under `CustomVisuals/`, avoids
  `publicCustomVisuals`, matches the current visual version, and defines its data as a DAX
  calculated table with no data source.
- `pbiviz.json` carries every required submission field, a four-part version, an `https://`
  support URL, and an author email that is not an RFC 2606 reserved domain.
- `EULA.md` and the submission dossier exist, and the dossier records the `https://` privacy
  policy URL.

Publication assets are regenerated with dependency-free scripts:

```text
npm run generate-brand-assets
npm run package && npm run screenshots
npm run package && npm run generate-sample-report
```

`npm run screenshots` renders the **actual built visual** from `dist/*.pbiviz` in headless
Microsoft Edge or Google Chrome against a mock host and hard-coded offline sample data, then
captures PNGs at exactly 1366x768. It requires a locally installed Chromium-based browser
(override the path with `ATLYN_BROWSER`) and fails loudly rather than producing placeholder
images.

Every scene is asserted **at capture time**, because the size and format of a PNG say nothing
about whether the right thing was drawn. A single browser run emits both the screenshot and a
probe of the same frame, each scene declares what it must contain, and the image is staged in
`.tmp/` until its own assertions pass; a scene that fails takes any stale published image with
it rather than leaving one in place looking current. Claims about the accessible data table are
deliberately geometry rather than presence — rendered height, rows inside the visual root —
because that table was present in the DOM throughout the period it rendered at zero height and
its screenshots shipped showing nothing. See
[`scripts/screenshot-assertions.cjs`](scripts/screenshot-assertions.cjs).

CI runs `npm run screenshots:check`, which captures and asserts every scene without touching
`assets/screenshots`, so a scene that stops rendering fails the build while the runner's font
stack cannot churn the committed images.

Capture-time assertions prove a file was right *when written*, and are then gone. So a publish
run also records what it measured, and the SHA-256 of every image it wrote, into the committed
[`assets/screenshot-manifest.json`](assets/screenshot-manifest.json). Both
`npm run screenshots:check` and `npm run publication-audit` re-hash the committed PNGs against
that record, which catches a screenshot being hand-edited, reverted or swapped without the
capture that vouches for it being re-run, and rejects a committed screenshot that no scene
vouches for at all. This is a hash comparison, not a pixel diff, so it is dependency-free and
cannot flake on Chrome versions, font availability or rasteriser changes. The recorded values
are the measured numbers rather than a pass flag, because `tableVisibleHeight: 180` next to
`at least 120` is reviewable months later and "assertions passed" is not.

That answers "did this screenshot change since it was captured?" but not "is it still
current?" — and the latter is the question this repository actually got wrong, since the
zero-height table shipped in screenshots that were internally consistent and merely out of
date. So the manifest also records the SHA-256 of the packaged `.pbiviz` the images were
rendered from, and `npm run certification-audit` re-checks it against the artifact it just
packaged. A visual rebuilt without re-capturing its screenshots fails the build, naming both
hashes. Every other field the manifest records — the visual name, version and GUID, the tile
size, the bundle filename, its resource origin and its JS and CSS byte counts, and the scene
list with its captions — is compared the same way, because a recorded value nothing checks is
decoration, and decoration shaped like verification is worse than nothing.
`tests/screenshot-manifest.test.ts` drives that comparison with deliberately stale and
doctored manifests rather than only with one that already happens to be correct.

Each scene hash pins the committed bytes its assertions were applied to. It is deliberately not
a comparison against a freshly rendered image, and the reason is not that re-rendering is
unreliable — `npm run screenshots:determinism` measures 1 distinct hash over 5 captures per
scene here, under every browser flag configuration tried. The reason is that different operating
systems, browser builds, and font stacks can produce different PNG bytes for the same correct
scene. Bit-reproducibility is content- and build-dependent — sibling repos measure otherwise — so
it is measured per repo rather than assumed, and nothing in the pipeline relies on it. The
manifest note recording all of this is
itself asserted, so it cannot be quietly rewritten into a licence for golden-image diffing.

`npm run generate-sample-report` writes the offline AppSource sample report to
[`samples/AtlynScatterSample/`](samples/AtlynScatterSample) as a Power BI project (PBIP): PBIR
report JSON plus a TMDL semantic model whose single table is a DAX `DATATABLE(...)` calculated
table, so the model declares no data source at all, with the built visual embedded under
`CustomVisuals/` so nothing is fetched from the AppSource store. See
[`samples/README.md`](samples/README.md) for the one-time Power BI Desktop "Save as .pbix" step.
No `.pbix` is committed.

## AppSource licensing

The AppSource listing is **Free**. Monetisation happens only through the Atlyn storefront
subscription at <https://atlyn.io> and is entirely separate from Microsoft AppSource; the visual
itself performs no licence checks and makes no network requests. Do not configure a paid or
transactable Partner Center offer. See
[`docs/partner-center-submission.md`](docs/partner-center-submission.md) for the full field list.

The categorical data window is bounded at 10,000 rows. The visual does not request more data
from a segmented host response: it computes thresholds, quadrant counts, and regression over all
rows received, renders the bounded sample, and discloses received, analyzed, and rendered counts
when the host provides a reduced or partial segment. Non-finite X/Y rows are excluded; coincident
points and zero-variance regression inputs remain safe and are reported as unavailable where
appropriate. Series and category display order is deterministic, and selection identities retain
the host's category-plus-series composite key.

Selection, context menus, and tooltips are disabled when the host sets `allowInteractions` to
false. Pointer, keyboard, and touch interactions are delegated from the SVG root so a 10,000-point
render does not register a listener per point. Focus is restored by identity after rerenders, and
rendering events emit one success or failure result for each update.

This repository does not claim Microsoft certification or real Power BI host validation.
