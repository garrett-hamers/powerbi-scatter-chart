# Atlyn Scatter sample report

`AtlynScatterSample/` is the offline sample report that Microsoft Partner Center requires for an
AppSource submission. It is committed as a **Power BI project (PBIP)** rather than a `.pbix`.

## Why PBIP and not .pbix

A `.pbix` cannot be produced without Power BI Desktop:

- Its `DataModel` part is a binary Analysis Services backup image, so it cannot be authored as text.
- `pbi-tools` is not a workaround. Version 1.2.0 was tested against the installed Power BI Desktop
  2.150.2102.0 and `pbi-tools compile` **fails** with
  `System.MissingMethodException: Method not found: 'Void Microsoft.PowerBI.Packaging.PowerBIPackager.Save(...)'`.
  Its `extract` and `convert` commands work, but `compile` does not.

A PBIP is the same report expressed as plain text — PBIR JSON plus a TMDL semantic model. Power BI
Desktop opens it directly with no third-party tooling, it is reviewable in a pull request, and it is
regenerated deterministically by
[`scripts/generate-sample-report.cjs`](../scripts/generate-sample-report.cjs).

The native submission artifact is intentionally not source-controlled. Desktop validation has
exported and reopened `dist/release/AtlynScatterSample.1.0.4.pbix`; it is 169,860 bytes with
SHA-256 `1e5cfed64f631497895a168903cb3433024b60177caf4d68ce5988174739b1c2`. The pre-save and
reopened Playwright JSON/screenshots are kept under `dist/release/desktop-validation/`, and
`npm run release-manifest` records both the PBIX and evidence metadata.

## Desktop validation record

The native run materialised the calculated table without a refresh prompt. Both before-save and
reopened states reported 8 received, analyzed, and rendered points, the exact accessible table
rows, and one host context menu for a data-point right-click and one for an empty-space right-click.
The exact PBIX was closed and reopened from the deterministic release path; its bytes and hash
remained unchanged.

If Desktop ever prompts for credentials, something external has crept into the model: **stop and
investigate** rather than entering any. A credential prompt would mean the model had acquired a
data source, which `npm run publication-audit` and `tests/sample-report.test.ts` both forbid.

Upload the resulting `.pbix` to Partner Center. Keep it out of source control: it is a binary that
the deterministic generator cannot reproduce.

## What the report contains

| Page | Roles bound | Demonstrates |
| --- | --- | --- |
| 1 - Quadrant overview | Category, X, Y, Size | Median thresholds, quadrant shading and counts, least-squares trend line with equation and R-squared, size-encoded bubbles. |
| 2 - Series breakdown | Category, Series, X, Y, Size | Grouped series across four regions, legend, host-assigned per-series colours. |
| 3 - Benchmark thresholds | Category, X, Y, Size | Benchmark threshold mode (X = 30, Y = 10) with category data labels turned on, persisted through the visual's own formatting objects. |

`ProductPerformance` holds 32 rows, one per product and region, with `Product`, `Region`,
`Gross margin %`, `Revenue growth %` and `Revenue`. They are the same numbers as the AppSource
listing screenshots in `assets/screenshots/`, because both generators read
[`scripts/sample-data.cjs`](../scripts/sample-data.cjs).

The percentage columns aggregate with **Average**, not Sum: the model grain is one row per product
and region, so summing a rate across regions would misreport every product on the pages that do
not bind Series. `Revenue` aggregates with Sum.

## Offline guarantees

- The visual is embedded at `AtlynScatterSample.Report/CustomVisuals/atlynScatter/`, referenced by
  a `CustomVisual` resource package. `publicCustomVisuals` is deliberately **not** used, because it
  resolves the visual from the AppSource store and would break offline rendering.
- The semantic model declares **no data source and no shared expression**. The single table is a
  DAX `DATATABLE(...)` calculated table, confirmed by the Analysis Services TMDL parser reporting
  `dataSources=0`, `expressions=0`, and a `Calculated` partition.

Both properties are enforced by `npm run publication-audit` and `tests/sample-report.test.ts`.

## Regenerating

```text
npm run package
npm run generate-sample-report
```

The generator rewrites the whole project from `pbiviz.json`, `capabilities.json` and the freshly
built `dist/*.pbiviz`, using fixed identifiers so the output is byte-for-byte stable.
`npm run certification-audit` byte-compares the embedded visual against the package it just built,
so the copy here can never go stale.
