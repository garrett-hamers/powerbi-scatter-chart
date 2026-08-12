# Changelog

## Unreleased

- Prepared `1.0.4.0` as the right-click context-menu certification remediation. Data-point and
  empty-space context menus now use the documented `selectionManager.showContextMenu(selectionId,
  { x, y })` contract, with `{}` for empty space, one delegated handler, and a gesture guard that
  prevents a touch long-press from invoking the host again when the browser emits `contextmenu`.
  The package also pins the audited `nanoid` transitive dependency to `3.3.17`, and all generated
  sample and screenshot provenance is regenerated from this exact bundle.
- Completed the native Desktop sample release: `AtlynScatterSample.1.0.4.pbix` was saved,
  closed, reopened from the deterministic release path, and revalidated for rendered data and both
  right-click modes. Its native evidence is kept under `dist/release/desktop-validation/`.
- Prepared `1.0.2.0` as the certification candidate. Packaging now runs
  `pbiviz package --certification-audit`, which verifies the compiled bundle contains no external
  requests. Because that mode changes the compiled bytes, the version was bumped instead of
  overwriting the immutable `1.0.1.0` artifact. Added Microsoft's required `npm run eslint`
  entry point, aligned the project and lockfile metadata, and pinned CI to Node 20.20.2.
- Extracted the layout probe's containment predicate into `isExemptingAncestor` in
  `scripts/layout-rules.cjs`, and made the probe inject that exact function into the page
  instead of carrying its own copy. Two properties decide whether the instrument can see
  anything at all, and neither was protected: the visual root must never exempt its own
  descendants — a sibling repo's probe treated any `overflow: auto` ancestor as containment
  while its root declared exactly that, so no escape could ever be reported and nearly half
  its defects were invisible to the tool built to find them — and an exemption must be proven
  by geometry rather than by the declared property, because `overflow` is inert on a
  `display: table` box that reports `auto` from `getComputedStyle` and never becomes a scroll
  container. This probe already had both, verified by measurement rather than by reading: with
  the root switched to `overflow: auto` and chrome truncation disabled it still reported the
  211.16px horizontal escape at 398x298 and 163.44px at 258x198, through both detection paths.
  But "already correct" is not "cannot regress", and simplifying that ancestor walk to include
  the root would have silently turned every scenario green. The predicate is now a pure
  function driven by `tests/layout-rules.test.ts` with a scrolling root, an inert `display:
  table` box, an ancestor that has itself escaped the root, and the serialised form the probe
  injects. The packaged artifact is unaffected: `atlynScatter.1.0.1.0.pbiviz` is still 17,492
  bytes, sha256 `f77138f49d20c0d3ad4e6d501845bd513d9ee9136290093acd58941f8e6f534f`.
- Added a reference-resolution gate for the sample report. Two sibling repos' sample reports
  would not open in Power BI Desktop because `report.json` declared a `SharedResources`
  resource package pointing at `BaseThemes/CY24SU10.json` — a file that exists nowhere in
  `samples/`, because CY24SU10 is a base theme built into Desktop. Naming it under
  `themeCollection` is a reference to something the product already has; declaring it under
  `resourcePackages` claims the file ships inside the report, so Desktop resolves the path,
  finds nothing, and refuses to open with "Issues were found". Every sample JSON file in that
  investigation validated against its declared `$schema` before *and* after the fix: a schema
  constrains shape, not existence, so a path to a missing file is perfectly schema-valid.
  This visual's sample report was the control that proved the diagnosis — it has the
  byte-identical `themeCollection` block, no `SharedResources` package, and is the one sample
  confirmed to open in Desktop — but nothing here *enforced* that. Injecting the defect into
  `report.json` passed the whole suite, `publication-audit` and `certification-audit`, because
  every existing check looked only at the one `CustomVisual` package it expected and never
  iterated the rest. `npm run publication-audit` now resolves every path the report definition
  claims to ship against disk, rejects a base theme declared as a shipped file, and reports an
  unrecognised package type rather than passing over it. The rule lives in
  `scripts/report-references.cjs` as a pure function so `tests/report-references.test.ts` can
  drive it with deliberately broken definitions.
