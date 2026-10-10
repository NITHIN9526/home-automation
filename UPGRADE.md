# Upgrade your working Open IoT Milestone 1 to Milestone 2

You already have account registration and the **Heart** laptop simulator working. This upgrade adds live controls and sensor history to that same device. Keep your account, database, token, and configuration.

## 1. Stop both Node terminals

Press **Ctrl+C** in the terminal running `npm run dev` and the terminal running `npm run simulate`. Leave Docker Desktop and PostgreSQL running.

## 2. Download and extract the upgrade

Download `Open_IoT_Milestone_2_Upgrade.zip`. Extract it into your Downloads folder. Locate `apply-upgrade.mjs` inside the extracted folder (Windows may add another enclosing folder).

The archive contains only source changes, documentation, and tests. It does not include or overwrite `.env`, `.device.env`, `compose.yaml`, or your database.

## 3. Apply it from your existing project folder

Open PowerShell:

```powershell
cd "C:\Users\nithi\Downloads\Open_IoT_Milestone_1\open-iot-milestone-1"
node "$env:USERPROFILE\Downloads\Open_IoT_Milestone_2_Upgrade\apply-upgrade.mjs"
```

If `apply-upgrade.mjs` was extracted elsewhere, replace only the second command's path with its actual full path. You can drag the file into the terminal after typing `node ` to insert the path (quote it if it contains spaces).

The installer checks that you are in the existing M1 project, validates the unchanged initial migration and all package checksums, and backs up replaced source files under `.upgrade-backups`. It then copies the update into this project. It does **not** install dependencies, run migrations, or change Docker automatically.

You should see **Source upgrade applied**. Continue using this same M1 project folder; do not start Docker from the extracted upgrade folder.

## 4. Install dependencies and migrate

```powershell
npm ci
npm run migrate
```

Only continue when both commands succeed. The migration should report:

```text
Applied 002-virtual-pins.sql
```

If PostgreSQL was stopped, start it from your existing project folder:

```powershell
docker compose up -d --wait postgres
npm run migrate
```

Your port-conflict fix remains intact: `.env` and `compose.yaml` are preserved, including your chosen host port such as 5433. **Do not run `docker compose down -v`, regenerate the encryption key, or recreate the account.**

## 5. Start the upgraded app

```powershell
npm run dev
```

Leave that terminal open. Open **http://localhost:5173/dashboard**. Use `localhost`, matching your current `APP_ORIGIN`, not `127.0.0.1`. Log in with your existing account if asked.

## 6. Restart the upgraded simulator

In a second PowerShell terminal:

```powershell
cd "C:\Users\nithi\Downloads\Open_IoT_Milestone_1\open-iot-milestone-1"
npm run simulate
```

It uses the token already in `.device.env`. No new token is needed. The terminal should show:

```text
Simulator M2 started. V0: temperature, V1: power, V2: brightness.
... heartbeat accepted ... V0=24.7°C
```

## 7. Open the controls

Click **Heart** in the dashboard device list.

| Control | Try this | Expected result |
|---|---|---|
| Temperature · V0 | Leave simulator running | Reading changes every few seconds; chart fills |
| Power · V1 | Click ON, then OFF | Pending message, then confirmed ON/OFF |
| Brightness · V2 | Move slider and click Apply brightness | Simulator acknowledges the selected number |
| Add virtual pin | Add V3, label Desk lamp, Boolean, Output | A new ON/OFF card appears; simulator handles it |

The device takes roughly 2–6 seconds to confirm a command on a local connection. The confirmation is from your laptop simulator; it does not switch a real appliance. New input/sensor pins require a client that actually publishes them; only V0 has built-in dummy readings.

## 8. Test offline behavior

Stop only the simulator with Ctrl+C. Within roughly 30–35 seconds the device becomes offline and controls become unavailable. If a command was sent just before the simulator stopped, it times out after 15 seconds without acknowledgement.

Restart with `npm run simulate`. The page reconnects automatically. Output values are the last acknowledged reports, with timestamps, rather than a physical state guarantee after restart.

## Troubleshooting

- **Request origin is not allowed:** open exactly `http://localhost:5173`; `.env` must contain `APP_ORIGIN=http://localhost:5173`. Restart `npm run dev` after editing it.
- **relation device_pins does not exist:** stop Node, run `npm run migrate` successfully, then restart.
- **Old heartbeat-only simulator:** stop the old process, run the installer in the correct project folder, then restart `npm run simulate` there. It should say `Simulator M2 started`.
- **Device stays offline:** verify the simulator is running and its `API_URL` is the backend address (`http://localhost:3000`), not the Vite URL. Keep tokens private.
- **Reconnecting live updates:** keep both API and Vite running. Stop/restart `npm run dev` after installation so Vite reads its new WebSocket proxy setting. A remote reverse proxy must forward WebSocket upgrades.
- **Migration checksum mismatch:** do not delete migration records or reset the database. Restore the exact original SQL file or share the error text, without credentials.
- **Installer baseline mismatch:** the installer refuses an unknown initial migration. Share its error text before proceeding; do not force it over a different project.

## Backups and rollback

The installer backs up only replaced source files, not the database. Make a normal PostgreSQL backup before deploying to a shared or production instance. M2's additive migration leaves M1 tables unchanged, so rolling back source to the saved version does not require deleting the new tables. Keep the same environment files. After restoring source/package files, run `npm ci` again and restart. Never remove the database volume as an upgrade step.
