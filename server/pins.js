import { events } from "./events.js";
import { z } from "zod";
import { fail, hashToken, tokenPattern } from "./security.js";

const pinName = z.string().regex(/^V([0-9]|[12][0-9]|3[01])$/);
const valueSchema = z.union([z.number().finite(), z.boolean()]);
const syncSchema = z
  .object({
    telemetry: z
      .array(z.object({ pin: pinName, value: valueSchema }).strict())
      .max(32)
      .default([]),
    acknowledgements: z
      .array(z.object({ id: z.uuid(), value: valueSchema }).strict())
      .max(32)
      .default([]),
  })
  .strict()
  .refine(
    (x) => new Set(x.telemetry.map((t) => t.pin)).size === x.telemetry.length,
    "A pin may occur only once in a telemetry batch.",
  );
const pinSchema = z
  .object({
    pin: pinName,
    label: z.string().trim().min(1).max(60),
    dataType: z.enum(["number", "boolean"]),
    direction: z.enum(["input", "output"]),
    unit: z.string().trim().max(12).default(""),
    min: z.number().finite().min(-1e9).max(1e9).default(0),
    max: z.number().finite().min(-1e9).max(1e9).default(100),
  })
  .strict()
  .refine((x) => x.max > x.min, "Maximum must exceed minimum.");

