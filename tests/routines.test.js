import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './features-fixture.js';
import {evaluateRules} from '../server/routines.js';
const scene=id=>({name:'Evening',actions:[{deviceId:id,pin:'V1',value:true},{deviceId:id,pin:'V2',value:40}]});
const rule=id=>({name:'Warm room',sourceDevice:id,sourcePin:'V0',operator:'above',threshold:25,hysteresis:1,cooldown:60,enabled:true,actions:[{deviceId:id,pin:'V1',value:true}]});
async function read(f,v){assert.equal((await f.sync({telemetry:[{pin:'V0',value:v}]})).status,200);await evaluateRules(f.db);}
test('groups and scenes enforce ownership, CSRF, action types, and idempotent execution',async()=>{
 const f=await fixture();try{
 assert.equal((await f.request('/routines')).status,401);
 const g=await f.a.call('/groups','POST',{name:'Living room',kind:'room',deviceIds:[f.id]});assert.equal(g.status,201);
 assert.equal((await f.b.call('/groups','POST',{name:'Other',kind:'group',deviceIds:[f.id]})).status,404);
 assert.equal((await f.b.call('/groups/'+g.body.id,'DELETE',{})).status,404);
 assert.equal((await f.a.call('/scenes','POST',scene(f.id),{'X-CSRF-Token':''})).status,403);
 assert.equal((await f.b.call('/scenes','POST',scene(f.id))).status,404);
 assert.equal((await f.a.call('/scenes','POST',{name:'Bad',actions:[{deviceId:f.id,pin:'V0',value:1}]})).status,400);
 const s=await f.a.call('/scenes','POST',scene(f.id));assert.equal(s.status,201);
 assert.equal((await f.b.call('/scenes/'+s.body.id+'/run','POST',{id:randomUUID()})).status,404);
 await f.sync();const runId=randomUUID();
 assert.equal((await f.a.call('/scenes/'+s.body.id+'/run','POST',{id:runId})).status,200);
 assert.equal((await f.a.call('/scenes/'+s.body.id+'/run','POST',{id:runId})).status,200);
 let commands=(await f.sync()).body.commands;assert.equal(commands.length,2);
 assert.equal((await f.sync({acknowledgements:commands.map(c=>({id:c.id,value:c.value}))})).status,200);
 let d=(await f.a.call('/routines')).body;assert.equal(d.runs.length,1);assert.ok(d.runs[0].results.every(x=>x.status==='confirmed'));
 assert.equal((await f.b.call('/routines')).body.runs.length,0);
 await f.db.query('UPDATE devices SET token_version=token_version+1 WHERE id=$1',[f.id]);
 assert.equal((await f.a.call('/scenes/'+s.body.id+'/run','POST',{id:randomUUID()})).status,200);
 d=(await f.a.call('/routines')).body;assert.ok(d.runs[0].results.every(x=>x.status==='skipped'));
 assert.equal((await f.a.call('/groups/'+g.body.id,'DELETE',{})).status,200);
 }finally{await f.close();}
});
test('scene partial outcomes and deletion cancel pending work',async()=>{
 const f=await fixture();try{
 await f.sync();await f.send('V1',false);
 const s=await f.a.call('/scenes','POST',scene(f.id));
 await f.a.call('/scenes/'+s.body.id+'/run','POST',{id:randomUUID()});
 const run=(await f.a.call('/routines')).body.runs[0];assert.deepEqual(run.results.map(x=>x.status),['skipped','queued']);
 await f.a.call('/scenes/'+s.body.id,'DELETE',{});
 const result=(await f.a.call('/routines')).body.runs[0];assert.equal(result.results[1].status,'cancelled');
 }finally{await f.close();}
});
test('sensor rules baseline, hysteresis, crossing, cooldown, offline and credential revocation',async()=>{
 const f=await fixture();try{
 const r=await f.a.call('/rules','POST',rule(f.id));assert.equal(r.status,201);
 await read(f,26);assert.equal((await f.a.call('/routines')).body.runs.length,0);
 await read(f,24);await read(f,26);
 let d=(await f.a.call('/routines')).body;assert.equal(d.runs.length,1);assert.equal(d.runs[0].results[0].status,'queued');
 const cmds=(await f.sync()).body.commands;await f.sync({acknowledgements:cmds.map(x=>({id:x.id,value:x.value}))});
 await read(f,27);assert.equal((await f.a.call('/routines')).body.runs.length,1);
 await read(f,24);await read(f,26);assert.equal((await f.a.call('/routines')).body.runs.length,1);
 await f.db.query("UPDATE sensor_rules SET last_fired_at=now()-interval '70 seconds'");
 await read(f,27);assert.equal((await f.a.call('/routines')).body.runs.length,1,'cooldown crossing is not replayed');
 await read(f,24);await read(f,26);assert.equal((await f.a.call('/routines')).body.runs.length,2);
 assert.equal((await f.b.call('/rules/'+r.body.id,'PUT',rule(f.id))).status,404);
 await f.a.call('/rules/'+r.body.id,'PUT',{...rule(f.id),enabled:false});
 assert.equal((await f.a.call('/routines')).body.runs[0].results[0].status,'cancelled');
 await read(f,24);await read(f,27);assert.equal((await f.a.call('/routines')).body.runs.length,2);
 await f.a.call('/rules/'+r.body.id,'PUT',rule(f.id));await read(f,24);
 await f.db.query('UPDATE devices SET token_version=token_version+1 WHERE id=$1',[f.id]);await evaluateRules(f.db);
 assert.equal((await f.a.call('/routines')).body.rules[0].enabled,false);
 }finally{await f.close();}
});
test('stale samples disarm rules, below thresholds work, malformed rules rejected',async()=>{
 const f=await fixture();try{
 const body={...rule(f.id),operator:'below',threshold:20};
 assert.equal((await f.a.call('/rules','POST',{...body,sourcePin:'V1'})).status,400);
 const r=await f.a.call('/rules','POST',body);assert.equal(r.status,201);
 await read(f,22);
 await f.db.query("UPDATE device_pins SET reported_at=now()-interval '40 seconds' WHERE device_id=$1 AND pin='V0'",[f.id]);
 await evaluateRules(f.db);assert.equal((await f.a.call('/routines')).body.rules[0].armed,false);
 await read(f,18);assert.equal((await f.a.call('/routines')).body.runs.length,0);
 await read(f,22);await Promise.all([evaluateRules(f.db),evaluateRules(f.db)]);await read(f,18);
 assert.equal((await f.a.call('/routines')).body.runs.length,1);
 }finally{await f.close();}
});
