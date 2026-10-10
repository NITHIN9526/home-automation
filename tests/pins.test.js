import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { attachLive } from "../server/live.js";
import { createTestDb } from "./database.js";

async function fixture() {
  const db = await createTestDb(),
    origin = "http://localhost:5173";
  const app = await createApp({
    db,
    encryptionKey: randomBytes(32),
    origin,
    bcryptRounds: 4,
    disableLimits: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`,
    stopLive = attachLive(server, { db, origin, intervalMs: 50 });
  async function request(path, method = "GET", body, headers = {}) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  }
  async function owner(email) {
    const reg = await request("/auth/register", "POST", {
      name: "Test",
      email,
      password: "test-password-123",
    });
    assert.equal(reg.status, 201);
    const headers = {
      Cookie: reg.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": reg.body.csrfToken,
    };
    return {
      headers,
      call: (path, method, body, extra = {}) =>
        request(path, method, body, { ...headers, ...extra }),
    };
  }
  const a = await owner("pins@example.com"),
    b = await owner("other@example.com");
  const created = await a.call("/devices", "POST", {
    name: "Test simulator",
    deviceType: "simulator",
  });
  assert.equal(created.status, 201);
  const id = created.body.device.id,
    token = created.body.token;
  const sync = (body = {}, override = token) =>
    request("/device/sync", "POST", body, {
      Authorization: `Bearer ${override}`,
    });
  const send = (pin, value, cid = randomUUID()) =>
    a.call(`/devices/${id}/commands`, "POST", { id: cid, pin, value });
  return {
    db,
    base,
    origin,
    a,
    b,
    id,
    token,
    request,
    sync,
    send,
    close: async () => {
      stopLive();
      await new Promise((r) => server.close(r));
      await db.raw.close();
    },
  };
}
test("pin ownership, strict validation, persisted telemetry, command ACK and idempotent retries", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.a.call(`/devices/${f.id}/state`)).body.pins.length,
      3,
    );
    assert.equal((await f.b.call(`/devices/${f.id}/state`)).status, 404);
    assert.equal((await f.b.call(`/devices/${f.id}/history`)).status, 404);
    assert.equal((await f.send("V1", true)).status, 409); // offline
    assert.equal((await f.request("/device/sync", "POST", {})).status, 401);
    assert.equal(
      (await f.sync({ telemetry: [{ pin: "V0", value: 24.5 }] })).status,
      200,
    );
    assert.equal(
      (await f.sync({ telemetry: [{ pin: "V0", value: 500 }] })).status,
      400,
    );
    assert.equal(
      (await f.sync({ telemetry: [{ pin: "V1", value: true }] })).status,
      400,
    );
    assert.equal(
      (
        await f.sync({
          telemetry: [
            { pin: "V0", value: 25 },
            { pin: "V0", value: 26 },
          ],
        })
      ).status,
      400,
    );
    const history = await f.a.call(`/devices/${f.id}/history?pin=V0`);
    assert.deepEqual(
      history.body.samples.map((p) => p.value),
      [24.5],
    );
    const cmd = await f.send("V1", true);
    assert.equal(cmd.status, 202);
    const cid = cmd.body.command.id;
    assert.equal((await f.send("V1", false)).status, 409);
    assert.equal((await f.send("V1", true, cid)).status, 202);
    assert.equal((await f.send("V2", 101)).status, 400);
    assert.equal((await f.send("V0", 25)).status, 400);
    assert.equal(
      (
        await f.b.call(`/devices/${f.id}/commands`, "POST", {
          id: randomUUID(),
          pin: "V1",
          value: false,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.a.call(
          `/devices/${f.id}/commands`,
          "POST",
          { id: randomUUID(), pin: "V2", value: 50 },
          { "X-CSRF-Token": "" },
        )
      ).status,
      403,
    );
    assert.equal((await f.sync()).body.commands[0].id, cid);
    assert.equal(
      (await f.sync({ acknowledgements: [{ id: cid, value: false }] })).status,
      400,
    );
    assert.deepEqual(
      (await f.sync({ acknowledgements: [{ id: cid, value: true }] })).body
        .acknowledged,
      [cid],
    );
    let state = (await f.a.call(`/devices/${f.id}/state`)).body;
    assert.equal(state.pins.find((p) => p.pin === "V1").value, true);
    assert.equal(state.commands[0].status, "acknowledged");
    const newer = (await f.send("V1", false)).body.command;
    await f.sync({ acknowledgements: [{ id: newer.id, value: false }] });
    await f.sync({ acknowledgements: [{ id: cid, value: true }] }); // old duplicate ACK must not overwrite new state
    state = (await f.a.call(`/devices/${f.id}/state`)).body;
    assert.equal(state.pins.find((p) => p.pin === "V1").value, false);
    const add = {
      pin: "V3",
      label: "Desk lamp",
      dataType: "boolean",
      direction: "output",
    };
    assert.equal(
      (await f.b.call(`/devices/${f.id}/pins`, "POST", add)).status,
      404,
    );
    assert.equal(
      (await f.a.call(`/devices/${f.id}/pins`, "POST", add)).status,
      201,
    );
    assert.equal(
      (await f.a.call(`/devices/${f.id}/pins`, "POST", add)).status,
      409,
    );
    assert.equal(
      (await f.a.call(`/devices/${f.id}/pins`, "POST", { ...add, pin: "V32" }))
        .status,
      400,
    );
    assert.equal((await f.send("V3", true)).status, 202);
  } finally {
    await f.close();
  }
});
test("command expiry, token rotation, disable, and device-scoped acknowledgements", async () => {
  const f = await fixture();
  try {
    await f.sync();
    const cid = (await f.send("V1", true)).body.command.id;
    await f.db.query(
      "UPDATE device_commands SET expires_at=now()-interval '1 second' WHERE id=$1",
      [cid],
    );
    assert.deepEqual(
      (await f.sync({ acknowledgements: [{ id: cid, value: true }] })).body
        .ignored,
      [cid],
    );
    assert.equal(
      (await f.a.call(`/devices/${f.id}/state`)).body.pins.find(
        (p) => p.pin === "V1",
      ).value,
      null,
    );
    await f.send("V1", true);
    const rotated = await f.a.call(`/devices/${f.id}/token/rotate`, "POST", {
      password: "test-password-123",
    });
    assert.equal((await f.sync()).status, 401);
    assert.equal(
      (await f.sync({}, rotated.body.token)).body.commands.length,
      0,
    );
    await f.send("V2", 30);
    const other = await f.b.call("/devices", "POST", {
      name: "Other device",
      deviceType: "simulator",
    });
    const active = (
      await f.a.call(`/devices/${f.id}/state`)
    ).body.commands.find((c) => c.status === "pending");
    assert.deepEqual(
      (
        await f.sync(
          { acknowledgements: [{ id: active.id, value: 30 }] },
          other.body.token,
        )
      ).body.ignored,
      [active.id],
    );
    await f.a.call(`/devices/${f.id}`, "PATCH", { disabled: true });
    assert.equal((await f.sync({}, rotated.body.token)).status, 401);
    assert.equal(
      (await f.a.call(`/devices/${f.id}/state`)).body.commands.some(
        (c) => c.status === "pending",
      ),
      false,
    );
    await f.a.call(`/devices/${f.id}`, "DELETE", {});
    assert.equal(
      (
        await f.db.query("SELECT * FROM device_commands WHERE device_id=$1", [
          f.id,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await f.close();
  }
});
test("WebSocket origin/session/ownership checks and live session revocation", async () => {
  const f = await fixture();
  try {
    const url = f.base.replace("http:", "ws:") + `/api/live?deviceId=${f.id}`;
    async function rejected(headers) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers, handshakeTimeout: 2000 });
        ws.on("unexpected-response", (_, res) => {
          res.resume();
          resolve(res.statusCode);
          ws.terminate();
        });
        ws.on("error", () => {});
        ws.on("open", () => {
          ws.close();
          reject(Error("Unauthorized socket opened"));
        });
      });
    }
    assert.equal(await rejected({ Origin: f.origin }), 401);
    assert.equal(
      await rejected({ ...f.a.headers, Origin: "http://evil.invalid" }),
      403,
    );
    assert.equal(await rejected({ ...f.b.headers, Origin: f.origin }), 404);
    const ws = new WebSocket(url, {
      headers: { ...f.a.headers, Origin: f.origin },
    });
    const [raw] = await once(ws, "message");
    assert.equal(JSON.parse(raw).device.id, f.id);
    const closed = once(ws, "close");
    await f.a.call("/auth/logout", "POST", {});
    const [code] = await closed;
    assert.equal(code, 1008);
  } finally {
    await f.close();
  }
});
