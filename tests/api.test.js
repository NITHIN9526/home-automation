import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { createTestDb } from "./database.js";
import { hashToken } from "../server/security.js";
async function fixture() {
  const db = await createTestDb(),
    key = randomBytes(32),
    origin = "http://localhost:5173";
  const app = await createApp({
    db,
    encryptionKey: key,
    origin,
    bcryptRounds: 4,
    disableLimits: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  function agent() {
    let cookie = "",
      csrf = "";
    return {
      get cookie() {
        return cookie;
      },
      get csrf() {
        return csrf;
      },
      async call(path, method = "GET", body, headers = {}) {
        const r = await fetch(base + "/api" + path, {
          method,
          headers: {
            Origin: origin,
            Cookie: cookie,
            "X-CSRF-Token": csrf,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const sc = r.headers.get("set-cookie");
        if (sc) cookie = sc.split(";")[0];
        const json = await r.json();
        if (json.csrfToken) csrf = json.csrfToken;
        return { status: r.status, body: json, headers: r.headers };
      },
    };
  }
  return {
    db,
    agent,
    async close() {
      await new Promise((r) => server.close(r));
      await db.raw.close();
    },
  };
}
const signup = (a, email = "owner@example.com") =>
  a.call("/auth/register", "POST", {
    name: "Maker",
    email,
    password: "strong-password-123",
  });
test("registration, cookies, ownership, CSRF, encrypted token reveal, rotation and presence", async () => {
  const f = await fixture();
  try {
    const owner = f.agent(),
      other = f.agent(),
      unauth = f.agent();
    assert.equal((await unauth.call("/devices")).status, 401);
    const reg = await signup(owner);
    assert.equal(reg.status, 201);
    assert.match(reg.headers.get("set-cookie"), /HttpOnly/);
    assert.match(reg.headers.get("set-cookie"), /SameSite=Lax/);
    assert.equal((await signup(other, "second@example.com")).status, 201);
    const leaked = await f.db.query(
      "SELECT password_hash FROM users WHERE email=$1",
      ["owner@example.com"],
    );
    assert.match(leaked.rows[0].password_hash, /^\$2[aby]\$/);
    assert.equal(
      (
        await owner.call(
          "/devices",
          "POST",
          { name: "No CSRF", deviceType: "simulator" },
          { "X-CSRF-Token": "" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await owner.call(
          "/devices",
          "POST",
          { name: "Wrong Origin", deviceType: "simulator" },
          { Origin: "https://attacker.invalid" },
        )
      ).status,
      403,
    );
    const created = await owner.call("/devices", "POST", {
      name: "My laptop",
      deviceType: "simulator",
    });
    assert.equal(created.status, 201);
    const id = created.body.device.id,
      token = created.body.token;
    const list = await owner.call("/devices");
    assert.equal(list.body.devices[0].status, "offline");
    assert.ok(!JSON.stringify(list.body).includes(token));
    assert.equal((await other.call("/devices")).body.total, 0);
    for (const [path, method, body] of [
      [`/devices/${id}`, "PATCH", { name: "Stolen" }],
      [`/devices/${id}`, "DELETE", {}],
      [
        `/devices/${id}/token/reveal`,
        "POST",
        { password: "strong-password-123" },
      ],
    ])
      assert.equal((await other.call(path, method, body)).status, 404);
    assert.equal(
      (
        await owner.call(`/devices/${id}/token/reveal`, "POST", {
          password: "wrong",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await owner.call(`/devices/${id}/token/reveal`, "POST", {
          password: "strong-password-123",
        })
      ).body.token,
      token,
    );
    const beat = await unauth.call(
      "/device/heartbeat",
      "POST",
      {},
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(beat.status, 200);
    assert.equal(
      (await owner.call("/devices")).body.devices[0].status,
      "online",
    );
    await f.db.query(
      "UPDATE devices SET last_seen_at=now()-interval '31 seconds' WHERE id=$1",
      [id],
    );
    assert.equal(
      (await owner.call("/devices")).body.devices[0].status,
      "offline",
    );
    const rotated = await owner.call(`/devices/${id}/token/rotate`, "POST", {
      password: "strong-password-123",
    });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.token, token);
    assert.equal(
      (
        await unauth.call(
          "/device/heartbeat",
          "POST",
          {},
          { Authorization: `Bearer ${token}` },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await unauth.call(
          "/device/heartbeat",
          "POST",
          {},
          { Authorization: `Bearer ${rotated.body.token}` },
        )
      ).status,
      200,
    );
    await owner.call(`/devices/${id}`, "PATCH", { disabled: true });
    assert.equal(
      (
        await unauth.call(
          "/device/heartbeat",
          "POST",
          {},
          { Authorization: `Bearer ${rotated.body.token}` },
        )
      ).status,
      401,
    );
    assert.equal(
      (await owner.call("/devices")).body.devices[0].status,
      "disabled",
    );
    await owner.call(`/devices/${id}`, "PATCH", { disabled: false });
    assert.equal(
      (await owner.call("/devices")).body.devices[0].status,
      "offline",
    );
    await owner.call(`/devices/${id}`, "DELETE", {});
    assert.equal((await owner.call("/devices")).body.total, 0);
  } finally {
    await f.close();
  }
});
test("login, duplicate email, password change, session revocation, account deletion", async () => {
  const f = await fixture();
  try {
    const a = f.agent(),
      b = f.agent(),
      c = f.agent();
    await signup(a);
    assert.equal((await signup(c, "OWNER@example.com")).status, 409);
    assert.equal(
      (
        await b.call("/auth/login", "POST", {
          email: "owner@example.com",
          password: "wrong",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await b.call("/auth/login", "POST", {
          email: "OWNER@example.com",
          password: "strong-password-123",
        })
      ).status,
      200,
    );
    const oldCookie = a.cookie;
    assert.equal(
      (
        await a.call("/account/password", "PUT", {
          password: "strong-password-123",
          newPassword: "replacement-password-123",
        })
      ).status,
      200,
    );
    assert.notEqual(a.cookie, oldCookie);
    assert.equal((await b.call("/auth/me")).status, 401);
    assert.equal((await a.call("/auth/me")).status, 200);
    assert.equal(
      (await a.call("/account", "PATCH", { name: "New name" })).body.user.name,
      "New name",
    );
    assert.equal(
      (
        await c.call("/auth/login", "POST", {
          email: "owner@example.com",
          password: "strong-password-123",
        })
      ).status,
      401,
    );
    await c.call("/auth/login", "POST", {
      email: "owner@example.com",
      password: "replacement-password-123",
    });
    await a.call("/auth/logout-all", "POST", {});
    assert.equal((await c.call("/auth/me")).status, 401);
    await a.call("/auth/login", "POST", {
      email: "owner@example.com",
      password: "replacement-password-123",
    });
    const d = await a.call("/devices", "POST", {
      name: "Delete with account",
      deviceType: "simulator",
    });
    assert.equal(
      (
        await a.call("/account", "DELETE", {
          password: "replacement-password-123",
        })
      ).status,
      200,
    );
    assert.equal((await a.call("/auth/me")).status, 401);
    assert.equal((await f.db.query("SELECT * FROM devices")).rows.length, 0);
    assert.equal(
      (
        await c.call(
          "/device/heartbeat",
          "POST",
          {},
          { Authorization: `Bearer ${d.body.token}` },
        )
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});
