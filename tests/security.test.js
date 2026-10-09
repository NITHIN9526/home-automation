import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  makeCredential,
  decryptToken,
  passwordSchema,
  hashToken,
} from "../server/security.js";
test("device credentials have entropy, hash lookup and authenticated encryption", () => {
  const key = randomBytes(32),
    id = randomUUID(),
    c = makeCredential(key, id),
    d = makeCredential(key, id);
  assert.equal(c.token.length, 43);
  assert.notEqual(c.token, d.token);
  assert.deepEqual(c.hash, hashToken(c.token));
  const row = {
    id,
    token_iv: c.iv,
    token_tag: c.tag,
    token_ciphertext: c.ciphertext,
  };
  assert.equal(decryptToken(row, key), c.token);
  assert.throws(() => decryptToken({ ...row, id: randomUUID() }, key));
  assert.throws(() => decryptToken(row, randomBytes(32)));
});
test("bcrypt passwords cannot silently truncate UTF-8 input", () => {
  assert.equal(passwordSchema.safeParse("a".repeat(12)).success, true);
  assert.equal(passwordSchema.safeParse("a".repeat(72)).success, true);
  assert.equal(passwordSchema.safeParse("a".repeat(73)).success, false);
  assert.equal(passwordSchema.safeParse("😀".repeat(19)).success, false);
  assert.equal(passwordSchema.safeParse("short").success, false);
});
