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
npm run lint:full
npm run build
npm run package
npm run reproducibility-audit
npm run certification-audit
npm run publication-audit
npm run audit
```

`npm run certification-audit` starts from a clean output directory, runs the complete automated
release gate, including two clean package runs with byte-for-byte and SHA-256 equality. The
generated package is written to `dist/atlynScatter.1.0.0.0.pbiviz`. Packaging normalizes ZIP
entry order, timestamps, permissions, and compression before an atomic replacement. Package
metadata is sourced from `pbiviz.json` and `capabilities.json`; stale PBIVIZ files are rejected.
`npm run release-manifest` writes `dist/release-manifest.json` with the source commit, exact
package filename, byte size, and SHA-256. The release manifest is the immutable-artifact record:
never overwrite a package or manifest at an existing versioned location.

`npm run publication-audit` verifies publication image assets: `assets/icon.png` must be a real
non-placeholder source icon and `assets/partner-center-logo-300x300.png` must be a valid 300x300
PNG for Partner Center submission.

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
