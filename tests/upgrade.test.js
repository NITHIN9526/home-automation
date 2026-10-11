import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { makeCredential, decryptToken } from '../server/security.js';

test('Existing accounts, tokens and pins survive migrations 002, 003 and 004',async()=>{
 const db=new PGlite();
 try {
  await db.exec(await readFile(new URL('../sql/001-initial.sql',import.meta.url),'utf8'));
  const key=randomBytes(32),id=randomUUID(),c=makeCredential(key,id);
  const {rows:[user]}=await db.query("INSERT INTO users(name,email,password_hash) VALUES('Existing user','existing@example.com','original-hash') RETURNING id");
  await db.query(`INSERT INTO devices(id,user_id,name,device_type,token_hash,token_ciphertext,token_iv,token_tag,token_preview)
   VALUES($1,$2,'Heart','simulator',$3,$4,$5,$6,$7)`,[id,user.id,c.hash,c.ciphertext,c.iv,c.tag,c.preview]);
  await db.exec(await readFile(new URL('../sql/002-virtual-pins.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../sql/003-dashboards-automations.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../sql/004-rooms-scenes-rules.sql',import.meta.url),'utf8'));
  const {rows:[after]}=await db.query('SELECT * FROM devices WHERE id=$1',[id]);
  assert.equal(after.name,'Heart');assert.equal(after.user_id,user.id);
  assert.equal(decryptToken(after,key),c.token);
  assert.deepEqual(Buffer.from(after.token_hash),c.hash);
  assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1',[user.id])).rows[0].password_hash,'original-hash');
  assert.equal((await db.query('SELECT * FROM device_pins WHERE device_id=$1',[id])).rows.length,3);
 } finally {await db.close();}
});