export function checkValue(pin, value) {
  if (
    typeof value !== pin.data_type ||
    (typeof value === "number" &&
      (!Number.isFinite(value) ||
        value < pin.min_value ||
        value > pin.max_value))
  )
    throw fail(400, `Invalid value for ${pin.pin}. Check its type and range.`);
}
export async function seedPins(cx, id) {
  await cx.query(
    `INSERT INTO device_pins(device_id,pin,label,data_type,direction,unit,min_value,max_value) VALUES
    ($1,'V0','Temperature','number','input','°C',-40,125),
    ($1,'V1','Power','boolean','output','',0,100),
    ($1,'V2','Brightness','number','output','%',0,100) ON CONFLICT DO NOTHING`,
    [id],
  );
}
export async function snapshot(db, id, userId) {
  const {
    rows: [device],
  } = await db.query(
    `SELECT id,name,device_type AS "deviceType",last_seen_at AS "lastSeenAt",
    CASE WHEN disabled_at IS NOT NULL THEN 'disabled' WHEN last_seen_at>now()-interval '30 seconds'
    THEN 'online' ELSE 'offline' END AS status FROM devices WHERE id=$1 AND user_id=$2`,
    [id, userId],
  );
  if (!device) throw fail(404, "Device not found.");
  const { rows: pins } = await db.query(
    `SELECT pin,label,data_type AS "dataType",direction,unit,
    min_value AS min,max_value AS max,value,reported_at AS "reportedAt"
    FROM device_pins WHERE device_id=$1 ORDER BY substring(pin FROM 2)::int`,
    [id],
  );
  const { rows: commands } = await db.query(
    `SELECT id,pin,value,
    CASE WHEN status='pending' AND expires_at<=now() THEN 'expired' ELSE status END AS status,
    created_at AS "createdAt",expires_at AS "expiresAt",acknowledged_at AS "acknowledgedAt"
    FROM device_commands WHERE device_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30`,
    [id],
  );
  return { device, pins, commands, serverTime: new Date().toISOString() };
}
export function installPinRoutes(app, { db, tx, authenticate, limit }) {
  async function owned(cx, req) {
    const id = z.uuid().parse(req.params.id);
    const {
      rows: [d],
    } = await cx.query(
      "SELECT * FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, req.user.id],
    );
    if (!d) throw fail(404, "Device not found.");
    return d;
  }
  app.get("/api/devices/:id/state", authenticate, async (req, res) => {
    res.json(await snapshot(db, z.uuid().parse(req.params.id), req.user.id));
  });
  app.get("/api/devices/:id/history", authenticate, async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      pin = pinName.parse(req.query.pin ?? "V0");
    const {
      rows: [d],
    } = await db.query("SELECT id FROM devices WHERE id=$1 AND user_id=$2", [
      id,
      req.user.id,
    ]);
    if (!d) throw fail(404, "Device not found.");
    const { rows } = await db.query(
      `SELECT id::text,value,received_at AS time FROM telemetry_samples
      WHERE device_id=$1 AND pin=$2 ORDER BY received_at DESC,id DESC LIMIT 120`,
      [id, pin],
    );
    res.json({ pin, samples: rows.reverse() });
  });
  app.post("/api/devices/:id/pins", authenticate, async (req, res) => {
    const p = pinSchema.parse(req.body);
    await tx(async (cx) => {
      const d = await owned(cx, req);
      const { rows } = await cx.query(
        "SELECT pin FROM device_pins WHERE device_id=$1 AND pin=$2",
        [d.id, p.pin],
      );
      if (rows.length) throw fail(409, "This virtual pin already exists.");
      await cx.query(
        `INSERT INTO device_pins(device_id,pin,label,data_type,direction,unit,min_value,max_value)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [d.id, p.pin, p.label, p.dataType, p.direction, p.unit, p.min, p.max],
      );
    });
    res.status(201).json({ ok: true });
  });
  app.post(
    "/api/devices/:id/commands",
    authenticate,
    limit(40),
    async (req, res) => {
      const data = z
        .object({ id: z.uuid(), pin: pinName, value: valueSchema })
        .strict()
        .parse(req.body);
      const command = await tx((cx) =>
        enqueueCommand(cx, req.user.id, z.uuid().parse(req.params.id), data),
      );
      events.emit("command", command.device_id);
      events.emit("state", command.device_id);
      res.status(202).json({
        command: {
          id: command.id,
          pin: command.pin,
          value: command.value,
          status: command.status,
        },
      });
    },
  );
  // This device-only route authenticates with a bearer token. It never accepts a browser session.
  app.post("/api/device/sync", limit(90), async (req, res) => {
    const header = req.get("Authorization") ?? "",
      token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!tokenPattern.test(token))
      throw fail(401, "Invalid device credential.");
    const result = await syncDevice(tx, token, req.body);
    res.json(result);
  });
}

export async function syncDevice(tx, token, body) {
  const data = syncSchema.parse(body);
  const result = await tx(async (cx) => {
    // Lock the credential row so revocation/rotation and a sync cannot interleave.
    const {
      rows: [d],
    } = await cx.query(
      "SELECT * FROM devices WHERE token_hash=$1 AND disabled_at IS NULL FOR UPDATE",
      [hashToken(token)],
    );
    if (!d) throw fail(401, "Invalid or disabled device credential.");
    const { rows: pins } = await cx.query(
      "SELECT * FROM device_pins WHERE device_id=$1",
      [d.id],
    );
    for (const item of data.telemetry) {
      const pin = pins.find((p) => p.pin === item.pin);
      if (!pin || pin.direction !== "input")
        throw fail(400, `Telemetry requires an input pin: ${item.pin}.`);
      checkValue(pin, item.value);
    }
    await cx.query(
      `UPDATE device_commands SET status='expired' WHERE device_id=$1 AND status='pending' AND expires_at<=now()`,
      [d.id],
    );
    const acknowledged = [],
      ignored = [];
    for (const ack of data.acknowledgements) {
      const {
        rows: [cmd],
      } = await cx.query(
        `SELECT * FROM device_commands WHERE id=$1 AND device_id=$2 AND token_version=$3`,
        [ack.id, d.id, d.token_version],
      );
      if (!cmd || !["pending", "acknowledged"].includes(cmd.status)) {
        ignored.push(ack.id);
        continue;
      }
      if (cmd.value !== ack.value)
        throw fail(400, "Acknowledged value must match the command.");
      if (cmd.status === "pending") {
        await cx.query(
          `UPDATE device_commands SET status='acknowledged',acknowledged_at=now() WHERE id=$1`,
          [cmd.id],
        );
        await cx.query(
          "UPDATE device_pins SET value=$1::jsonb,reported_at=now() WHERE device_id=$2 AND pin=$3",
          [JSON.stringify(ack.value), d.id, cmd.pin],
        );
      }
      acknowledged.push(cmd.id);
    }
    // Duplicate ACKs do not reapply a previous state over a newer command.
    for (const item of data.telemetry) {
      await cx.query(
        "UPDATE device_pins SET value=$1::jsonb,reported_at=now() WHERE device_id=$2 AND pin=$3",
        [JSON.stringify(item.value), d.id, item.pin],
      );
      if (typeof item.value === "number")
        await cx.query(
          "INSERT INTO telemetry_samples(device_id,pin,value) VALUES($1,$2,$3)",
          [d.id, item.pin, item.value],
        );
    }
    await cx.query("UPDATE devices SET last_seen_at=now() WHERE id=$1", [d.id]);
    const { rows: commands } = await cx.query(
      `SELECT id,pin,value,expires_at AS "expiresAt" FROM device_commands
        WHERE device_id=$1 AND status='pending' AND token_version=$2 AND expires_at>now() ORDER BY created_at,id`,
      [d.id, d.token_version],
    );
    return {
      deviceId: d.id,
      acknowledged,
      ignored,
      commands,
      serverTime: new Date().toISOString(),
    };
  });
  events.emit("state", result.deviceId);
  return result;
}

export async function enqueueCommand(
  cx,
  userId,
  deviceId,
  data,
  now = Date.now(),
) {
  const {
    rows: [d],
  } = await cx.query(
    "SELECT * FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE",
    [deviceId, userId],
  );
  if (!d) throw fail(404, "Device not found.");
  const {
    rows: [existing],
  } = await cx.query("SELECT * FROM device_commands WHERE id=$1", [data.id]);
  if (existing) {
    if (
      existing.device_id !== d.id ||
      existing.pin !== data.pin ||
      existing.value !== data.value
    )
      throw fail(409, "Command ID already used.");
    return existing;
  }
  if (
    d.disabled_at ||
    !d.last_seen_at ||
    now - new Date(d.last_seen_at).getTime() >= 30000
  )
    throw fail(409, "Device is offline or disabled. Connect the device first.");
  const {
    rows: [pin],
  } = await cx.query(
    "SELECT * FROM device_pins WHERE device_id=$1 AND pin=$2",
    [d.id, data.pin],
  );
  if (!pin || pin.direction !== "output")
    throw fail(400, "Commands require an output pin.");
  checkValue(pin, data.value);
  await cx.query(
    `UPDATE device_commands SET status='expired' WHERE device_id=$1 AND status='pending' AND expires_at<=now()`,
    [d.id],
  );
  const { rows: pending } = await cx.query(
    `SELECT id FROM device_commands WHERE device_id=$1 AND pin=$2 AND status='pending'`,
    [d.id, data.pin],
  );
  if (pending.length)
    throw fail(409, "Wait for the pending command to finish.");
  const {
    rows: [result],
  } = await cx.query(
    `INSERT INTO device_commands(id,device_id,pin,value,token_version)
        VALUES($1,$2,$3,$4::jsonb,$5) RETURNING *`,
    [data.id, d.id, data.pin, JSON.stringify(data.value), d.token_version],
  );
  return result;
}
