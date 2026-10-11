import { installRoutineRoutes } from "./routines.js";
import { installFeatureRoutes } from "./features.js";
import express from "express";
import { installPinRoutes, seedPins } from "./pins.js";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  randomToken,
  hashToken,
  tokenPattern,
  passwordSchema,
  currentPasswordSchema,
  emailSchema,
  nameSchema,
  deviceSchema,
  fail,
  equal,
  makeCredential,
  decryptToken,
} from "./security.js";

export async function createApp({
  db,
  encryptionKey,
  origin = "http://localhost:5173",
  production = false,
  trustProxy = false,
  bcryptRounds = 12,
  disableLimits = false,
  staticDir = resolve("web/dist"),
}) {
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32)
    throw Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  if (
    new URL(origin).origin !== origin ||
    (production && !origin.startsWith("https://"))
  )
    throw Error(
      "APP_ORIGIN must be an exact origin; production requires HTTPS.",
    );
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", trustProxy);
  app.use(helmet({ strictTransportSecurity: production ? undefined : false }));
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  const cookieName = production ? "__Host-openiot_session" : "openiot_session";
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400000,
  };
  const cookieClear = {
    httpOnly: true,
    secure: production,
    sameSite: "lax",
    path: "/",
  };
  const dummyHash = await bcrypt.hash(randomToken(), bcryptRounds);
  const limit = (max, windowMs = 60000) =>
    rateLimit({
      windowMs,
      limit: max,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => disableLimits,
      message: { error: "Too many requests. Try again shortly." },
    });
  app.use("/api", limit(240));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    // Device heartbeat uses a bearer token, never a browser session.
    if (["/device/heartbeat", "/device/sync"].includes(req.path)) return next();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("Origin") !== origin)
        return next(fail(403, "Request origin is not allowed."));
      if (!req.is("application/json"))
        return next(fail(415, "Use application/json."));
    }
    next();
  });
  async function tx(work) {
    const cx = await db.connect();
    try {
      await cx.query("BEGIN");
      const result = await work(cx);
      await cx.query("COMMIT");
      return result;
    } catch (e) {
      await cx.query("ROLLBACK");
      throw e;
    } finally {
      cx.release();
    }
  }
  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.created_at,
  });
  async function addSession(cx, userId) {
    const token = randomToken(),
      csrfToken = randomToken();
    await cx.query(
      `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')`,
      [hashToken(token), userId, csrfToken],
    );
    return { token, csrfToken };
  }
  function setSession(res, session) {
    res.cookie(cookieName, session.token, cookieOptions);
  }
  async function authenticate(req, res, next) {
    const token = req.cookies[cookieName];
    if (!tokenPattern.test(token ?? "")) throw fail(401, "Please sign in.");
    const {
      rows: [u],
    } = await db.query(
      `SELECT u.*,s.csrf_token,s.token_hash AS session_hash FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [hashToken(token)],
    );
    if (!u) {
      res.clearCookie(cookieName, cookieClear);
      throw fail(401, "Your session expired. Please sign in.");
    }
    req.user = u;
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !equal(req.get("X-CSRF-Token"), u.csrf_token)
    )
      throw fail(403, "Invalid CSRF token. Refresh the page.");
    next();
  }
  const authLimit = limit(20, 15 * 60000),
    sensitiveLimit = limit(10, 15 * 60000);
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const data = z
      .object({
        name: nameSchema,
        email: emailSchema,
        password: passwordSchema,
      })
      .strict()
      .parse(req.body);
    const hash = await bcrypt.hash(data.password, bcryptRounds);
    const { user, session } = await tx(async (cx) => {
      const {
        rows: [user],
      } = await cx.query(
        "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *",
        [data.name, data.email, hash],
      );
      const session = await addSession(cx, user.id);
      await cx.query(
        "INSERT INTO audit_events(user_id,action) VALUES($1,'account.register')",
        [user.id],
      );
      return { user, session };
    });
    setSession(res, session);
    res
      .status(201)
      .json({ user: publicUser(user), csrfToken: session.csrfToken });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const data = z
      .object({ email: emailSchema, password: currentPasswordSchema })
      .strict()
      .parse(req.body);
    const {
      rows: [candidate],
    } = await db.query("SELECT * FROM users WHERE email=$1", [data.email]);
    const valid = await bcrypt.compare(
      data.password,
      candidate?.password_hash ?? dummyHash,
    );
    if (!candidate || !valid)
      throw fail(401, "Email or password is incorrect.");
    const session = await tx(async (cx) => {
      // Serialize against password changes: an old password cannot create a new session afterward.
      const {
        rows: [current],
      } = await cx.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [candidate.id],
      );
      if (!current || current.password_hash !== candidate.password_hash)
        throw fail(401, "Please sign in again.");
      if (tokenPattern.test(req.cookies[cookieName] ?? ""))
        await cx.query("DELETE FROM sessions WHERE token_hash=$1", [
          hashToken(req.cookies[cookieName]),
        ]);
      return addSession(cx, candidate.id);
    });
    setSession(res, session);
    res.json({ user: publicUser(candidate), csrfToken: session.csrfToken });
  });
  app.get("/api/auth/me", authenticate, (req, res) =>
    res.json({ user: publicUser(req.user), csrfToken: req.user.csrf_token }),
  );
  app.post("/api/auth/logout", authenticate, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.user.session_hash,
    ]);
    res.clearCookie(cookieName, cookieClear);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout-all", authenticate, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
    res.clearCookie(cookieName, cookieClear);
    res.json({ ok: true });
  });
  app.patch("/api/account", authenticate, async (req, res) => {
    const { name } = z.object({ name: nameSchema }).strict().parse(req.body);
    const {
      rows: [user],
    } = await db.query(
      "UPDATE users SET name=$1,updated_at=now() WHERE id=$2 RETURNING *",
      [name, req.user.id],
    );
    res.json({ user: publicUser(user) });
  });
  async function verifyPassword(req) {
    const { password } = z
      .object({ password: currentPasswordSchema })
      .passthrough()
      .parse(req.body);
    if (!(await bcrypt.compare(password, req.user.password_hash)))
      throw fail(403, "Current password is incorrect.");
  }
  // Lock account and session for sensitive transactions so password change/logout cannot race them.
  async function recheck(cx, req) {
    const {
      rows: [u],
    } = await cx.query(
      "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
      [req.user.id],
    );
    const { rows } = await cx.query(
      "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
      [req.user.session_hash],
    );
    if (!u || u.password_hash !== req.user.password_hash || !rows.length)
      throw fail(401, "Please sign in again.");
  }
  app.put(
    "/api/account/password",
    sensitiveLimit,
    authenticate,
    async (req, res) => {
      const data = z
        .object({
          password: currentPasswordSchema,
          newPassword: passwordSchema,
        })
        .strict()
        .parse(req.body);
      await verifyPassword(req);
      const hash = await bcrypt.hash(data.newPassword, bcryptRounds);
      const session = await tx(async (cx) => {
        await recheck(cx, req);
        await cx.query(
          "UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2",
          [hash, req.user.id],
        );
        await cx.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
        await cx.query(
          "INSERT INTO audit_events(user_id,action) VALUES($1,'account.password-change')",
          [req.user.id],
        );
        return addSession(cx, req.user.id);
      });
      setSession(res, session);
      res.json({ ok: true, csrfToken: session.csrfToken });
    },
  );
  app.delete("/api/account", sensitiveLimit, authenticate, async (req, res) => {
    z.object({ password: currentPasswordSchema }).strict().parse(req.body);
    await verifyPassword(req);
    await tx(async (cx) => {
      await recheck(cx, req);
      await cx.query("DELETE FROM users WHERE id=$1", [req.user.id]);
    });
    res.clearCookie(cookieName, cookieClear);
    res.json({ ok: true });
  });
  const selectDevice = `id,name,device_type AS "deviceType",token_preview AS "tokenPreview",token_version AS "tokenVersion",
  token_created_at AS "tokenCreatedAt",last_seen_at AS "lastSeenAt",disabled_at AS "disabledAt",created_at AS "createdAt",
  CASE WHEN disabled_at IS NOT NULL THEN 'disabled' WHEN last_seen_at>now()-interval '30 seconds' THEN 'online' ELSE 'offline' END AS status`;
  app.get("/api/devices", authenticate, async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(req.query.page ?? 1);
    const { rows } = await db.query(
      `SELECT ${selectDevice} FROM devices WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 20 OFFSET $2`,
      [req.user.id, (page - 1) * 20],
    );
    const {
      rows: [stats],
    } = await db.query(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE disabled_at IS NULL AND last_seen_at>now()-interval '30 seconds')::int AS online,
   count(*) FILTER(WHERE disabled_at IS NOT NULL)::int AS disabled FROM devices WHERE user_id=$1`,
      [req.user.id],
    );
    res.json({ devices: rows, page, pageSize: 20, ...stats });
  });
  app.post("/api/devices", authenticate, async (req, res) => {
    const data = deviceSchema.parse(req.body),
      id = randomUUID(),
      c = makeCredential(encryptionKey, id);
    const device = await tx(async (cx) => {
      await cx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      const {
        rows: [{ count }],
      } = await cx.query(
        "SELECT count(*)::int AS count FROM devices WHERE user_id=$1",
        [req.user.id],
      );
      if (count >= 1000)
        throw fail(409, "Device limit reached (1,000 per account).");
      const {
        rows: [d],
      } = await cx.query(
        `INSERT INTO devices(id,user_id,name,device_type,token_hash,token_ciphertext,token_iv,token_tag,token_preview)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${selectDevice}`,
        [
          id,
          req.user.id,
          data.name,
          data.deviceType,
          c.hash,
          c.ciphertext,
          c.iv,
          c.tag,
          c.preview,
        ],
      );
      await cx.query(
        "INSERT INTO audit_events(user_id,action,device_id) VALUES($1,'device.create',$2)",
        [req.user.id, id],
      );
      await seedPins(cx, id);
      return d;
    });
    res.status(201).json({ device, token: c.token });
  });
  app.patch("/api/devices/:id", authenticate, async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      data = z
        .object({
          name: nameSchema.optional(),
          disabled: z.boolean().optional(),
        })
        .strict()
        .refine((x) => Object.keys(x).length > 0)
        .parse(req.body);
    const device = await tx(async (cx) => {
      const {
        rows: [device],
      } = await cx.query(
        `UPDATE devices SET name=COALESCE($1,name),
   disabled_at=CASE WHEN $2::boolean IS NULL THEN disabled_at WHEN $2 THEN now() ELSE NULL END,
   last_seen_at=CASE WHEN $2::boolean IS NULL THEN last_seen_at ELSE NULL END,updated_at=now()
   WHERE id=$3 AND user_id=$4 RETURNING ${selectDevice}`,
        [data.name ?? null, data.disabled ?? null, id, req.user.id],
      );
      if (!device) throw fail(404, "Device not found.");
      if (data.disabled !== undefined)
        await cx.query(
          "UPDATE device_commands SET status='cancelled' WHERE device_id=$1 AND status='pending'",
          [id],
        );
      return device;
    });
    res.json({ device });
  });
  for (const operation of ["reveal", "rotate"])
    app.post(
      `/api/devices/:id/token/${operation}`,
      sensitiveLimit,
      authenticate,
      async (req, res) => {
        const id = z.uuid().parse(req.params.id);
        z.object({ password: currentPasswordSchema }).strict().parse(req.body);
        await verifyPassword(req);
        const result = await tx(async (cx) => {
          await recheck(cx, req);
          const {
            rows: [d],
          } = await cx.query(
            "SELECT * FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [id, req.user.id],
          );
          if (!d) throw fail(404, "Device not found.");
          let token;
          if (operation === "rotate") {
            const c = makeCredential(encryptionKey, id);
            token = c.token;
            await cx.query(
              `UPDATE devices SET token_hash=$1,token_ciphertext=$2,token_iv=$3,token_tag=$4,token_preview=$5,
     token_version=token_version+1,token_created_at=now(),last_seen_at=NULL,updated_at=now() WHERE id=$6`,
              [c.hash, c.ciphertext, c.iv, c.tag, c.preview, id],
            );
            await cx.query(
              "UPDATE device_commands SET status='cancelled' WHERE device_id=$1 AND status='pending'",
              [id],
            );
          } else token = decryptToken(d, encryptionKey);
          await cx.query(
            "INSERT INTO audit_events(user_id,action,device_id) VALUES($1,$2,$3)",
            [req.user.id, `device.token-${operation}`, id],
          );
          return { token };
        });
        res.json(result);
      },
    );
  app.delete("/api/devices/:id", authenticate, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await tx(async (cx) => {
      const result = await cx.query(
        "DELETE FROM devices WHERE id=$1 AND user_id=$2 RETURNING id",
        [id, req.user.id],
      );
      if (!result.rows.length) throw fail(404, "Device not found.");
      await cx.query(
        "INSERT INTO audit_events(user_id,action,device_id) VALUES($1,'device.delete',$2)",
        [req.user.id, id],
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/device/heartbeat", limit(60), async (req, res) => {
    const header = req.get("Authorization") ?? "";
    if (!header.startsWith("Bearer ") || !tokenPattern.test(header.slice(7)))
      throw fail(401, "Invalid device credential.");
    const {
      rows: [device],
    } = await db.query(
      `UPDATE devices SET last_seen_at=now() WHERE token_hash=$1 AND disabled_at IS NULL RETURNING id,last_seen_at`,
      [hashToken(header.slice(7))],
    );
    if (!device) throw fail(401, "Invalid or disabled device credential.");
    res.json({
      deviceId: device.id,
      status: "online",
      lastSeenAt: device.last_seen_at,
    });
  });
  installPinRoutes(app, { db, tx, authenticate, limit });
  installFeatureRoutes(app, { db, tx, authenticate, limit });
  installRoutineRoutes(app, { db, tx, authenticate, limit });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    app.get("/{*path}", (req, res) =>
      res.sendFile(resolve(staticDir, "index.html")),
    );
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues[0]?.message ?? "Invalid request." });
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    const status = err.status ?? 500;
    if (status >= 500) console.error("Request failed:", err.code ?? err.name);
    res.status(status).json({
      error:
        status >= 500 ? "Service unavailable. Please try again." : err.message,
    });
  });
  return app;
}
