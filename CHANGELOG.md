# Changelog

## Unreleased

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

