# Open IoT — Milestone 2

Virtual pins, live device controls, and simulated sensor data. Node.js/Express, PostgreSQL, React/Tailwind, and authenticated WebSockets. MIT licensed.

**Already running Milestone 1? Read `UPGRADE.md` first.** Keep the same project folder, database, `.env`, `.device.env`, and token encryption key. No new account or device token is needed.

## What this milestone does

- Seeds V0 (temperature), V1 (power), and V2 (brightness) for existing and new devices.
- Adds a device workspace: click a device name in the registry.
- Shows numeric and boolean readings, ON/OFF controls, numeric sliders, and a time-based chart.
- Adds immutable typed pin definitions from V0–V31; widgets are generated from pin type/direction.
- Stores pending commands and shows success only after device acknowledgement.
- Preserves account and device management from M1, including token rotation/reveal and access revocation.
- Streams owner-scoped snapshots to browsers every two seconds over WebSockets, with reconnection and read-only HTTP fallback. Commands are disabled until the live stream reconnects.
- Runs without an ESP32: the laptop simulator sends V0 temperature and handles any configured output pin.

This version uses HTTP for the device's two-second sync loop. It does **not** add an MQTT broker, Google/Alexa, draggable widget layouts, or a hardware driver. Those remain subsequent milestones. It is a tested local starter, not a high-volume production deployment.

## Run after upgrading

In your existing M1 project folder:

```powershell
npm ci
npm run migrate
npm run dev
```

Use **http://localhost:5173/dashboard**, matching `APP_ORIGIN=http://localhost:5173`. Keep the terminal open. In another terminal in the same folder:

```powershell
npm run simulate
```

Click **Heart** (or your device name). Try **ON**, **OFF**, then move the brightness slider and click **Apply brightness**. The simulator prints the applied value, then acknowledges it on the next sync. Under normal local conditions confirmation takes approximately 2–6 seconds. No physical appliance is controlled.

V0 updates automatically. Additional sensor pins remain empty until a custom device client sends readings for them. Pin type/direction and label are fixed after creation in this milestone. Virtual pin names are not GPIO numbers.

## Data and command flow

```mermaid
sequenceDiagram
  participant UI as Browser
  participant API as Express
  participant DB as PostgreSQL
  participant SIM as Simulator
  UI->>API: Session + CSRF: set V1=true
  API->>DB: Validate owner, pin, online status; persist command
  API-->>UI: 202 pending
  SIM->>API: Token + telemetry + previous acknowledgements
  API->>DB: Validate token; save readings
  API-->>SIM: Pending command with ID and expiry
  SIM->>SIM: Apply absolute value
  SIM->>API: Acknowledge command ID and value
  API->>DB: Commit reported state and acknowledgement
  API-->>UI: Authenticated WebSocket snapshot
```

### Default pins

| Pin | Type | Direction | Widget | Range |
|---|---|---|---|---|
| V0 | number | input | Temperature reading + selectable history | -40–125 °C |
| V1 | boolean | output | ON/OFF buttons | false/true |
| V2 | number | output | Slider | 0–100% |

An output value is initially **Not reported**. It changes only when the server accepts an acknowledgement. The displayed timestamp describes the last report; it is not a guarantee of current physical state after a restart or disconnection.

## New database tables

Migration `sql/002-virtual-pins.sql` creates:

- `device_pins`: device/pin composite key, typed metadata, last reported value/time; cascade on device deletion.
- `device_commands`: UUID idempotency key, typed value, credential version, pending/acknowledged/expired/cancelled status, expiry and acknowledgement times. One pending command per device/pin.
- `telemetry_samples`: numeric readings, server receipt time, indexed device/pin/time and retention indexes.

The migration backfills three default pins without changing `users`, `devices`, sessions, or credentials. `001-initial.sql` is unchanged, preserving the M1 migration checksum. The existing migration runner applies new SQL transactionally with an advisory lock and checksums.

History returns the latest 120 stored samples. The server removes telemetry older than 24 hours and finished commands older than seven days every ten minutes; this housekeeping runs only while the server is running. At two-second cadence, each active numeric sensor adds roughly 43,200 rows/day. This is suited to small installations. Use retention partitions/TimescaleDB, ingestion quotas, and batch writes before high-frequency or large-fleet use.

## API additions

