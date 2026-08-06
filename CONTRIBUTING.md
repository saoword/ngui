# Contributing

Thanks for helping improve Nginx UI Topology.

## Development

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm test
npm run test:e2e
npm run build
npm audit --audit-level=high
```

Install Playwright browsers locally when needed:

```bash
npx playwright install chromium firefox webkit
```

## Configuration data

Never commit real production `nginx -T` output. Use sanitized fixtures with fake hostnames, addresses, credentials, certificates, tokens, and paths.

## Pull requests

- Explain the user-facing behavior and the supported Nginx semantics involved.
- Add or update parser, routing, fixture, or browser tests for behavior changes.
- Keep static inference explainable; do not present uncertain runtime behavior as a guaranteed result.
- Update the bilingual README or changelog when release-facing behavior changes.