- Bound the listing screenshots to the build that rendered them. The screenshot manifest added
  alongside the capture-time assertions recorded `capture.bundleSha256` and then nothing ever
  read it — a recorded value with nothing comparing it to reality, which is the same defect the
  manifest was built to fix. The manifest could therefore detect a screenshot changing without
  its capture being re-run, but not the visual changing without the screenshots being
  re-captured, and the latter is what actually shipped here: `showSemanticTable` defaults to
  true, the accessible table rendered at 0px visible height, and the submission screenshots were
  captured from that build and committed showing no table. Those images were internally
  consistent and merely out of date, so every gate passed them. `npm run certification-audit`
  now compares the recorded bundle hash against the `.pbiviz` it has just packaged and fails,
  naming both hashes, when the screenshots predate the current visual. Proven by reproducing the
  original scenario — flipping `showSemanticTable` to false, repackaging, and not re-capturing —
  which the audit rejected. Notably `bundleJsBytes` did **not** move for that edit, so the hash
  is the check that decides.
- Asserted every other value the manifest records, since decoration shaped like verification is
  worse than nothing: the visual name, version and GUID, the tile size, the bundle filename, its
  resource origin, its JS and CSS byte counts, `generatedBy`, and the scene list with its
  captions, so a scene re-described or added without being re-captured is rejected too. The
  comparison is a pure function driven by `tests/screenshot-manifest.test.ts` with deliberately
  stale and doctored manifests rather than only with one that already happens to be correct.
  Only the manifest's prose `note` is now unasserted.
- Measured the friction before committing to the gate: changing a string the en-US screenshots
  never render moved the bundle hash, and one `npm run screenshots` reproduced all three PNGs
  byte-for-byte, updating only `bundleSha256` and `bundleJsBytes`. A bundle change that does not
  alter rendering therefore costs one re-capture and no image churn. The packaged artifact is
  unchanged at 17,492 bytes, sha256
  `f77138f49d20c0d3ad4e6d501845bd513d9ee9136290093acd58941f8e6f534f`.
- Corrected what the manifest claims about re-capture, and asserted the note that carries it.
  The note said "re-capturing on the same platform reproduces these bytes exactly", which is a
  claim about rasteriser behaviour sitting inside a file built to stop unverified claims — and a
  sibling repo measured the opposite on its own screenshots, with 6-15 pixels of 1,049,088
  differing intermittently between identical runs. Measured here rather than reasoned about, via
  the new `npm run screenshots:determinism`: **every scene produced 1 distinct hash over 5
  captures, under all 5 browser flag configurations tried**, each capture a fresh browser process
  with a fresh profile. So the claim holds for this repository. It is still not something the
  pipeline may lean on — sibling repos measure differently, so bit-reproducibility is
  content- and build-dependent and has to be measured per repo rather than assumed in either
  direction.
- Fixed the *reasoning* the note gives, which matters more than the result. "Re-rendering is
  unreliable" would have been a bad justification for pinning committed bytes, because it is
  false on this machine, so a future reader who re-measured could reasonably delete the warning
  and turn the scene hashes into a golden-image comparison. The note now gives the reason that
  survives the measurement landing either way: CI runs a different operating system, browser
  build and font stack, so comparing a fresh render against these hashes would be comparing
  across an axis nobody controls. The Linux runner already captures scene 01 at 89,557 bytes
  where the committed Windows capture is 66,320. `tests/screenshot-manifest.test.ts` asserts the
  committed note still carries that reasoning, not merely that it is self-consistent.
