import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createApp } from "../server/app.js";
import { attachLive } from "../server/live.js";
import { createTestDb } from "./database.js";

export async function fixture() {
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
