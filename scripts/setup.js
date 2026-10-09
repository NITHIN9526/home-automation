import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env already exists; no secrets changed.");
  process.exit(0);
}
const password = randomBytes(18).toString("hex");
writeFileSync(
  ".env",
  `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://openiot:${password}@127.0.0.1:5432/openiot_m1\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\nAPP_ORIGIN=http://localhost:5173\nPORT=3000\nHOST=127.0.0.1\nNODE_ENV=development\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created .env with random local credentials. Keep this file private and back up the encryption key.",
);
