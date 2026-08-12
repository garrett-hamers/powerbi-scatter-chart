# Partner Center submission dossier — Atlyn Scatter

This document records the concrete, final value of every field required to submit **Atlyn
Scatter** to Microsoft AppSource through Partner Center, and the exact manual submission steps
that remain.

Requirements are taken from
[Publish Power BI visuals to Partner Center](https://learn.microsoft.com/en-us/power-bi/developer/visuals/office-store)
and [Get your Power BI visuals certified](https://learn.microsoft.com/en-us/power-bi/developer/visuals/power-bi-custom-visuals-certified).

> This repository makes **no claim** of Microsoft certification, AppSource listing status, or
> Partner Center approval. Nothing below has been submitted yet.

## Certification remediation provenance

The existing Partner Center offer is `1643e03c-3a1e-4079-b0b9-cf51c5cde401`. Repository history for
the prior draft recorded a stale `1.0.1.0` package and a proposed `1.0.3.0` replacement. The
right-click remediation is deliberately versioned as **`1.0.4.0`** so corrected PBIVIZ bytes are
not substituted under a previously submitted or reviewed version. The active certification report
policy is **1180.2.5 - Right Click Context Menu**. Desktop validation is complete; do not submit
from this repository until the owner completes the remaining Partner Center steps.

## 1. Requirement checklist

| Requirement | Required | Status | Where it lives |
| --- | --- | --- | --- |
| Pbiviz package with complete metadata | Yes | Ready | `pbiviz.json`, built to `dist/atlynScatter.1.0.4.0.pbiviz` |
| Sample report file (offline) | Yes | Ready as PBIP plus reopened Public Desktop export | `samples/AtlynScatterSample/`, native file at `dist/release/AtlynScatterSample.1.0.4.pbix` |
| Logo, PNG, exactly 300 x 300 | Yes | Ready | `assets/partner-center-logo-300x300.png` |
| Screenshots, PNG, 1–5, exactly 1366 x 768, <= 1024 KB | Yes | Ready (3 provided) | `assets/screenshots/` |
| Support URL (`https://`) | Yes | Ready | `https://atlyn.io/contact` |
| Privacy policy URL (`https://`) | Yes | Ready | `https://atlyn.io/legal/privacy` |
| EULA | Yes | Ready | `EULA.md` |
| Pricing / licensing model | Yes | Decided: **Free** | [Section 6](#6-licensing-and-pricing) |
| Video link | No | Not provided | — |

Everything marked "Ready" is verified deterministically by `npm run publication-audit` and by
`tests/release-contract.test.ts` and `tests/sample-report.test.ts`.

Certification packaging uses `pbiviz package --certification-audit` from
`powerbi-visuals-tools` 7.2.1. The repository also exposes Microsoft's required
`npm run eslint` command, pins CI to Node 20.20.2 (the current tools require Node 20.19 or newer),
and keeps the lowercase `certification` branch immutable until the matching package is submitted.

## 2. Pbiviz package metadata

Source of truth: [`pbiviz.json`](../pbiviz.json).

| Partner Center / pbiviz field | Final value |
| --- | --- |
| Visual name (`visual.name`) | `atlynScatter` |
| Display name (`visual.displayName`) | `Atlyn Scatter` |
| **GUID** (`visual.guid`) | `atlynScatter` — **never change this.** It is already recorded in the owner's storefront release manifest and download paths. Use Power BI Desktop developer mode to test new builds. |
| Version (`visual.version`) | `1.0.4.0` (four digits, kept equal to `<package.json version>.0`) |
| Visual class (`visual.visualClassName`) | `Visual` |
| API version (`apiVersion`) | `5.11.0` |
| Description (`visual.description`) | "Turn any two measures into an explainable quadrant scatter chart: choose median, mean, zero, fixed, or benchmark thresholds, show a least-squares trend line with its equation and R-squared, size and colour bubbles by additional measures, and keep every point reachable by keyboard and screen reader." |
| Support URL (`visual.supportUrl`) | `https://atlyn.io/contact` |
| GitHub URL (`visual.gitHubUrl`) | `https://github.com/garrett-hamers/powerbi-scatter-chart` |
| Author name (`author.name`) | `Atlyn` |
| Author email (`author.email`) | `atlyn.help@gmail.com` |
| Privileges (`capabilities.json`) | `[]` — no `WebAccess`, `ExportContent`, or `LocalStorage` |
| External dependencies (`dependencies`) | `null` |

Package filename: `atlynScatter.1.0.4.0.pbiviz`, produced by `npm run package` into `dist/`.
The build is byte-reproducible; `npm run release-manifest` writes `dist/release-manifest.json`
with the source commit, package SHA-256, and the SHA-256 of every listing asset.

Version `1.0.4.0` supersedes the prior `1.0.3.0` remediation candidate. The right-click behavior
and the audited dependency change the compiled bundle, so the version is bumped rather than
republishing different bytes under an existing version. Never overwrite a package at an existing
versioned location.

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

1. reads the actual bundled JavaScript and compiled CSS out of `dist/atlynScatter.1.0.4.0.pbiviz`;
2. loads it in a self-contained HTML page with a mock `IVisualHost` and a hard-coded, fully
   offline categorical `DataView` (no network access, no randomness);
3. captures the page with headless Microsoft Edge / Google Chrome at exactly 1366 x 768, and in
   the same browser run probes the frame that was photographed;
4. checks that frame against the scene's own declared expectations and only then publishes the
   PNG into `assets/screenshots/`;
5. records the values it measured, the SHA-256 of every image it wrote, and the SHA-256 of the
   packaged bundle those images were rendered from, into the committed
   [`assets/screenshot-manifest.json`](../assets/screenshot-manifest.json).

```text
npm run package
npm run screenshots
```

The script fails loudly if no Chromium-based browser is available. It never fabricates images.

A 1366 x 768 PNG under 1024 KB can still be a picture of the wrong thing: these listing images
were once captured while the accessible data table laid out at zero visible height, and they
shipped showing no table because nothing checked content. Step 4 closes that gap. Each scene
below carries per-scene assertions, so scene 3 fails if the benchmark thresholds are missing
even when all 26 points plot correctly, and every scene fails if the accessible table is not
measurably visible inside the visual root. A failing scene is never written, and any stale
image already published for it is removed. CI runs the same capture and assertions via
`npm run screenshots:check`, which leaves `assets/screenshots/` untouched.

| Screenshot | What it shows | Asserted at capture |
| --- | --- | --- |
| `01-quadrant-overview.png` | Default median thresholds, quadrant shading with counts, OLS trend line with equation and R-squared, size-encoded bubbles, threshold provenance line. | 26 points fully inside the root, 4 shaded quadrants + 4 hatch overlays covering >= 30% of the tile, 4 quadrant labels, 2 median guides, 1 regression line, median provenance text, no legend, no data labels, >= 10 distinct bubble radii. |
| `02-series-and-size.png` | Grouped series (four regions) with legend, host-assigned per-series colours, and size-encoded bubbles. | 32 points fully inside the root, exactly 4 legend chips naming the 4 regions, >= 4 distinct marker fills, >= 10 distinct radii, quadrants, guides and regression line as above. |
| `03-benchmark-thresholds.png` | Explicit benchmark thresholds (X = 30, Y = 10) with category data labels enabled. | Threshold labels reading exactly `threshold 30` / `threshold 10`, provenance text naming both benchmarks, >= 20 category data labels, 26 points, quadrants, guides and regression line as above. |

Every scene additionally asserts the accessible data table by geometry: >= 120px rendered and
visible height inside the root, >= 4 rows actually inside its clipped viewport, one row per
data point, 5 header cells, the caption, no part of the band escaping the visual root, and no
element escaping the root at all.

Those assertions would otherwise be ephemeral, so step 5 makes them durable. The manifest
records, per scene, each expectation alongside the value that satisfied it — for example
`tableVisibleHeight`, `at least 120`, measured `180` — plus the SHA-256 of the PNG the run
wrote. `npm run publication-audit` re-hashes the committed images against that record, so a
screenshot that is hand-edited, reverted or swapped after capture is rejected, as is a
committed screenshot no scene vouches for. Capture-time assertions prove an image was right
when written; the manifest is what still proves it afterwards. It is a hash comparison rather
than a pixel diff, so nothing here can flake on Chrome versions, font availability or
rasteriser changes.

The manifest also records the SHA-256 of the packaged `.pbiviz` the images were rendered from,
and `npm run certification-audit` compares it against the artifact it has just packaged. This
is the check that would have caught the zero-height accessible table: those screenshots were
internally consistent and simply older than the visual, so every gate passed them. A visual
rebuilt without re-capturing its screenshots now fails the build, naming both hashes and the
fix. Re-capture is cheap — a bundle change that does not alter rendering reproduces all three
PNGs byte-for-byte and moves only the recorded bundle hash.

The per-scene hashes pin the committed bytes the assertions were applied to, and are never
compared against a freshly rendered image. The reason is not that re-rendering is unreliable —
`npm run screenshots:determinism` measures 1 distinct hash over 5 captures per scene on this
machine, under every flag configuration tried. The reason is that rendering is platform-dependent:
different operating systems, browser builds, and font stacks can produce different PNG bytes for
the same correct scene. Comparing a fresh render against these hashes would therefore compare
across an axis nobody controls, which is the flaky golden-image diff this pipeline deliberately
avoids, so the audits re-hash the committed files instead.

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

## 6. Licensing and pricing

**AppSource listing: Free.**

| Partner Center field | Value |
| --- | --- |
| Pricing model | **Free** |
| Transactable offer | **No** — do not configure a paid or transactable offer |
| In-app purchase / licence key | None |

Atlyn Scatter is listed on AppSource at no charge and with no purchase, licence key, or trial
gate. Monetisation happens **only** through the Atlyn storefront subscription at
<https://atlyn.io>, which is billed through Stripe and is entirely separate from Microsoft
AppSource. Nothing in the visual checks for, enforces, or communicates with that subscription:
the visual declares `"privileges": []` and makes no network requests, which is verified by
`tests/forbidden-requests.test.ts`.

Practical consequences when filling in the offer:

- Choose the free pricing model. Do **not** enable "Sell through Microsoft" or any transactable
  or metered billing option.
- Do not add Microsoft-managed licence terms that imply a paid tier.
- The EULA in [`EULA.md`](../EULA.md) is MIT-based and grants free use, which matches a free
  listing. It intentionally says nothing about the Atlyn subscription.

## 7. Sample report

Partner Center requires a sample report that works offline with no external connections. It is
committed as a **Power BI project (PBIP)** at
[`samples/AtlynScatterSample/`](../samples/AtlynScatterSample). The corrected Public native submission export was saved and reopened after Desktop validation at
`dist/release/AtlynScatterSample.1.0.4.pbix`. It is 42,057 bytes with SHA-256
`6e564a620580ac52f459f1594b822c7bfa6d0d02c5c8719ec127fa5752c27931`.

A `.pbix` cannot be produced headlessly. Its `DataModel` part is a binary Analysis Services backup
image, and `pbi-tools` is not a workaround: version 1.2.0 was tested against the installed Power BI
Desktop and `pbi-tools compile` fails with
`System.MissingMethodException: Method not found: 'Void Microsoft.PowerBI.Packaging.PowerBIPackager.Save(...)'`.
The PBIP holds the identical report as plain text — PBIR JSON plus a TMDL semantic model — and
Power BI Desktop opens it directly with no third-party tooling. The release manifest records the
PBIX and native evidence metadata under `dist/release/desktop-validation/`.

### Offline guarantees

- The visual is embedded at `AtlynScatterSample.Report/CustomVisuals/atlynScatter/` and referenced
  through a `CustomVisual` resource package. `publicCustomVisuals` is deliberately **not** used
  because it resolves the visual from the AppSource store, which would break offline rendering.
- The semantic model declares **no data source and no shared expression**. Its single table is a
  DAX `DATATABLE(...)` calculated table holding 32 rows, so there is nothing to connect to, no
  credential prompt, and no refresh dependency.

Both are enforced by `npm run publication-audit` and `tests/sample-report.test.ts`, and confirmed
by the Analysis Services TMDL parser reporting `dataSources=0`, `expressions=0`, and a `Calculated`
partition.

### Pages

| Page | Roles bound | Demonstrates |
| --- | --- | --- |
| 1 - Quadrant overview | Category, X, Y, Size | Median thresholds, quadrant shading and counts, trend line with equation and R-squared |
| 2 - Series breakdown | Category, Series, X, Y, Size | Grouped series, legend, host-assigned per-series colours |
| 3 - Benchmark thresholds | Category, X, Y, Size | Benchmark mode (X = 30, Y = 10) with data labels on |

### Completed Power BI Desktop validation

The reopened Public run materialised the calculated table without a refresh prompt and reported
8 received, analyzed, and rendered points with the exact accessible table rows. It also shows one
host context menu after a data-point right-click and one after an empty-space right-click. The
exact Public PBIX was reopened from `dist/release/AtlynScatterSample.1.0.4.pbix`; its bytes and
SHA-256 remained unchanged. The corresponding JSON and screenshots are in
`dist/release/desktop-validation/reopened-public/`.

If Desktop ever prompts for credentials, something external has crept into the model: **stop and
investigate** rather than entering any. The model must declare no data source at all, which
`npm run publication-audit` and `tests/sample-report.test.ts` both enforce.

Optionally add a final "hints" page with a text box before saving; Microsoft lists it as a
suggestion, not a requirement.

## 8. Remaining manual, owner-controlled submission steps

These are not simulated here and have not been submitted.

1. **Enrol in Partner Center.** Complete or confirm the developer account at
   <https://partner.microsoft.com/dashboard>.
2. **Create the Power BI visual offer**, set the offer alias, and select the **Free** pricing
   model. Do not configure a transactable offer.
3. **Upload the package**: `dist/atlynScatter.1.0.4.0.pbiviz` (from a clean
   `npm run certification-audit` run).
4. **Upload the sample `.pbix`** from `dist/release/AtlynScatterSample.1.0.4.pbix`.
5. **Upload the logo**: `assets/partner-center-logo-300x300.png`.
6. **Upload the screenshots**: the three files in `assets/screenshots/`.
7. **Paste the listing URLs**: support `https://atlyn.io/contact`, privacy
   `https://atlyn.io/legal/privacy`.
8. **Attach the EULA**: upload `EULA.md` (or select Microsoft's standard contract).
9. **Run Microsoft's pre-submission tests** in
    [Testing submissions of Power BI custom visuals](https://learn.microsoft.com/en-us/power-bi/developer/visuals/submission-testing)
    against Power BI Desktop and the Power BI service.
10. **Submit for review.** Optionally tick *Request Power BI certification* afterwards; certification
    is a separate, slower process and must not be claimed until it is actually granted.

## 9. Pre-submission command sequence

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run build
npm run package
npm run generate-sample-report
npm run publication-audit
npm run certification-audit
npm run audit
npm run release-manifest
```

`npm run certification-audit` includes `npm run publication-audit`, so a green certification
audit means the pbiviz metadata, icon, logo, screenshots, sample report, EULA, and this dossier
all satisfy the mechanical AppSource requirements. It does **not** mean the visual has been
reviewed, listed, or certified by Microsoft.