- Added `scripts/screenshot-determinism-probe.cjs` so the measurement behind that claim can be
  repeated rather than taken on trust. It captures each scene N times per flag configuration
  with a fresh browser and profile every time and reports **distinct hashes over N** rather than
  pass/fail, because one identical pair proves nothing when the jitter it looks for is
  intermittent by nature. It also separates two effects that are easy to conflate: dropping
  `--disable-gpu` changed all three image hashes while remaining perfectly reproducible, so a
  flag can change *what is drawn* without affecting *whether it reproduces*. `--font-render-hinting`
  and `--force-color-profile` turned out to change neither on this content. The probe is a
  diagnostic and is deliberately not wired into CI: nothing in the pipeline depends on renders
  being reproducible.

- Added capture-time content assertions to the listing screenshots, so a screenshot cannot be
  written unless the scene it claims to show actually rendered. Generation previously validated
  only that the output was a 1366x768 PNG under the 1024 KB cap, which are properties of the
  *file* and say nothing about the *scene*: the committed images were captured while the
  accessible data table laid out at zero visible height, shipped showing no table at all, and
  passed every check on the way out. No static property of a PNG separates a correct render from
  a wrong-but-plausible one, so `scripts/generate-screenshots.cjs` now takes the screenshot and
  probes the very frame that was photographed in a single Chromium run, and stages the PNG in
  `.tmp/` until the scene's own expectations pass. Each scene declares its own: scene 01 requires
  4 shaded quadrants, 2 median guides, a regression line and size-varied bubbles with no legend;
  scene 02 requires exactly 4 legend chips naming the 4 regions and >= 4 distinct marker fills;
  scene 03 requires threshold labels reading `threshold 30` / `threshold 10`, provenance text
  naming both benchmarks, and >= 20 data labels, so it fails on missing thresholds even when all
  26 points plot correctly. Every scene asserts the accessible table by **geometry** rather than
  presence — >= 120px rendered and visible height, >= 4 rows inside its clipped viewport, no part
  of the band escaping the visual root — because the table was in the DOM the entire time it was
  invisible and `querySelector` would have found it throughout. A failing scene also deletes any
  stale image already published for it rather than leaving one in place looking current. CI runs
  the same capture and assertions through `npm run screenshots:check`, which never touches
  `assets/screenshots`. Re-capturing with the assertions active reproduced all three committed
  screenshots byte-for-byte.
- Recorded the capture-time assertions in a committed `assets/screenshot-manifest.json` and had
  the audits verify the committed images against it. The assertions above prove a screenshot was
  right *when written*, then vanish into stdout, so nothing tied a committed PNG back to the run
  that vouched for it and a file that was hand-edited, reverted or swapped afterwards still
  passed every remaining gate. Capture now records, per scene, each expectation next to the value
  that satisfied it — `tableVisibleHeight`, `at least 120`, measured `180` — plus the SHA-256 of
  the image it wrote, and both `npm run screenshots:check` and `npm run publication-audit`
  re-hash the committed files against that record. An unvouched screenshot, a missing manifest
  and a hollow record with no measured values are rejected too. The measured numbers are recorded
  rather than a pass flag because they stay reviewable months later. This is a SHA-256 comparison
  of a file against its own recorded hash, not a pixel diff, so it is dependency-free and cannot
  flake on Chrome versions, font availability or rasteriser changes. The packaged artifact is
  unaffected: `atlynScatter.1.0.1.0.pbiviz` is still 17,492 bytes,
  sha256 `f77138f49d20c0d3ad4e6d501845bd513d9ee9136290093acd58941f8e6f534f`.
- Extended `npm run layout-probe` to force overflow and scroll, because measuring only at
  rest hides a whole class of CSS bug. A sibling repo's probe reported "no latent bugs" from
  a fixture whose content happened to fit (`scrollHeight 1114 === clientHeight 1114`), so
  nothing scrolled, `position: sticky` never engaged, and three real defects stayed invisible.
  The probe now runs deliberately overflowing fixtures (320 categories, up to 12 series),
  scrolls every scrollable region to its top, midpoint and maximum, and re-measures at each
  offset. A region declared scrollable must prove it is genuinely scrolling and must still be
  present in the measurements, so the run fails loudly if a fixture stops overflowing instead
  of passing on a vacuous assertion.
