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
npm run audit
```

Keep the stable visual GUID `atlynScatter`, keep `privileges` empty, and do not
add runtime network access or external assets. Changes should include focused
regression tests and documentation when behavior or release metadata changes.

Pull requests should explain host-facing behavior and must not claim Microsoft
certification or live Power BI host validation without independent evidence.
