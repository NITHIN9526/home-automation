import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export async function createTestDb() {
  const pg = new PGlite();
  for (const file of (await readdir(new URL("../sql/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pg.exec(
      await readFile(new URL("../sql/" + file, import.meta.url), "utf8"),
    );
  }
  let tail = Promise.resolve();
  async function lock() {
    let release;
    const prior = tail;
    tail = new Promise((r) => {
      release = r;
    });
    await prior;
    return release;
  }
  async function query(sql, values) {
    const r = await pg.query(sql, values);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  }
  return {
    raw: pg,
    async query(s, p) {
      const release = await lock();
      try {
        return await query(s, p);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await lock();
      return { query, release };
    },
  };
}
