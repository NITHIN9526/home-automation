import { Pool } from "pg";
import { createApp } from "./app.js";
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
});
db.on("error", (e) => console.error("Database connection error:", e.code));
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
const app = await createApp({
  db,
  encryptionKey: key,
  origin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  production: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY || false,
});
const server = app.listen(
  Number(process.env.PORT ?? 3000),
  process.env.HOST ?? "127.0.0.1",
  () => console.log(`Open IoT API running on port ${server.address().port}`),
);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const cleanup = setInterval(
  () =>
    db
      .query("DELETE FROM sessions WHERE expires_at<now()")
      .catch((e) => console.error("Session cleanup failed:", e.code)),
  3600000,
);
cleanup.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    clearInterval(cleanup);
    server.close(() => db.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  });
