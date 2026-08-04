# Changelog

## 1.0.1.0

AppSource submission release. **Supersedes the 1.0.0.0 artifact**: replacing the placeholder icon
and shipping the stylesheet changed the packaged `.pbiviz` bytes, and the Atlyn storefront serves
the artifact from a version-keyed Blob path, so the same version number could not be reused. The
visual GUID is unchanged and remains `atlynScatter`.

- Replaced the **1x1 placeholder** `assets/icon.png` with a real **20x20** quadrant-scatter icon,
  and added the **300x300** Partner Center listing logo. Both are produced by the deterministic,
  dependency-free `scripts/generate-brand-assets.cjs`, and `npm run publication-audit` re-runs the
  generator in memory and compares decoded pixels so the committed images cannot drift.
- Fixed the visual stylesheet never reaching the PBIVIZ: `src/visual.ts` now imports
  `style/visual.less`, so `content.css` ships in the package and the Segoe UI typography, overflow
  clipping, focus outlines, reduced-motion rules, and the visually-hidden accessible point table
  all apply at runtime.
- Added three AppSource listing screenshots at exactly 1366x768, captured from the actual built
  visual by `scripts/generate-screenshots.cjs`.
- Added the offline AppSource sample report as a Power BI project at
  `samples/AtlynScatterSample/`, generated deterministically by
  `scripts/generate-sample-report.cjs`. It embeds the built visual under `CustomVisuals/` instead
  of using `publicCustomVisuals`, and defines its 32 rows as a DAX `DATATABLE(...)` calculated
  table, so the semantic model declares no data source, prompts for no credentials, and needs no
  refresh before the one-time Power BI Desktop "Save as .pbix".
- Corrected AppSource submission metadata: author email `atlyn.help@gmail.com` (the previous
  `support@atlyn.example` used an RFC 2606 reserved domain), support URL
  `https://atlyn.io/contact`, and a fuller listing description.
- Recorded the AppSource listing as **Free** in `docs/partner-center-submission.md`, separate from
  the Atlyn storefront subscription at atlyn.io.
- Extracted the offline sample dataset to `scripts/sample-data.cjs` so the listing screenshots and
  the sample report always show the same numbers.
- Added `EULA.md` and `docs/partner-center-submission.md`.
- Extended `npm run publication-audit`, `npm run certification-audit`, the release manifest, and
  the release-contract tests to enforce every mechanical AppSource requirement.

## 1.0.0

- Initial Atlyn Scatter release.
- Added bounded 10,000-row rendering, deterministic selection identities, host tooltip and context-menu lifecycle handling, accessible keyboard navigation, and localized numeric formatting.

