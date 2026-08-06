---
status: accepted
---

# Release as a browser-local public beta

Nginx UI Topology will first ship as a public Beta through GitHub Pages, with a tagged GitHub release as the source reference and desktop support for current Chrome, Firefox, and Safari versions. Its output is explainable static inference and route candidates over a documented Nginx subset, not an exact Nginx runtime simulation; this preserves local-only configuration handling and keeps the initial accuracy promise honest while the project builds a broader real-configuration corpus and browser test baseline.

The first release tag will be `v0.1.0-beta.1`. Release CI must pass unit tests, Chromium/Firefox/WebKit browser checks, a production build, and dependency review before Pages deployment. The release corpus will include representative sanitized configurations with golden route and diagnostic expectations, and the repository will publish minimum privacy, security, contribution, changelog, and issue-reporting guidance.

The Beta will collect no telemetry and will not persist configuration text; only non-sensitive interface preferences may use browser storage. JSON topology exports will carry `schemaVersion: 1` and remain backward-compatible through additive changes. Support will be best-effort through GitHub Issues with no SLA, and `fishandsheep` will be named as the copyright holder.

## Consequences

- The release must clearly communicate supported syntax, unsupported runtime behavior, confidence, and non-guaranteed results.
- GitHub Pages is the canonical distribution path; npm and desktop packaging are out of scope for this release.
- Critical and high dependency findings, as well as any failing browser check, block the Beta release unless an explicitly documented exception is accepted.
- Release validation must include the selected release commit, dependency review, browser-level smoke coverage, and regression fixtures from representative configurations.
- Post-release validation will collect feedback from real sanitized configurations and external users without imposing a fixed numeric target or launch gate.
