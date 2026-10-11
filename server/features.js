import { z } from "zod";
import { DateTime } from "luxon";
import { CronExpressionParser } from "cron-parser";
import { randomUUID } from "node:crypto";
import { fail } from "./security.js";
import { checkValue, enqueueCommand } from "./pins.js";
import { events } from "./events.js";

const uuid = z.uuid(),
  pinName = z.string().regex(/^V([0-9]|[12][0-9]|3[01])$/);
const bounded = z.number().finite().min(-1e9).max(1e9);
const position = (cols) =>
  z
    .object({
      x: z
        .number()
        .int()
        .min(0)
        .max(cols - 1),
      y: z.number().int().min(0).max(500),
      w: z.number().int().min(1).max(cols),
      h: z.number().int().min(3).max(12),
    })
    .strict()
    .refine((p) => p.x + p.w <= cols);
const widget = z
  .object({
    id: uuid,
    deviceId: uuid,
    pin: pinName,
    kind: z.enum(["switch", "slider", "gauge", "value", "chart"]),
    label: z.string().trim().min(1).max(60),
    config: z
      .object({
        color: z.string().regex(/^#[a-f0-9]{6}$/i),
        unit: z.string().max(12),
        min: bounded,
        max: bounded,
        step: z.number().finite().positive().max(1e9),
      })
      .strict()
      .refine((c) => c.max > c.min && c.step <= c.max - c.min),
    layouts: z.object({ lg: position(12), sm: position(4) }).strict(),
  })
  .strict();
const boardSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    version: z.number().int().nonnegative(),
    widgets: z.array(widget).max(24),
  })
  .strict()
  .refine(
    (b) =>
      new Set(b.widgets.map((w) => w.id)).size === b.widgets.length &&
      new Set(b.widgets.map((w) => w.deviceId)).size <= 5,
  );
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const scheduleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("once"),
      localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    })
    .strict(),
  z.object({ kind: z.literal("daily"), time: clock }).strict(),
  z
    .object({
      kind: z.literal("weekly"),
      time: clock,
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    })
    .strict(),
]);
const automationSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    deviceId: uuid,
    pin: pinName,
    value: z.union([bounded, z.boolean()]),
    timezone: z.string().min(1).max(80),
    schedule: scheduleSchema,
    enabled: z.boolean(),
  })
  .strict();