Browser writes require the configured exact Origin, JSON content type, a session cookie, and `X-CSRF-Token`. Every device-scoped browser endpoint checks ownership.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices/:id/state` | Device metadata, pins, last 30 commands |
| GET | `/api/devices/:id/history?pin=V0` | Last 120 numeric samples, oldest first |
| POST | `/api/devices/:id/pins` | Add a typed pin |
| POST | `/api/devices/:id/commands` | Create an absolute set command |
| POST | `/api/device/sync` | Device bearer-token ingestion and command delivery |
| WS | `/api/live?deviceId=UUID` | Session-authenticated read-only snapshots |

Add a pin:

```json
{"pin":"V3","label":"Desk lamp","dataType":"boolean","direction":"output","unit":"","min":0,"max":100}
```

Set an output (generate a UUID once and reuse it if retrying the same request):

```json
{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","pin":"V1","value":true}
```

Device sync:

```http
POST /api/device/sync
Authorization: Bearer DEVICE_TOKEN
Content-Type: application/json
```

```json
{"telemetry":[{"pin":"V0","value":24.7}],"acknowledgements":[]}
```

The response includes `deviceId`, `serverTime`, `commands`, `acknowledged`, and `ignored`. Each delivered command contains `id`, `pin`, `value`, and `expiresAt`. After applying a delivered value, send:

```json
{"telemetry":[{"pin":"V0","value":24.8}],"acknowledgements":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","value":true}]}
```

## Delivery semantics

- A command expires after 15 seconds. Offline/disabled devices reject new commands; there is no indefinite offline queue.
- Delivery is at least once until acknowledgement or expiry. Commands are absolute SET operations, not relative toggles/increments. A lost response may lead to redelivery.
- Duplicate accepted acknowledgements never overwrite a more recently confirmed value.
- Late/cancelled/wrong-device acknowledgements are ignored. An acknowledgement with a mismatched value returns 400.
- Device disable/enable and credential rotation cancel pending commands. Commands also bind to credential version. Already delivered physical work cannot be recalled.
- The simulator's output values are process-local. On restart it does not restore a physical state. The dashboard retains the last acknowledged value and report time. Real firmware must report boot state and reconcile it explicitly before being used for physical actuation.
- Expiry is not an exactly-once guarantee. If a device applies a command then loses connectivity before its ACK, the operation can occur without a confirmed dashboard state. Use command-ID deduplication persisted on devices and a reported-state reconciliation protocol before safety-sensitive hardware use.
- Telemetry batches are validated atomically and capped at 32 pins / 8 KiB body. Numeric values must fit the configured range; booleans are never coerced from strings.

## Security and operating limits

M1 protections remain: bcrypt passwords, HttpOnly sessions, CSRF, owner checks, SHA-256 device-token lookup, and AES-256-GCM token recovery. Do not change `TOKEN_ENCRYPTION_KEY` during the upgrade.

The WebSocket upgrade validates Origin, session expiry, and device ownership. No secret goes in the WebSocket URL. Sessions are checked again before each two-second snapshot, so logout/revocation stops the stream at the next check (subject to in-flight work). Browser commands use HTTP + CSRF rather than incoming socket messages. Unexpected client messages close the read-only socket. Payload, outbound buffer, connection count, and heartbeat limits are enabled: 100 connections per process, five per session. Slow clients are disconnected.

Remote hosting requires HTTPS/WSS and a proxy that forwards WebSocket Upgrade/Connection headers and preserves the browser Origin. Set production mode, exact HTTPS APP_ORIGIN, and narrowly scoped TRUST_PROXY. Keep PostgreSQL and the backend private. The dev Vite proxy supports `/api` WebSockets on port 3000.

The live server reads snapshots from PostgreSQL, rather than using an in-process ownership map as the source of truth. This supports eventual refresh across processes but is not designed for fleet scale: query load grows with viewers. Add shared rate limits, shared fan-out, per-device ingestion quotas, durable device sessions, monitoring, and retention partitions before scaling. Current IP rate limits are per process (240 API requests/minute; 90 device syncs/minute on that endpoint). Several simulators sharing one IP can hit the global limit.

Public registration remains enabled. Verified email, password reset, MFA, and independent security review remain work for a public service.

## Source map

| File | Responsibility |
|---|---|
| `server/pins.js` | Pin validation, owner-scoped state/history, commands, token-authenticated sync |
| `server/live.js` | WebSocket upgrade authentication, snapshots, heartbeat/backpressure |
| `server/app.js` | Existing account/device APIs plus new route integration |
| `server/index.js` | Runtime and telemetry/command retention |
| `web/src/DeviceControl.jsx` | Device workspace, controls, chart, pin creation |
| `scripts/simulator.js` | Actual HTTP device client, dummy readings, command application/ACK |
| `sql/002-virtual-pins.sql` | Additive migration and existing-device backfill |

## Validation

```powershell
npm test
npm run build
npm audit
```

The automated tests use PGlite, a real PostgreSQL engine compiled to WASM, so they do not need Docker. Browser QA uses a disposable database/account and launches the actual simulator process:

```powershell
npx playwright install chromium
node tests/browser-check.mjs
```

See `docs/VALIDATION.md` for the delivered version's checks and limitations.

Primary implementation references: [ws authentication/broadcast/heartbeat examples](https://github.com/websockets/ws), [Node HTTP upgrade event](https://nodejs.org/api/http.html#event-upgrade). The implementation uses the patched `ws` 8.22.0 dependency and retains a lockfile.
