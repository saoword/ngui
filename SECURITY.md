# Security Policy

## Scope

Nginx UI Topology is a static browser application. It does not provide a backend, does not upload configuration text, and does not treat its static inference as a security control or a replacement for `nginx -t`.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when available. If private reporting is unavailable, contact the repository maintainers through GitHub before opening a public issue.

Do not include production configuration, credentials, private hostnames, certificates, tokens, or other sensitive data in a report. Provide a sanitized reproduction and the affected browser, release version, and steps to reproduce.

## Supported versions

Only the latest `v0.1.0-beta.*` release receives active release validation during the Beta period. Older builds may remain available on GitHub Pages history but are not a supported security baseline.
