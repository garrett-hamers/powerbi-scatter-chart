# Changelog

## 1.0.1.0

- Bumped the visual version from `1.0.0.0` to `1.0.1.0` (`package.json` `1.0.1`). The AppSource
  submission work below changed the packaged `.pbiviz` contents — a real `assets/icon.png`
  instead of the 1x1 placeholder, the stylesheet actually reaching the bundle, and corrected
  `pbiviz.json` metadata — so the built package no longer matches the `1.0.0.0` artifact already
  distributed from the Atlyn storefront. Two different files must never share one version, so
  **`1.0.1.0` supersedes the v1.0.0.0 storefront artifact** and is published at its own
  version-keyed path as `atlynScatter.1.0.1.0.pbiviz`. The GUID (`atlynScatter`) is unchanged.
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

