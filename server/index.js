import { startRuleEngine } from "./routines.js";
import { startScheduler } from "./features.js";
import { startMqtt } from "./mqtt.js";
import { Pool } from "pg";
import { attachLive } from "./live.js";
import { createApp } from "./app.js";
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
});
db.on("error", (e) => console.error("Database connection error:", e.code));
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
const origin = process.env.APP_ORIGIN ?? "http://localhost:5173";
const app = await createApp({
  db,
  encryptionKey: key,
  origin,
  production: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY || false,
});
const mqtt =
  process.env.MQTT_ENABLED === "true"
    ? await startMqtt({
        db,
        host: process.env.MQTT_HOST ?? "127.0.0.1",
        port: Number(process.env.MQTT_PORT ?? 1883),
      })
    : null;
if (mqtt) console.log(`MQTT listening on port ${mqtt.port}`);
const server = app.listen(
  Number(process.env.PORT ?? 3000),
  process.env.HOST ?? "127.0.0.1",
  () => console.log(`Open IoT API running on port ${server.address().port}`),
);
const stopScheduler = startScheduler(db);
const stopRules = await startRuleEngine(db);
const closeLive = attachLive(server, {
  db,
  origin,
  production: process.env.NODE_ENV === "production",
});
console.log(
  `Open the dashboard at ${origin}/dashboard (the browser address must match APP_ORIGIN).`,
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const retention = setInterval(async () => {
  try {
    await db.query(
      "DELETE FROM telemetry_samples WHERE received_at<now()-interval '24 hours'",
    );
    await db.query(
      "UPDATE device_commands SET status='expired' WHERE status='pending' AND expires_at<=now()",
    );
    await db.query(
      "DELETE FROM device_commands WHERE created_at<now()-interval '7 days' AND status<>'pending'",
    );
  } catch (e) {
    console.error("Telemetry cleanup failed:", e.code);
  }
}, 600000);
retention.unref();
const cleanup = setInterval(
  () =>
    db
      .query("DELETE FROM sessions WHERE expires_at<now()")
      .catch((e) => console.error("Session cleanup failed:", e.code)),
  3600000,
);
cleanup.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    clearInterval(cleanup);
    clearInterval(retention);
    await stopRules();
    await stopScheduler();
    closeLive();
    if (mqtt) await mqtt.close();
    server.close(() => db.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  });
