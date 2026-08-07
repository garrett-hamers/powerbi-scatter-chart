# Contributing

## Development

Use Node.js 20.19 or newer, then run:

```text
npm ci
npm test
npm run typecheck
npm run eslint
npm run build
npm run package
npm run reproducibility-audit
npm run certification-audit
npm run publication-audit
npm run release-manifest
npm run audit
```

Keep the stable visual GUID `atlynScatter`, keep `privileges` empty, and do not
add runtime network access or external assets. Changes should include focused
regression tests and documentation when behavior or release metadata changes.
Release changes must preserve the two-run reproducibility audit, source metadata
parity, exact PBIVIZ filename, and stale-artifact protections.

Release hashes come from `dist/release-manifest.json`. The PBIVIZ ZIP is normalized before the
hash is recorded, so a package may only be uploaded to an immutable versioned location when its
manifest's source commit, filename, byte size, and SHA-256 have been retained. Do not overwrite a
published package at the same version.
Run `npm run publication-audit` before submission to verify `assets/icon.png` and
`assets/partner-center-logo-300x300.png` meet publication requirements.

Pull requests should explain host-facing behavior and must not claim Microsoft
certification or live Power BI host validation without independent evidence.
