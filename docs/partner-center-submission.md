# Partner Center submission dossier — Atlyn Scatter

This document records the concrete, final value of every field required to submit **Atlyn
Scatter** to Microsoft AppSource through Partner Center, and the exact manual steps that remain.

Requirements are taken from
[Publish Power BI visuals to Partner Center](https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store)
and [Power BI visual project structure](https://learn.microsoft.com/en-us/power-bi/developer/visuals/visual-project-structure).

> This repository makes **no claim** of Microsoft certification, AppSource listing status, or
> Partner Center approval. Nothing below has been submitted yet.

## 1. Requirement checklist

| Requirement | Required | Status | Where it lives |
| --- | --- | --- | --- |
| Pbiviz package with complete metadata | Yes | Ready | `pbiviz.json`, built to `dist/atlynScatter.1.0.0.0.pbiviz` |
| Sample `.pbix` report file (offline) | Yes | **Outstanding — owner action** | Not in repo. See [section 6](#6-remaining-manual-owner-controlled-steps) |
| Logo, PNG, exactly 300 x 300 | Yes | Ready | `assets/partner-center-logo-300x300.png` |
| Screenshots, PNG, 1–5, exactly 1366 x 768, <= 1024 KB | Yes | Ready (3 provided) | `assets/screenshots/` |
| Support URL (`https://`) | Yes | Ready | `https://atlyn.io/contact` |
| Privacy policy URL (`https://`) | Yes | Ready | `https://atlyn.io/legal/privacy` |
| EULA | Yes | Ready | `EULA.md` |
| Video link | No | Not provided | — |

Everything marked "Ready" is verified deterministically by `npm run publication-audit` and by
`tests/release-contract.test.ts`.

## 2. Pbiviz package metadata

Source of truth: [`pbiviz.json`](../pbiviz.json).

| Partner Center / pbiviz field | Final value |
| --- | --- |
| Visual name (`visual.name`) | `atlynScatter` |
| Display name (`visual.displayName`) | `Atlyn Scatter` |
| **GUID** (`visual.guid`) | `atlynScatter` — **never change this.** It is already recorded in the owner's storefront release manifest and download paths. Use Power BI Desktop developer mode to test new builds. |
| Version (`visual.version`) | `1.0.0.0` (four digits, kept equal to `<package.json version>.0`) |
| Visual class (`visual.visualClassName`) | `Visual` |
| API version (`apiVersion`) | `5.11.0` |
| Description (`visual.description`) | "Turn any two measures into an explainable quadrant scatter chart: choose median, mean, zero, fixed, or benchmark thresholds, show a least-squares trend line with its equation and R-squared, size and colour bubbles by additional measures, and keep every point reachable by keyboard and screen reader." |
| Support URL (`visual.supportUrl`) | `https://atlyn.io/contact` |
| GitHub URL (`visual.gitHubUrl`) | `https://github.com/garrett-hamers/powerbi-scatter-chart` |
| Author name (`author.name`) | `Atlyn` |
| Author email (`author.email`) | `atlyn.help@gmail.com` |
| Privileges (`capabilities.json`) | `[]` — no `WebAccess`, `ExportContent`, or `LocalStorage` |
| External dependencies (`dependencies`) | `null` |

Package filename: `atlynScatter.1.0.0.0.pbiviz`, produced by `npm run package` into `dist/`.
The build is byte-reproducible; `npm run release-manifest` writes `dist/release-manifest.json`
with the source commit, package SHA-256, and the SHA-256 of every listing asset.

## 3. Listing assets

| Asset | Path | Dimensions | Constraint |
| --- | --- | --- | --- |
| Visual icon (Power BI visualisation pane) | `assets/icon.png` | 20 x 20 | PNG, exactly 20 x 20 |
| Partner Center logo | `assets/partner-center-logo-300x300.png` | 300 x 300 | PNG, exactly 300 x 300 |
| Screenshot 1 | `assets/screenshots/01-quadrant-overview.png` | 1366 x 768 | PNG, <= 1024 KB |
| Screenshot 2 | `assets/screenshots/02-series-and-size.png` | 1366 x 768 | PNG, <= 1024 KB |
| Screenshot 3 | `assets/screenshots/03-benchmark-thresholds.png` | 1366 x 768 | PNG, <= 1024 KB |

### How the assets are produced

Both brand assets are generated deterministically by
[`scripts/generate-brand-assets.cjs`](../scripts/generate-brand-assets.cjs) — a dependency-free
Node script that rasterises the quadrant-scatter mark with 4x supersampling and writes the PNG
by hand (`node:zlib` + CRC32). `npm run publication-audit` re-runs the generator in memory and
compares **decoded pixels** with the committed files, so the committed images cannot silently
drift from the generator.

```text
npm run generate-brand-assets
```

The screenshots are **real captures of the built visual**, not mock-ups. The pipeline in
[`scripts/generate-screenshots.cjs`](../scripts/generate-screenshots.cjs):

1. reads the actual bundled JavaScript and compiled CSS out of `dist/atlynScatter.1.0.0.0.pbiviz`;
2. loads it in a self-contained HTML page with a mock `IVisualHost` and a hard-coded, fully
   offline categorical `DataView` (no network access, no randomness);
3. captures the page with headless Microsoft Edge / Google Chrome at exactly 1366 x 768.

```text
npm run package
npm run screenshots
```

The script fails loudly if no Chromium-based browser is available. It never fabricates images.

| Screenshot | What it shows |
| --- | --- |
| `01-quadrant-overview.png` | Default median thresholds, quadrant shading with counts, OLS trend line with equation and R-squared, size-encoded bubbles, threshold provenance line. |
| `02-series-and-size.png` | Grouped series (four regions) with legend, host-assigned per-series colours, and size-encoded bubbles. |
| `03-benchmark-thresholds.png` | Explicit benchmark thresholds (X = 30, Y = 10) with category data labels enabled. |

## 4. Listing URLs

| Field | Value | Verified |
| --- | --- | --- |
| Support / contact | `https://atlyn.io/contact` | HTTP 200 |
| Privacy policy | `https://atlyn.io/legal/privacy` | HTTP 200 |
| Terms | `https://atlyn.io/legal/terms` | HTTP 200 |

Do **not** use `https://atlyn.io/privacy`, `https://atlyn.io/support`, or
`https://atlyn.io/terms` — all three return HTTP 404.

## 5. EULA

Use the repository's own EULA at [`EULA.md`](../EULA.md). It is MIT-based, matches the
`LICENSE` file shipped with the visual, and states the visual's no-network / no-data-collection
posture, which matches `"privileges": []` in `capabilities.json` and the automated
`tests/forbidden-requests.test.ts` gate.

Alternatively Microsoft's [standard contract](https://go.microsoft.com/fwlink/?linkid=2041178)
may be selected in Partner Center; if it is, `EULA.md` still applies to the source distribution.

## 6. Remaining manual, owner-controlled steps

These cannot be completed from this repository and are **not** simulated here.

1. **Author the sample `.pbix` report — blocking.** Partner Center requires a sample report that
   works fully offline with no external connections. Build it in Power BI Desktop:
   import `dist/atlynScatter.1.0.0.0.pbiviz`, bind a small embedded (Enter Data) table to
   Category / X / Y / Size / Series, add a page demonstrating each threshold mode, and add a
   final "hints" page. Save with the data embedded and confirm the file opens with networking
   disabled. This file is intentionally **not** committed and must not be fabricated.
2. **Enrol in Partner Center.** Complete or confirm the developer account at
   <https://partner.microsoft.com/dashboard>.
3. **Create the Power BI visual offer** and set the offer alias.
4. **Upload the package**: `dist/atlynScatter.1.0.0.0.pbiviz` (from a clean
   `npm run certification-audit` run).
5. **Upload the sample `.pbix`** from step 1.
6. **Upload the logo**: `assets/partner-center-logo-300x300.png`.
7. **Upload the screenshots**: the three files in `assets/screenshots/`.
8. **Paste the listing URLs**: support `https://atlyn.io/contact`, privacy
   `https://atlyn.io/legal/privacy`.
9. **Attach the EULA**: upload `EULA.md` (or select Microsoft's standard contract).
10. **Run Microsoft's pre-submission tests** in
    [Testing submissions of Power BI custom visuals](https://learn.microsoft.com/en-us/power-bi/developer/visuals/submission-testing)
    against Power BI Desktop and the Power BI service.
11. **Submit for review.** Optionally tick *Request Power BI certification* afterwards; certification
    is a separate, slower process and must not be claimed until it is actually granted.

## 7. Pre-submission command sequence

```text
npm ci
npm test
npm run typecheck
npm run lint:full
npm run build
npm run package
npm run publication-audit
npm run certification-audit
npm run audit
npm run release-manifest
```

`npm run certification-audit` includes `npm run publication-audit`, so a green certification
audit means the pbiviz metadata, icon, logo, screenshots, EULA, and this dossier all satisfy the
mechanical AppSource requirements. It does **not** mean the visual has been reviewed, listed, or
certified by Microsoft.