- Added explicit positioning checks. Every element whose computed `position` is not `static`
  is resolved to the ancestor establishing its containing block, and the probe flags an
  absolutely positioned element with no positioned ancestor (it resolves against the initial
  containing block and escapes the root's `overflow: hidden`), `position: fixed` outright,
  and `position: sticky` with no scrolling ancestor. Where sticky elements exist, their
  bounding-rect tops after a scroll must be strictly increasing and all distinct.
- **Measured result for this visual: clean.** Across 60 cases the probe measured 30 scrollable
  regions, all 30 genuinely scrolling, over 90 scroll passes reaching a maximum `scrollTop` of
  24,467px, with 0 violations at every offset. The root computes `position: relative`, so it
  establishes the containing block its descendants rely on. The only non-static element is the
  visually-hidden accessible table wrapper, whose containing block correctly resolves to
  `div.atlyn-scatter`. **The visual ships no `position: sticky` and no `position: fixed` at
  all**, so the sticky-collapse defect class cannot occur here; the rule is armed and unit
  tested against the sibling repo's measured numbers in case that ever changes.
- Added `tests/layout-rules.test.ts` and a `tests/layout.test.ts` invariant that the root must
  keep `position: relative` while absolutely positioned descendants exist, plus a guard that
  notices if sticky or fixed positioning is ever introduced. `npm run prove-regressions` now
  proves 12 fixes, and both new probe rules were additionally proven end to end by reverting
  the real stylesheet and re-running the probe against the repackaged bundle.

- Verified in **Power BI Desktop 2.150.2102.0** that the packaged `atlynScatter.1.0.1.0.pbiviz`
  actually loads. Desktop imported the file (`Import successful`), matched its GUID and version
  against the copy embedded in the sample report, listed **Atlyn Scatter** in the Visualizations
  pane with its 20x20 icon, rendered it with data, and applied the packaged stylesheet. The
  visual's `aria-label` reached the Windows accessibility tree as
  `Atlyn Scatter, 8 Received, 8 analyzed, 8 rendered points...`, and the visual ran inside
  Power BI's `Custom Visual Host` sandbox. Nothing before this had confirmed the artifact loads
  in the product rather than only in an offline harness.
- Added a container-shape gate to `npm run certification-audit`. A `.pbiviz` is a two-entry
  archive — `package.json` plus `resources/<GUID>.pbiviz.json` — and a sibling repo shipped a
  source-tree-shaped zip instead, which the host could never resolve. The audit now asserts the
  manifest exists, holds exactly one `sourceType: 5` resource whose `file` resolves to a real
  entry, that `metadata.pbivizjson.resourceId` matches `resources[0].resourceId`, that the GUID
  and version agree, and that no source-tree entries (`pbiviz.json`, `capabilities.json`,
  `visual.js`, `style/`, `assets/`, `stringResources/`) are present. The rule lives in
  `scripts/pbiviz-structure.cjs` as a pure function so `tests/package-structure.test.ts` can
  drive it with deliberately malformed archives instead of only with a package that already
  happens to be correct.
- Fixed the accessible point table rendering entirely outside the visual. `showSemanticTable`
  defaults to `true`, and the table was appended after an SVG with `height: 100%` inside an
  `overflow: hidden` root, so it stacked past the bottom edge. Measured on the packaged
  1.0.1.0 bundle, the table was 528px tall with **0px inside the visual at 1280x620**, 528px
  with 0px visible at 398x298, 813px with 0px visible at 258x198, and 918px with 0px visible
  at 178x138 — the shipped default hid the entire accessible data table at every tile size.
  The `max-height: 180px` and `overflow: auto` meant to contain it were declared on the
  `<table>` itself, and browsers ignore both on a `display: table` box, so no scroll
  container ever existed. The root is now a flex column in which every stacked region sets
  `min-height: 0`, the table lives in a real `overflow: auto` wrapper, and the chart is given
  an explicit pixel height so its `viewBox` stays 1:1. The table now measures 180px visible at
  1280x620, 101px at 398x298 and 67px at 258x198.
- Fixed SVG chrome marching out of the clipped viewport as the tile narrowed. The provenance
  and regression line measured 550px wide inside a 398px tile (211px clipped) and 550px inside
  an 80px tile (503px clipped); the quadrant-count summary measured 335px inside a 258px tile.
  Legend chips used a fixed 96px stride regardless of width, so at 258x198 three of four series
  sat entirely outside the visual. Chrome text is now trimmed to its measured available width
  with `getComputedTextLength()`, and legend chips are placed by measured width with a `+N`
  overflow marker.
- Added viewport size classes (`regular`, `narrow`, `short`, `micro`, surfaced as `data-size`
  on the root) that drop decorative chrome first. The verbose provenance line goes at narrow
  or short sizes; the quadrant counts, legend, quadrant labels, threshold labels, data labels
  and the disclosure line all go at micro sizes. The chart always survives, and the accessible
  point table stays in the accessibility tree at every size — below 200x170 it degrades to its
  screen-reader-only form rather than being silently clipped.
- Fixed right-to-left rendering. `direction: rtl` was set on the `<svg>` while every x
  coordinate already mirrored itself explicitly, so the two flips cancelled and pushed chrome
  out of the viewport — 656px of overflow at 1280x620 and 194px at 258x198 in an `ar-SA`
  locale. The SVG now stays in an LTR coordinate space; the HTML root keeps `dir` so the
  accessible table still reads right-to-left.
- Capped the marker radius against the surrounding margins so a focused point on the edge of
  the plot cannot push its 2px focus ring with 2px offset outside the clipped root on a small
  tile. Large tiles are unaffected.
- Added `npm run layout-probe`, which measures real `getBoundingClientRect()` geometry of the
  packaged bundle and packaged stylesheet across 8 scenarios and 5 viewports, including
  keyboard focus, selection, high contrast, RTL and reduced motion. Added
  `npm run prove-regressions`, which reverts each fix individually and requires the matching
  test to fail. Both run in CI.
- Extracted the layout policy to `src/layout.ts` so it can be asserted directly instead of by
  matching source text, and added `tests/layout.test.ts`.
- Re-captured the three AppSource listing screenshots, which predated the layout fix and did
  not show the accessible point table. They remain exactly 1366x768 and well under 1024 KB.

## 1.0.1.0

- Bumped the visual version from `1.0.0.0` to `1.0.1.0` (`package.json` `1.0.1`). The AppSource
  submission work below changed the packaged `.pbiviz` contents — a real `assets/icon.png`
  instead of the 1x1 placeholder, the stylesheet actually reaching the bundle, and corrected
  `pbiviz.json` metadata — so the built package no longer matches the `1.0.0.0` artifact already
  distributed from the Atlyn storefront. Two different files must never share one version, so
  **`1.0.1.0` supersedes the v1.0.0.0 storefront artifact** and is published at its own
  version-keyed path as `atlynScatter.1.0.1.0.pbiviz`. The GUID (`atlynScatter`) is unchanged.
- Fixed the packaged `.pbiviz` hash depending on the build machine's timezone.
  `scripts/normalize-pbiviz.cjs` built its "fixed" ZIP timestamp with `new Date(1980, 0, 1)`,
  which is local midnight, while JSZip encodes timestamps from a `Date`'s UTC getters. The same
  source therefore produced a different SHA-256 in every timezone offset from UTC — and an
  out-of-range pre-1980 DOS date east of UTC. The anchor is now `Date.UTC(1980, 0, 1)`, and
  `npm run reproducibility-audit` packages its two runs under `Etc/GMT+12` and `Etc/GMT-14` so
  the gate fails if the bytes ever become clock-dependent again. This matters because packages
  are published to immutable, version-keyed paths: one version must mean exactly one SHA-256,
  no matter who builds it.
- Added `.gitattributes` with `* text=auto eol=lf` so tracked text files are checked out with LF
  on every platform, and normalised the working tree to match. Git already stored LF, but a
  Windows checkout wrote CRLF, so `dist/release-manifest.json` recorded different sizes and
  SHA-256 values for the tracked text files it hashes than the Linux CI runner did — `EULA.md`
  as 4,072 bytes locally versus 3,982 in CI, and `docs/partner-center-submission.md` as 13,000
  versus 12,759. The same mismatch would have broken the `scripts/certification-audit.cjs`
  byte-comparison between the sample report's embedded visual resource and the freshly packaged
  one on any Windows checkout. PNGs are declared `binary` and are untouched.
- Made the Power BI Desktop "Save as .pbix" instructions conditional instead of absolute. The
  docs asserted "No refresh step is needed" as a guarantee about Desktop's runtime behaviour;
  they now tell the operator to confirm the visual renders with data, run
  **Home > Refresh > Schema and data** *only* if a table is empty or Desktop reports "Some of the
  tables have incomplete or no data", and to stop and investigate rather than enter anything if
  Desktop ever prompts for credentials — a prompt would mean the model had acquired a data source,
  which `npm run publication-audit` and `tests/sample-report.test.ts` forbid. Also fixed the
  release manifest's `pbixStatus`, which contradicted the docs by describing the refresh as
  mandatory.
- Added the offline AppSource sample report as a Power BI project at
  `samples/AtlynScatterSample/`, generated deterministically by
  `scripts/generate-sample-report.cjs`. It embeds the built visual under `CustomVisuals/` instead
  of using `publicCustomVisuals`, and defines its 32 rows as a DAX `DATATABLE(...)` calculated
  table, so the semantic model declares no data source, prompts for no credentials, and needs no
  refresh before the one-time Power BI Desktop "Save as .pbix".
- Recorded the AppSource listing as **Free** in `docs/partner-center-submission.md`, separate from
  the Atlyn storefront subscription at atlyn.io.
- Extracted the offline sample dataset to `scripts/sample-data.cjs` so the listing screenshots and
  the sample report always show the same numbers.
- Fixed the visual stylesheet never reaching the PBIVIZ: `src/visual.ts` now imports
  `style/visual.less`, so `content.css` ships in the package and the Segoe UI typography,
  overflow clipping, focus outlines, reduced-motion rules, and the visually-hidden accessible
  point table all apply at runtime.
- Replaced the 1x1 placeholder `assets/icon.png` with a real 20x20 quadrant-scatter icon and
  added the 300x300 Partner Center logo, both produced by the deterministic dependency-free
  `scripts/generate-brand-assets.cjs`.
- Added three AppSource listing screenshots at exactly 1366x768, captured from the actual built
  visual by `scripts/generate-screenshots.cjs`.
- Corrected AppSource submission metadata: author email `atlyn.help@gmail.com` (the previous
  `support@atlyn.example` used an RFC 2606 reserved domain), support URL
  `https://atlyn.io/contact`, and a fuller listing description.
- Added `EULA.md` and `docs/partner-center-submission.md`.
- Extended `npm run publication-audit`, `npm run certification-audit`, the release manifest, and
  the release-contract tests to enforce every mechanical AppSource requirement.

## 1.0.0

- Initial Atlyn Scatter release.
- Added bounded 10,000-row rendering, deterministic selection identities, host tooltip and context-menu lifecycle handling, accessible keyboard navigation, and localized numeric formatting.