export function nextRun(schedule, zone, after = new Date()) {
  if (!DateTime.now().setZone(zone).isValid)
    throw fail(400, "Choose a valid IANA timezone, such as Asia/Kolkata.");
  if (schedule.kind === "once") {
    const date = DateTime.fromISO(schedule.localDateTime, { zone });
    if (
      !date.isValid ||
      date.toFormat("yyyy-MM-dd'T'HH:mm") !== schedule.localDateTime
    )
      throw fail(400, "That local date/time does not exist in this timezone.");
    if (date.getPossibleOffsets().length > 1)
      throw fail(
        400,
        "That time occurs twice during daylight saving. Choose a different time.",
      );
    return date.toMillis() > +after ? date.toJSDate() : null;
  }
  const [hour, minute] = schedule.time.split(":").map(Number);
  return CronExpressionParser.parse(
    `${minute} ${hour} * * ${schedule.kind === "weekly" ? [...new Set(schedule.days)].join(",") : "*"}`,
    { tz: zone, currentDate: after },
  )
    .next()
    .toDate();
}
async function ownedPin(cx, userId, deviceId, pin) {
  const {
    rows: [p],
  } = await cx.query(
    `SELECT p.*,d.token_version,d.disabled_at,d.name AS device_name FROM device_pins p JOIN devices d ON d.id=p.device_id WHERE d.user_id=$1 AND p.device_id=$2 AND p.pin=$3`,
    [userId, deviceId, pin],
  );
  if (!p) throw fail(404, "Device or virtual pin not found.");
  return p;
}
export function installFeatureRoutes(app, { db, tx, authenticate, limit }) {
  app.get("/api/catalog", authenticate, async (req, res) => {
    const { rows } = await db.query(
      `SELECT d.id,d.name,d.disabled_at,p.pin,p.label,p.data_type,p.direction,p.unit,p.min_value,p.max_value FROM devices d JOIN device_pins p ON p.device_id=d.id WHERE d.user_id=$1 ORDER BY d.name,p.pin LIMIT 32000`,
      [req.user.id],
    );
    const devices = [];
    for (const row of rows) {
      let d = devices.find((d) => d.id === row.id);
      if (!d) {
        d = {
          id: row.id,
          name: row.name,
          disabled: !!row.disabled_at,
          pins: [],
        };
        devices.push(d);
      }
      d.pins.push({
        pin: row.pin,
        label: row.label,
        dataType: row.data_type,
        direction: row.direction,
        unit: row.unit,
        min: row.min_value,
        max: row.max_value,
      });
    }
    res.json({ devices });
  });
  app.get("/api/dashboard-layout", authenticate, async (req, res) => {
    res.json(
      await tx(async (cx) => {
        await cx.query(
          "INSERT INTO dashboards(user_id) VALUES($1) ON CONFLICT DO NOTHING",
          [req.user.id],
        );
        const {
          rows: [b],
        } = await cx.query(
          "SELECT title,version FROM dashboards WHERE user_id=$1 FOR UPDATE",
          [req.user.id],
        );
        const { rows: widgets } = await cx.query(
          'SELECT id,device_id AS "deviceId",pin,kind,label,config,layouts FROM dashboard_widgets WHERE user_id=$1 ORDER BY sort_order',
          [req.user.id],
        );
        return { ...b, widgets };
      }),
    );
  });
  app.put(
    "/api/dashboard-layout",
    authenticate,
    limit(30),
    async (req, res) => {
      const b = boardSchema.parse(req.body);
      const version = await tx(async (cx) => {
        await cx.query(
          "INSERT INTO dashboards(user_id) VALUES($1) ON CONFLICT DO NOTHING",
          [req.user.id],
        );
        const {
          rows: [current],
        } = await cx.query(
          "SELECT version FROM dashboards WHERE user_id=$1 FOR UPDATE",
          [req.user.id],
        );
        if (current.version !== b.version)
          throw fail(
            409,
            "Dashboard changed in another tab. Reload before editing.",
          );
        for (const w of b.widgets) {
          const p = await ownedPin(cx, req.user.id, w.deviceId, w.pin);
          if (
            w.kind === "switch" &&
            (p.direction !== "output" || p.data_type !== "boolean")
          )
            throw fail(400, "Switches need a boolean output pin.");
          if (
            w.kind === "slider" &&
            (p.direction !== "output" || p.data_type !== "number")
          )
            throw fail(400, "Sliders need a numeric output pin.");
          if (["gauge", "chart"].includes(w.kind) && p.data_type !== "number")
            throw fail(400, "Charts and gauges need numeric pins.");
          if (w.kind === "chart" && p.direction !== "input")
            throw fail(400, "History charts need numeric input pins.");
          if (
            w.kind === "slider" &&
            (w.config.min < p.min_value || w.config.max > p.max_value)
          )
            throw fail(400, "Slider bounds must fit the pin limits.");
        }
        await cx.query("DELETE FROM dashboard_widgets WHERE user_id=$1", [
          req.user.id,
        ]);
        for (const [i, w] of b.widgets.entries())
          await cx.query(
            "INSERT INTO dashboard_widgets(id,user_id,device_id,pin,kind,label,config,layouts,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)",
            [
              w.id,
              req.user.id,
              w.deviceId,
              w.pin,
              w.kind,
              w.label,
              JSON.stringify(w.config),
              JSON.stringify(w.layouts),
              i,
            ],
          );
        await cx.query(
          "UPDATE dashboards SET title=$2,version=version+1,updated_at=now() WHERE user_id=$1",
          [req.user.id, b.title],
        );
        return current.version + 1;
      });
      res.json({ version });
    },
  );
  app.get("/api/automations", authenticate, async (req, res) => {
    const { rows: automations } = await db.query(
      `SELECT a.*,d.name AS device_name FROM automations a JOIN devices d ON d.id=a.device_id WHERE a.user_id=$1 ORDER BY a.created_at DESC`,
      [req.user.id],
    );
    const { rows: runs } = await db.query(
      `SELECT r.*,a.name,a.timezone,CASE WHEN r.status='queued' THEN CASE WHEN c.status='pending' AND c.expires_at<=now() THEN 'expired' WHEN c.id IS NULL THEN 'unconfirmed' WHEN c.status='pending' THEN 'queued' ELSE c.status END ELSE r.status END AS outcome FROM automation_runs r JOIN automations a ON a.id=r.automation_id LEFT JOIN device_commands c ON c.id=r.command_id WHERE a.user_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ automations, runs, serverTime: new Date().toISOString() });
  });
  async function save(req, res) {
    const a = automationSchema.parse(req.body),
      id = req.params.id ? uuid.parse(req.params.id) : randomUUID();
    const next = nextRun(a.schedule, a.timezone);
    if (a.enabled && !next)
      throw fail(400, "Choose a future time for this one-time schedule.");
    await tx(async (cx) => {
      // Lock owner to serialize the per-account limit check.
      await cx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (req.params.id) {
        const { rows } = await cx.query(
          "SELECT id FROM automations WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [id, req.user.id],
        );
        if (!rows.length) throw fail(404, "Automation not found.");
      } else {
        const {
          rows: [r],
        } = await cx.query(
          "SELECT count(*)::int AS n FROM automations WHERE user_id=$1",
          [req.user.id],
        );
        if (r.n >= 100) throw fail(400, "Limit: 100 automations per account.");
      }
      const p = await ownedPin(cx, req.user.id, a.deviceId, a.pin);
      if (p.direction !== "output")
        throw fail(400, "Automation requires an output pin.");
      checkValue(p, a.value);
      if (p.disabled_at && a.enabled)
        throw fail(400, "Enable this device before scheduling it.");
      if (req.params.id) {
        await cx.query(
          `UPDATE device_commands SET status='cancelled' WHERE status='pending' AND id IN (SELECT command_id FROM automation_runs WHERE automation_id=$1)`,
          [id],
        );
        await cx.query(
          "UPDATE automations SET name=$3,device_id=$4,pin=$5,value=$6::jsonb,timezone=$7,schedule=$8::jsonb,enabled=$9,next_run_at=$10,token_version=$11,updated_at=now() WHERE id=$1 AND user_id=$2",
          [
            id,
            req.user.id,
            a.name,
            a.deviceId,
            a.pin,
            JSON.stringify(a.value),
            a.timezone,
            JSON.stringify(a.schedule),
            a.enabled,
            a.enabled ? next : null,
            p.token_version,
          ],
        );
      } else
        await cx.query(
          "INSERT INTO automations(id,user_id,name,device_id,pin,value,timezone,schedule,enabled,next_run_at,token_version) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11)",
          [
            id,
            req.user.id,
            a.name,
            a.deviceId,
            a.pin,
            JSON.stringify(a.value),
            a.timezone,
            JSON.stringify(a.schedule),
            a.enabled,
            a.enabled ? next : null,
            p.token_version,
          ],
        );
    });
    events.emit("state", a.deviceId);
    res
      .status(req.params.id ? 200 : 201)
      .json({ id, nextRunAt: a.enabled ? next : null });
  }
  app.post("/api/automations", authenticate, limit(30), save);
  app.put("/api/automations/:id", authenticate, limit(30), save);
  app.delete("/api/automations/:id", authenticate, async (req, res) => {
    await tx(async (cx) => {
      const id = uuid.parse(req.params.id);
      const { rows } = await cx.query(
        "SELECT id FROM automations WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, req.user.id],
      );
      if (!rows.length) throw fail(404, "Automation not found.");
      await cx.query(
        `UPDATE device_commands SET status='cancelled' WHERE status='pending' AND id IN (SELECT command_id FROM automation_runs WHERE automation_id=$1)`,
        [id],
      );
      await cx.query("DELETE FROM automations WHERE id=$1", [id]);
    });
    res.json({ ok: true });
  });
}

export async function runSchedules(db, now = new Date()) {
  const cx = await db.connect();
  const notify = new Set();
  try {
    await cx.query("BEGIN");
    await cx.query(
      `UPDATE automation_runs r SET status=CASE WHEN c.status='pending' THEN 'expired' ELSE c.status END FROM device_commands c WHERE r.command_id=c.id AND r.status='queued' AND (c.status<>'pending' OR c.expires_at<=now())`,
    );
    const { rows: due } = await cx.query(
      "SELECT * FROM automations WHERE enabled=true AND next_run_at<=$1 ORDER BY next_run_at,id LIMIT 50 FOR UPDATE SKIP LOCKED",
      [now],
    );
    for (const a of due) {
      const scheduled = new Date(a.next_run_at);
      let status = "skipped",
        detail = "",
        command = null;
      const {
        rows: [d],
      } = await cx.query(
        "SELECT token_version FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [a.device_id, a.user_id],
      );
      if (+now - +scheduled > 60000)
        detail =
          "Missed time: backend was unavailable or delayed. Not replayed.";
      else if (!d || d.token_version !== a.token_version)
        detail =
          "Credential changed. Review and save this automation to re-enable it.";
      else {
        try {
          command = await enqueueCommand(
            cx,
            a.user_id,
            a.device_id,
            { id: randomUUID(), pin: a.pin, value: a.value },
            +now,
          );
          status = "queued";
          detail = "Waiting for device confirmation.";
          notify.add(a.device_id);
        } catch (e) {
          if (!e.status) throw e;
          detail = e.message;
        }
      }
      await cx.query(
        "INSERT INTO automation_runs(automation_id,scheduled_for,command_id,status,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(automation_id,scheduled_for) DO NOTHING",
        [a.id, scheduled, command?.id ?? null, status, detail],
      );
      const credentialChanged = !d || d.token_version !== a.token_version;
      const next =
        a.schedule.kind === "once" || credentialChanged
          ? null
          : nextRun(a.schedule, a.timezone, now);
      await cx.query(
        "UPDATE automations SET next_run_at=$2,enabled=$3,updated_at=now() WHERE id=$1",
        [a.id, next, !!next],
      );
    }
    await cx.query("COMMIT");
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally {
    cx.release();
  }
  for (const id of notify) {
    events.emit("command", id);
    events.emit("state", id);
  }
}
export function startScheduler(db) {
  let busy = false,
    stopped = false;
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      await runSchedules(db);
    } catch (e) {
      console.error("Automation scheduler failed:", e.code ?? e.message);
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (busy) await new Promise((r) => setTimeout(r, 20));
  };
}
