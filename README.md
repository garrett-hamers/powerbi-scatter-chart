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
npm run lint
npm run package
npm audit
```

The generated package is written to `dist/atlynScatter.1.0.0.0.pbiviz`. Package metadata is
sourced from `pbiviz.json` and `capabilities.json`.

This repository does not claim Microsoft certification or real Power BI host validation.
