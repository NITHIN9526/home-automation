import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
export const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = (value) => createHash("sha256").update(value).digest();
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .refine(
    (s) => Buffer.byteLength(s, "utf8") <= 72,
    "Password must fit within 72 UTF-8 bytes.",
  );
export const currentPasswordSchema = z
  .string()
  .min(1)
  .refine((s) => Buffer.byteLength(s, "utf8") <= 72);
export const emailSchema = z
  .email()
  .max(254)
  .transform((s) => s.trim().toLowerCase());
export const nameSchema = z.string().trim().min(1).max(80);
export const deviceSchema = z
  .object({
    name: nameSchema,
    deviceType: z.enum([
      "simulator",
      "esp32",
      "esp8266",
      "raspberry-pi",
      "other",
    ]),
  })
  .strict();
export const fail = (status, message) =>
  Object.assign(Error(message), { status });
export function equal(a, b) {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b ?? "");
  return x.length === y.length && timingSafeEqual(x, y);
}
export function encryptToken(token, key, deviceId) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(deviceId));
  return {
    ciphertext: Buffer.concat([cipher.update(token, "utf8"), cipher.final()]),
    iv,
    tag: cipher.getAuthTag(),
  };
}
export function decryptToken(row, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, row.token_iv);
  decipher.setAAD(Buffer.from(row.id));
  decipher.setAuthTag(row.token_tag);
  return Buffer.concat([
    decipher.update(row.token_ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
export function makeCredential(key, id) {
  const token = randomToken();
  return {
    token,
    hash: hashToken(token),
    preview: `${token.slice(0, 6)}…${token.slice(-4)}`,
    ...encryptToken(token, key, id),
  };
}
