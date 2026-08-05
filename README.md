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
release gate, including two clean package runs with byte-for-byte and SHA-256 equality. Those two
runs package under timezones on opposite sides of UTC (`Etc/GMT+12` and `Etc/GMT-14`), so a
build whose bytes depend on the builder's clock fails the gate. The generated package is written
to `dist/atlynScatter.1.0.1.0.pbiviz`. Packaging normalizes ZIP entry order, timestamps (to a
fixed UTC-anchored DOS timestamp), permissions, and compression before an atomic replacement.
Package metadata is sourced from `pbiviz.json` and `capabilities.json`; stale PBIVIZ files are
rejected. The audit also opens the generated package and asserts that the bundled script, the
compiled stylesheet, and a 20x20 PNG icon are all present. `npm run release-manifest` writes
`dist/release-manifest.json` with the source commit, exact package filename, byte size, SHA-256,
and the SHA-256 of every publication asset. The release manifest is the immutable-artifact
record: never overwrite a package or manifest at an existing versioned location.

## AppSource publication

[`docs/partner-center-submission.md`](docs/partner-center-submission.md) records the concrete
final value of every Microsoft Partner Center submission field, plus the manual steps that
remain. [`EULA.md`](EULA.md) is the end-user licence agreement for the AppSource listing.

`npm run publication-audit` (also run as part of `npm run certification-audit`) verifies the
submission surface deterministically:

- `assets/icon.png` is a valid PNG, exactly 20x20, and not a placeholder.
- `assets/partner-center-logo-300x300.png` is a valid PNG, exactly 300x300.
- both brand assets match a pixel-for-pixel regeneration by `scripts/generate-brand-assets.cjs`.
- `assets/screenshots/` holds 1 to 5 PNG files, each exactly 1366x768 and at most 1024 KB.
- the offline sample report in `samples/` embeds the visual under `CustomVisuals/`, avoids
  `publicCustomVisuals`, matches the current visual version, and defines its data as a DAX
  calculated table with no data source.
- `pbiviz.json` carries every required submission field, a four-part version, an `https://`
  support URL, and an author email that is not an RFC 2606 reserved domain.
- `EULA.md` and the submission dossier exist, and the dossier records the `https://` privacy
  policy URL.

Publication assets are regenerated with dependency-free scripts:

```text
npm run generate-brand-assets
npm run package && npm run screenshots
npm run package && npm run generate-sample-report
```

`npm run screenshots` renders the **actual built visual** from `dist/*.pbiviz` in headless
Microsoft Edge or Google Chrome against a mock host and hard-coded offline sample data, then
captures PNGs at exactly 1366x768. It requires a locally installed Chromium-based browser
(override the path with `ATLYN_BROWSER`) and fails loudly rather than producing placeholder
images. This step is local and on demand; CI only validates the committed PNGs.

`npm run generate-sample-report` writes the offline AppSource sample report to
[`samples/AtlynScatterSample/`](samples/AtlynScatterSample) as a Power BI project (PBIP): PBIR
report JSON plus a TMDL semantic model whose single table is a DAX `DATATABLE(...)` calculated
table, so the model declares no data source at all, with the built visual embedded under
`CustomVisuals/` so nothing is fetched from the AppSource store. See
[`samples/README.md`](samples/README.md) for the one-time Power BI Desktop "Save as .pbix" step.
No `.pbix` is committed.

## AppSource licensing

The AppSource listing is **Free**. Monetisation happens only through the Atlyn storefront
subscription at <https://atlyn.io> and is entirely separate from Microsoft AppSource; the visual
itself performs no licence checks and makes no network requests. Do not configure a paid or
transactable Partner Center offer. See
[`docs/partner-center-submission.md`](docs/partner-center-submission.md) for the full field list.

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
