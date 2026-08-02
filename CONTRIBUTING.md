# Contributing

## Development

Use Node.js 18 or newer, then run:

```text
npm ci
npm test
npm run typecheck
npm run lint:full
npm run build
npm run package
npm run certification-audit
npm run release-manifest
npm run audit
```

Keep the stable visual GUID `atlynScatter`, keep `privileges` empty, and do not
add runtime network access or external assets. Changes should include focused
regression tests and documentation when behavior or release metadata changes.

Release hashes come from `dist/release-manifest.json`. The PBIVIZ ZIP is normalized before the
hash is recorded, so a package may only be uploaded to an immutable versioned location when its
manifest's source commit, filename, byte size, and SHA-256 have been retained. Do not overwrite a
published package at the same version.

Pull requests should explain host-facing behavior and must not claim Microsoft
certification or live Power BI host validation without independent evidence.
