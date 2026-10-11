# Milestone 1 validation

Validated using Node.js v24.19.0, PostgreSQL via PGlite/WASM, and Chromium 141 through Playwright 1.56.1.

## Passed

- Four automated API/security test groups: registration, login, bcrypt UTF-8 byte limits, duplicate emails, user isolation, CSRF/Origin checks, token encryption/reveal/rotation, old-token invalidation, heartbeat freshness, disable/re-enable, password changes, session revocation, and account deletion.
- React/Tailwind production build: successful, 1,930 modules transformed.
- Full browser journey: registration, protected dashboard, device creation, the actual Node simulator heartbeat, online status, token reveal, device rename, profile update, logout, login, and protected-route redirect.
- Desktop (1440px) and mobile (390px) browser layouts checked. Document-level horizontal overflow checks passed. The device table scrolls inside its panel on small screens.
- Captured and inspected landing/dashboard screenshots. Demo data belongs to an ephemeral test database and is not preloaded into the delivered app.
- Dependency audit: zero known vulnerabilities reported at the checked versions.

## Scope limits

Docker Compose and the production PostgreSQL container were not available for runtime verification. Database tests used the real PostgreSQL engine through PGlite, not a mock. Real HTTPS proxy deployment, email delivery, physical IoT boards, MQTT, and voice assistants were not tested or deployed. M1 provides heartbeat-based device presence; no hardware is required.

Tests use bcrypt cost 4 for speed; the normal application uses cost 12. The browser test starts a disposable server on 127.0.0.1:4178 and tears it down. Never use its reduced-limit test configuration for deployment.
