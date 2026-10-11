import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { fixture } from "./features-fixture.js";
import { nextRun, runSchedules } from "../server/features.js";
function board(id) {
  return {
    title: "Living room",
    version: 0,
    widgets: [
      {
        id: randomUUID(),
        deviceId: id,
        pin: "V1",
        kind: "switch",
        label: "Light",
        config: { color: "#245a42", unit: "", min: 0, max: 100, step: 1 },
        layouts: {
          lg: { x: 0, y: 0, w: 4, h: 5 },
          sm: { x: 0, y: 0, w: 4, h: 5 },
        },
      },
    ],
  };
}
function automation(id, extra = {}) {
  return {
    name: "Evening light",
    deviceId: id,
    pin: "V1",
    value: true,
    timezone: "Asia/Kolkata",
    schedule: { kind: "daily", time: "18:00" },
    enabled: true,
    ...extra,
  };
}
async function due(f, id, age = 1) {
  await f.db.query(
    "UPDATE automations SET next_run_at=now()-($2::int * interval '1 second') WHERE id=$1",
    [id, age],
  );
}
test("dashboard persistence, ownership, optimistic locking, CSRF and widget validation", async () => {
  const f = await fixture();
  try {
    const b = board(f.id);
    assert.equal((await f.request("/dashboard-layout")).status, 401);
    assert.equal((await f.a.call("/dashboard-layout")).body.version, 0);
    assert.equal(
      (await f.a.call("/dashboard-layout", "PUT", b, { "X-CSRF-Token": "" }))
        .status,
      403,
    );
    assert.equal((await f.b.call("/dashboard-layout", "PUT", b)).status, 404);
    assert.equal(
      (await f.a.call("/dashboard-layout", "PUT", b)).body.version,
      1,
    );
    const saved = (await f.a.call("/dashboard-layout")).body;
    assert.equal(saved.widgets[0].label, "Light");
    assert.deepEqual(saved.widgets[0].layouts, b.widgets[0].layouts);
    assert.equal((await f.b.call("/dashboard-layout")).body.widgets.length, 0);
    assert.equal((await f.a.call("/dashboard-layout", "PUT", b)).status, 409);
    const invalid = { ...saved, widgets: [{ ...b.widgets[0], pin: "V0" }] };
    assert.equal(
      (await f.a.call("/dashboard-layout", "PUT", invalid)).status,
      400,
    );
    assert.equal(
      (
        await f.a.call("/dashboard-layout", "PUT", {
          ...saved,
          widgets: [
            {
              ...b.widgets[0],
              config: { ...b.widgets[0].config, color: "javascript:alert(1)" },
            },
          ],
        })
      ).status,
      400,
    );
    assert.equal((await f.b.call("/catalog")).body.devices.length, 0);
    assert.equal((await f.a.call("/catalog")).body.devices[0].pins.length, 3);
  } finally {
    await f.close();
  }
});
test("timezone next occurrence, weekly boundaries and invalid/ambiguous local dates", () => {
  assert.equal(
    nextRun(
      { kind: "daily", time: "18:00" },
      "Asia/Kolkata",
      new Date("2026-10-11T10:00:00Z"),
    ).toISOString(),
    "2026-10-11T12:30:00.000Z",
  );
  assert.equal(
    nextRun(
      { kind: "weekly", time: "08:00", days: [1] },
      "Asia/Kolkata",
      new Date("2026-10-11T10:00:00Z"),
    ).toISOString(),
    "2026-10-12T02:30:00.000Z",
  );
  assert.equal(
    nextRun(
      { kind: "once", localDateTime: "2026-10-12T08:00" },
      "Asia/Kolkata",
      new Date("2026-10-11T10:00:00Z"),
    ).toISOString(),
    "2026-10-12T02:30:00.000Z",
  );
  assert.equal(
    nextRun({ kind: "once", localDateTime: "2020-01-01T08:00" }, "UTC"),
    null,
  );
  assert.throws(
    () => nextRun({ kind: "daily", time: "18:00" }, "Invalid/Zone"),
    /timezone/,
  );
  assert.throws(
    () =>
      nextRun(
        { kind: "once", localDateTime: "2027-03-14T02:30" },
        "America/New_York",
        new Date("2027-01-01"),
      ),
    /does not exist/,
  );
  assert.throws(
    () =>
      nextRun(
        { kind: "once", localDateTime: "2026-11-01T01:30" },
        "America/New_York",
        new Date("2026-01-01"),
      ),
    /occurs twice/,
  );
  // Daily wall-clock schedule follows the new offset after spring DST.
  assert.equal(
    nextRun(
      { kind: "daily", time: "08:00" },
      "America/New_York",
      new Date("2027-03-14T06:00:00Z"),
    ).toISOString(),
    "2027-03-14T12:00:00.000Z",
  );
});
test("scheduler durable dispatch once, ACK status, authorization, pause cancellation and offline skip", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.b.call("/automations", "POST", automation(f.id))).status,
      404,
    );
    assert.equal(
      (
        await f.a.call(
          "/automations",
          "POST",
          automation(f.id, { pin: "V0", value: 25 }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await f.a.call("/automations", "POST", automation(f.id, { value: 42 })))
        .status,
      400,
    );
    const a = automation(f.id),
      r = await f.a.call("/automations", "POST", a);
    assert.equal(r.status, 201);
    const id = r.body.id;
    assert.equal((await f.b.call("/automations")).body.automations.length, 0);
    assert.equal((await f.b.call(`/automations/${id}`, "PUT", a)).status, 404);
    await f.sync();
    await due(f, id);
    await Promise.all([runSchedules(f.db), runSchedules(f.db)]);
    let runs = (await f.a.call("/automations")).body.runs;
    assert.equal(runs.length, 1);
    assert.equal(runs[0].outcome, "queued");
    const cmd = runs[0].command_id;
    assert.ok(cmd);
    await f.sync({ acknowledgements: [{ id: cmd, value: true }] });
    await runSchedules(f.db);
    runs = (await f.a.call("/automations")).body.runs;
    assert.equal(runs[0].outcome, "acknowledged");
    await due(f, id);
    await runSchedules(f.db);
    assert.equal(
      (await f.a.call(`/automations/${id}`, "PUT", { ...a, enabled: false }))
        .status,
      200,
    );
    const c = (
      await f.db.query(
        "SELECT status FROM device_commands WHERE id=(SELECT command_id FROM automation_runs ORDER BY created_at DESC LIMIT 1)",
      )
    ).rows[0];
    assert.equal(c.status, "cancelled");
    await due(f, id);
    await runSchedules(f.db);
    assert.equal((await f.a.call("/automations")).body.runs.length, 2);
    await f.a.call(`/automations/${id}`, "PUT", a);
    await due(f, id);
    await f.db.query("UPDATE devices SET last_seen_at=NULL WHERE id=$1", [
      f.id,
    ]);
    await runSchedules(f.db);
    runs = (await f.a.call("/automations")).body.runs;
    assert.equal(runs[0].outcome, "skipped");
    assert.match(runs[0].detail, /offline/);
  } finally {
    await f.close();
  }
});
test("overdue runs are skipped, one-time schedules stop, rotated credentials disable recurring schedules", async () => {
  const f = await fixture();
  try {
    const future = DateTime.now()
      .setZone("Asia/Kolkata")
      .plus({ days: 1 })
      .toFormat("yyyy-MM-dd'T'HH:mm");
    const once = await f.a.call(
      "/automations",
      "POST",
      automation(f.id, { schedule: { kind: "once", localDateTime: future } }),
    );
    assert.equal(once.status, 201);
    await f.sync();
    await due(f, once.body.id, 120);
    await runSchedules(f.db);
    let list = (await f.a.call("/automations")).body;
    assert.equal(list.automations[0].enabled, false);
    assert.match(list.runs[0].detail, /Missed/);
    const daily = await f.a.call("/automations", "POST", automation(f.id));
    await f.db.query(
      "UPDATE devices SET token_version=token_version+1 WHERE id=$1",
      [f.id],
    );
    await due(f, daily.body.id);
    await runSchedules(f.db);
    list = (await f.a.call("/automations")).body;
    assert.equal(
      list.automations.find((a) => a.id === daily.body.id).enabled,
      false,
    );
    assert.match(list.runs[0].detail, /Credential changed/);
    assert.equal(
      (await f.b.call(`/automations/${daily.body.id}`, "DELETE", {})).status,
      404,
    );
    assert.equal(
      (await f.a.call(`/automations/${daily.body.id}`, "DELETE", {})).status,
      200,
    );
  } finally {
    await f.close();
  }
});
