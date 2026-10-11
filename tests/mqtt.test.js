import http from 'node:http';
import { WebSocket } from 'ws';
import { attachLive } from '../server/live.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import mqtt from 'mqtt';
import {createTestDb} from './database.js';
import {hashToken} from '../server/security.js';
import {seedPins} from '../server/pins.js';
import {startMqtt} from '../server/mqtt.js';
import {events} from '../server/events.js';
const wait = (c, event) => new Promise((resolve,reject)=> {
 const timer=setTimeout(()=>{c.off(event,done);reject(Error('Timeout '+event));},5000);
 const done=(...args)=>{clearTimeout(timer);resolve(args);};c.once(event,done);
});
test('MQTT authenticates, isolates topics, pushes command, commits ACK, and revokes token',async()=>{
 const db=await createTestDb();let service,c,bad,web,ws,closeLive;
 try {
 const uid=randomUUID(),id=randomUUID(),token=randomBytes(32).toString('base64url');
 await db.query("INSERT INTO users(id,name,email,password_hash) VALUES($1,'Tester','mqtt@example.test','unused')",[uid]);
 await db.query("INSERT INTO devices(id,user_id,name,device_type,token_hash,token_ciphertext,token_iv,token_tag,token_preview) VALUES($1,$2,'LED','esp32',$3,$4,$5,$6,'test')",[id,uid,hashToken(token),randomBytes(43),randomBytes(12),randomBytes(16)]);
 await seedPins(db,id);
 service=await startMqtt({db,port:0});const url=`mqtt://127.0.0.1:${service.port}`;
 bad=mqtt.connect(url,{clientId:randomUUID(),username:'device',password:token,reconnectPeriod:0});bad.on('error',()=>{});
 await wait(bad,'error'); bad.end(true);
 c=mqtt.connect(url,{clientId:id,username:'device',password:token,reconnectPeriod:0}); c.on('error',()=>{});await wait(c,'connect');
 await new Promise((r,j)=>c.subscribe(`iot/${id}/down`,e=>e?j(e):r()));
 const denied=await new Promise(r=>c.subscribe('iot/+/down',(e,g)=>r(e||g[0].qos===128)));assert.ok(denied);
 let next=wait(c,'message');c.publish(`iot/${id}/sync`,JSON.stringify({telemetry:[{pin:'V0',value:25}]}));
 assert.equal(JSON.parse((await next)[1]).deviceId,id);
 // Event-driven snapshot must arrive without the 60-second fallback timer.
 const session=randomBytes(32).toString('base64url');
 await db.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[hashToken(session),uid,session]);
 web=http.createServer();closeLive=attachLive(web,{db,origin:'http://localhost:5173',intervalMs:60000});web.listen(0,'127.0.0.1');await wait(web,'listening');
 ws=new WebSocket(`ws://127.0.0.1:${web.address().port}/api/live?deviceId=${id}`,{headers:{Origin:'http://localhost:5173',Cookie:`openiot_session=${session}`}});
 await wait(ws,'message');
 const changed=wait(ws,'message');next=wait(c,'message');
 c.publish(`iot/${id}/sync`,JSON.stringify({telemetry:[{pin:'V0',value:26}]}));await next;
 assert.equal(JSON.parse((await changed)[0]).pins.find(p=>p.pin==='V0').value,26);
 const command=randomUUID();await db.query("INSERT INTO device_commands(id,device_id,pin,value,token_version) VALUES($1,$2,'V2','20',1)",[command,id]);
 next=wait(c,'message');events.emit('command',id);const down=JSON.parse((await next)[1]);assert.equal(down.commands[0].valueText,'20');
 next=wait(c,'message');c.publish(`iot/${id}/sync`,JSON.stringify({acknowledgements:[{id:command,value:20}]}));
 assert.deepEqual(JSON.parse((await next)[1]).acknowledged,[command]);
 assert.equal((await db.query("SELECT value FROM device_pins WHERE device_id=$1 AND pin='V2'",[id])).rows[0].value,20);
 await db.query('UPDATE devices SET token_version=2 WHERE id=$1',[id]);
 next=wait(c,'close');c.publish(`iot/${id}/sync`,'{}');await next;
 } finally {ws?.terminate();closeLive?.();if(web) await new Promise(r=>web.close(r));bad?.end(true);c?.end(true);if(service)await service.close();await db.raw.close();}
});
