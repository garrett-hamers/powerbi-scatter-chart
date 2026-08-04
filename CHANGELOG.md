# Changelog

## Unreleased

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

