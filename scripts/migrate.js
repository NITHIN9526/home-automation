import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const cx = await db.connect();
try {
  await cx.query("BEGIN");
  await cx.query("SELECT pg_advisory_xact_lock(72146513)");
  await cx.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const file of (await readdir("sql"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`sql/${file}`, "utf8"),
      checksum = createHash("sha256").update(sql).digest("hex");
    const {
      rows: [old],
    } = await cx.query("SELECT checksum FROM schema_migrations WHERE name=$1", [
      file,
    ]);
    if (old) {
      if (old.checksum !== checksum)
        throw Error(`Applied migration changed: ${file}`);
      continue;
    }
    await cx.query(sql.replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, ""));
    await cx.query(
      "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
      [file, checksum],
    );
    console.log("Applied", file);
  }
  await cx.query("COMMIT");
} catch (e) {
  await cx.query("ROLLBACK");
  throw e;
} finally {
  cx.release();
  await db.end();
}
