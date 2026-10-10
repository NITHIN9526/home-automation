# Milestone 2 validation

Validated 10 October 2026.

## Passed

- Eight Node test groups: M1 registration/login and session lifecycle; bcrypt and token cryptography; pin ownership/ranges; durable commands and ACKs; idempotent command retry and duplicate old ACK protection; expiry/rotation/disable; WebSocket Origin/session/ownership and logout revocation; M1-to-M2 migration retaining user/device/token data.
- React/Vite production build.
- Chromium browser flow at 1440px desktop and 390px mobile: signup, device creation, actual simulator process, live WebSocket connection, V1 ON/OFF confirmed, V2 brightness confirmed, add/control V3, persisted state/history after reload, token reveal, rename, profile edit, logout/login, protected routes, no page-level horizontal overflow and no JavaScript page errors.
- Desktop and mobile screenshots manually inspected. The chart adapts its coordinate width to the available space; the activity table has its own horizontal scroll container on small screens.
- `npm audit`: zero vulnerabilities reported for the installed lockfile at validation time. WebSocket library pinned to patched ws 8.22.0.
- Upgrade installer run against a disposable copy of M1. Existing environment files, a customized Docker host-port mapping, and migration 001 remained byte-identical. Previous source files were backed up before replacement. Installer uses Node built-ins only.

## Boundaries

Database integration used the actual PostgreSQL engine in PGlite/WASM, not a Docker PostgreSQL daemon. Docker startup and native Windows execution were not available in this environment. The installer was exercised on Linux and written with cross-platform Node filesystem/path APIs. The browser end-to-end test served the production frontend directly from Express; the development Vite WebSocket proxy is configured but was not covered by that browser run.

No physical hardware, MQTT broker, voice assistant account linking, TLS termination, high-load benchmark, or independent security audit was performed. The simulator is a real HTTP API client but only changes process-local simulated outputs.
