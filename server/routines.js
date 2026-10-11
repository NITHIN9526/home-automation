import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { fail } from './security.js';
import { checkValue, enqueueCommand } from './pins.js';
import { events } from './events.js';
const name = z.string().trim().min(1).max(80);
const pin = z.string().regex(/^V([0-9]|[12][0-9]|3[01])$/);
const action = z.object({deviceId:z.uuid(),pin,value:z.union([z.boolean(),z.number().finite().min(-1e9).max(1e9)])}).strict();
const actions = z.array(action).min(1).max(12).refine(a=>new Set(a.map(x=>x.deviceId+':'+x.pin)).size===a.length,'Each output can appear only once.');
const sceneSchema = z.object({name,actions}).strict();
const ruleSchema = z.object({name,sourceDevice:z.uuid(),sourcePin:pin,operator:z.enum(['above','below']),threshold:z.number().finite().min(-1e9).max(1e9),hysteresis:z.number().finite().min(0).max(1e9),cooldown:z.number().int().min(10).max(86400),enabled:z.boolean(),actions}).strict();
const groupSchema = z.object({name,kind:z.enum(['room','group']),deviceIds:z.array(z.uuid()).max(100).refine(a=>new Set(a).size===a.length)}).strict();
async function transaction(db, work) {const c=await db.connect();try {await c.query('BEGIN');const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function notify(ids) {for(const id of new Set(ids)){events.emit('command',id);events.emit('state',id);}}
async function ownerLock(c,uid) {await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[uid]);}
async function validateActions(c,uid,list) {
 const result=[];
 for(const a of [...list].sort((a,b)=>(a.deviceId+a.pin).localeCompare(b.deviceId+b.pin))) {
  const {rows:[p]}=await c.query(`SELECT p.*,d.token_version,d.disabled_at FROM device_pins p JOIN devices d ON d.id=p.device_id WHERE d.user_id=$1 AND p.device_id=$2 AND p.pin=$3 FOR UPDATE OF d`,[uid,a.deviceId,a.pin]);
  if(!p) throw fail(404,'An action device or pin was not found.');
  if(p.direction!=='output'||p.disabled_at) throw fail(400,'Choose an enabled device output.');
  checkValue(p,a.value);result.push({...a,tokenVersion:p.token_version});
 }
 return result;
}
async function limitRows(c,table,uid,max) {const {rows:[r]}=await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id=$1`,[uid]);if(r.n>=max)throw fail(409,`Limit of ${max} items reached.`);}
// All actions have independent outcomes. A scene is not a physical transaction.
async function execute(c,uid,sourceId,kind,title,list,runId=randomUUID()) {
 const existing=await c.query('SELECT id,source_id,source_kind FROM routine_runs WHERE id=$1 AND user_id=$2',[runId,uid]);
 if(existing.rows.length){if(existing.rows[0].source_id!==sourceId||existing.rows[0].source_kind!==kind)throw fail(409,'Run ID already used.');return {id:runId,devices:[]};}
 await c.query('INSERT INTO routine_runs(id,user_id,source_id,source_kind,name) VALUES($1,$2,$3,$4,$5)',[runId,uid,sourceId,kind,title]);
 const devices=[];let i=0;
 for(const a of [...list].sort((a,b)=>(a.deviceId+a.pin).localeCompare(b.deviceId+b.pin))) {
  let cmd=null,outcome='queued',detail='';
  await c.query('SAVEPOINT action_attempt');
  try {
   const {rows:[d]}=await c.query('SELECT token_version FROM devices WHERE id=$1 AND user_id=$2 FOR UPDATE',[a.deviceId,uid]);
   if(!d||d.token_version!==a.tokenVersion)throw fail(409,'Device removed or credentials changed. Edit and save this routine.');
   cmd=await enqueueCommand(c,uid,a.deviceId,{id:randomUUID(),pin:a.pin,value:a.value});devices.push(a.deviceId);
  }catch(e){await c.query('ROLLBACK TO SAVEPOINT action_attempt');if(!e.status || e.status>=500)throw e;outcome='skipped';detail=e.message;}
  await c.query('RELEASE SAVEPOINT action_attempt');
  await c.query('INSERT INTO routine_results(run_id,ordinal,device_id,pin,value,command_id,outcome,detail) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',[runId,i++,a.deviceId,a.pin,JSON.stringify(a.value),cmd?.id??null,outcome,detail]);
 }
 return {id:runId,devices};
}
async function cancelPending(c,uid,id) {
 await c.query(`UPDATE device_commands SET status='cancelled' WHERE status='pending' AND id IN (SELECT rr.command_id FROM routine_results rr JOIN routine_runs r ON r.id=rr.run_id WHERE r.user_id=$1 AND r.source_id=$2)`,[uid,id]);
}
export function installRoutineRoutes(app,{db,tx,authenticate,limit}) {
 const write=limit(60,60000);
 app.get('/api/routines',authenticate,async(req,res)=>{
  const uid=req.user.id;
  const groups=(await db.query('SELECT * FROM device_groups WHERE user_id=$1 ORDER BY name,id',[uid])).rows;
  const scenes=(await db.query('SELECT * FROM scenes WHERE user_id=$1 ORDER BY name,id',[uid])).rows;
  const rules=(await db.query('SELECT * FROM sensor_rules WHERE user_id=$1 ORDER BY name,id',[uid])).rows;
  const runs=(await db.query('SELECT * FROM routine_runs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',[uid])).rows;
  const results=runs.length?(await db.query(`SELECT rr.*,CASE WHEN d.status='acknowledged' THEN 'confirmed' WHEN d.status='pending' AND d.expires_at<=now() THEN 'expired' WHEN d.status='pending' THEN 'queued' WHEN d.status IS NOT NULL THEN d.status WHEN rr.outcome='queued' THEN 'unconfirmed' ELSE rr.outcome END AS status FROM routine_results rr LEFT JOIN device_commands d ON d.id=rr.command_id WHERE rr.run_id=ANY($1::uuid[]) ORDER BY ordinal`,[runs.map(r=>r.id)])).rows:[];
  res.json({groups,scenes,rules,runs:runs.map(r=>({...r,results:results.filter(x=>x.run_id===r.id)}))});
 });
 for(const kind of ['groups','scenes','rules']) {
  const table={groups:'device_groups',scenes:'scenes',rules:'sensor_rules'}[kind];
  const schema={groups:groupSchema,scenes:sceneSchema,rules:ruleSchema}[kind];
  async function save(req,res) {
   const data=schema.parse(req.body),uid=req.user.id,id=req.params.id?z.uuid().parse(req.params.id):randomUUID();
   await tx(async c=>{
    await ownerLock(c,uid);
    if(req.params.id){if(!(await c.query(`SELECT id FROM ${table} WHERE id=$1 AND user_id=$2 FOR UPDATE`,[id,uid])).rows.length)throw fail(404,'Item not found.');}
    else await limitRows(c,table,uid,kind==='groups'?50:100);
    if(kind==='groups') {
     const {rows}=await c.query('SELECT id FROM devices WHERE user_id=$1 AND id=ANY($2::uuid[])',[uid,data.deviceIds]);
     if(rows.length!==data.deviceIds.length)throw fail(404,'A selected device was not found.');
     await c.query(`INSERT INTO device_groups(id,user_id,name,kind,device_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$3,kind=$4,device_ids=$5,updated_at=now()`,[id,uid,data.name,data.kind,data.deviceIds]);
    }else {
     // Lock all participating devices in a stable order, including the sensor.
     const ids=[...new Set([...data.actions.map(a=>a.deviceId),...(kind==='rules'?[data.sourceDevice]:[])])].sort();
     await c.query('SELECT id FROM devices WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[uid,ids]);
     const list=await validateActions(c,uid,data.actions);
     if(kind==='scenes') await c.query(`INSERT INTO scenes(id,user_id,name,actions) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET name=$3,actions=$4::jsonb,updated_at=now()`,[id,uid,data.name,JSON.stringify(list)]);
     else {
      const {rows:[p]}=await c.query(`SELECT p.*,d.token_version,d.disabled_at FROM device_pins p JOIN devices d ON d.id=p.device_id WHERE d.user_id=$1 AND p.device_id=$2 AND p.pin=$3`,[uid,data.sourceDevice,data.sourcePin]);
      if(!p)throw fail(404,'Sensor not found.');
      if(p.direction!=='input'||p.data_type!=='number'||p.disabled_at)throw fail(400,'Choose a numeric input on an enabled device.');
      if(data.threshold<p.min_value||data.threshold>p.max_value)throw fail(400,'Threshold is outside the sensor range.');
      if(data.operator==='above'&&data.threshold-data.hysteresis<p.min_value||data.operator==='below'&&data.threshold+data.hysteresis>p.max_value)throw fail(400,'Reset threshold is outside the sensor range.');
      await cancelPending(c,uid,id);
      await c.query(`INSERT INTO sensor_rules(id,user_id,name,source_device,source_pin,source_token_version,operator,threshold,hysteresis,cooldown,actions,enabled,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) ON CONFLICT(id) DO UPDATE SET name=$3,source_device=$4,source_pin=$5,source_token_version=$6,operator=$7,threshold=$8,hysteresis=$9,cooldown=$10,actions=$11::jsonb,enabled=$12,armed=false,observed_at=$13,last_fired_at=NULL,updated_at=now()`,[id,uid,data.name,data.sourceDevice,data.sourcePin,p.token_version,data.operator,data.threshold,data.hysteresis,data.cooldown,JSON.stringify(list),data.enabled,p.reported_at]);
     }
    }
   });res.status(req.params.id?200:201).json({id});
  }
  app.post('/api/'+kind,authenticate,write,save);
  app.put('/api/'+kind+'/:id',authenticate,write,save);
  app.delete('/api/'+kind+'/:id',authenticate,write,async(req,res)=>{
   const id=z.uuid().parse(req.params.id),uid=req.user.id;
   await tx(async c=>{await ownerLock(c,uid);if(!(await c.query(`SELECT id FROM ${table} WHERE id=$1 AND user_id=$2 FOR UPDATE`,[id,uid])).rows.length)throw fail(404,'Item not found.');if(kind!=='groups')await cancelPending(c,uid,id);await c.query(`DELETE FROM ${table} WHERE id=$1 AND user_id=$2`,[id,uid]);});res.json({ok:true});
  });
 }
 app.post('/api/scenes/:id/run',authenticate,write,async(req,res)=>{
  const id=z.uuid().parse(req.params.id),runId=z.object({id:z.uuid()}).strict().parse(req.body).id;
  const result=await tx(async c=>{await ownerLock(c,req.user.id);const {rows:[s]}=await c.query('SELECT * FROM scenes WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,req.user.id]);if(!s)throw fail(404,'Scene not found.');return execute(c,req.user.id,id,'scene',s.name,s.actions,runId);});notify(result.devices);res.json({id:result.id});
 });
}
export async function evaluateRules(db,now=new Date()) {
 const changed=await transaction(db,async c=>{
  // One worker at a time across processes; existing web/MQTT deployment is single instance.
  const {rows:[lock]}=await c.query('SELECT pg_try_advisory_xact_lock(51005) AS locked');if(!lock.locked)return [];
  const {rows:rules}=await c.query(`SELECT r.* FROM sensor_rules r JOIN device_pins p ON p.device_id=r.source_device AND p.pin=r.source_pin JOIN devices d ON d.id=r.source_device WHERE r.enabled AND (d.disabled_at IS NOT NULL OR d.token_version<>r.source_token_version OR p.reported_at IS DISTINCT FROM r.observed_at OR r.armed AND p.reported_at<$1::timestamptz-interval '30 seconds') ORDER BY r.id LIMIT 100 FOR UPDATE OF r SKIP LOCKED`,[now]);
  const ids=[];
  for(const r of rules) {
   const involved=[...new Set([r.source_device,...r.actions.map(a=>a.deviceId)])].sort();
   await c.query('SELECT id FROM devices WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[involved]);
   const {rows:[p]}=await c.query(`SELECT p.*,d.disabled_at,d.token_version FROM device_pins p JOIN devices d ON d.id=p.device_id WHERE p.device_id=$1 AND p.pin=$2`,[r.source_device,r.source_pin]);
   if(!p||p.disabled_at||p.token_version!==r.source_token_version){await c.query('UPDATE sensor_rules SET enabled=false,armed=false WHERE id=$1',[r.id]);continue;}
   const fresh=p.reported_at&&+now-+new Date(p.reported_at)>=0&&+now-+new Date(p.reported_at)<=30000;
   let armed=r.armed;
   if(!fresh||typeof p.value!=='number')armed=false;
   else if(r.operator==='above'?p.value<=r.threshold-r.hysteresis:p.value>=r.threshold+r.hysteresis)armed=true;
   else if(armed&&(r.operator==='above'?p.value>r.threshold:p.value<r.threshold)) {
    armed=false; // Crossing is consumed even during cooldown/offline; never replay old commands.
    if(!r.last_fired_at||+now-+new Date(r.last_fired_at)>=r.cooldown*1000) {
     const out=await execute(c,r.user_id,r.id,'rule',r.name,r.actions);ids.push(...out.devices);
     await c.query('UPDATE sensor_rules SET last_fired_at=$2 WHERE id=$1',[r.id,now]);
    }
   }
   await c.query('UPDATE sensor_rules SET armed=$2,observed_at=$3 WHERE id=$1',[r.id,armed,p.reported_at]);
  }
  // Store final outcomes before the existing seven-day command cleanup.
  await c.query(`UPDATE routine_results rr SET outcome=CASE WHEN d.status='acknowledged' THEN 'confirmed' ELSE d.status END FROM device_commands d WHERE rr.command_id=d.id AND rr.outcome='queued' AND d.status<>'pending'`);
  await c.query("DELETE FROM routine_runs WHERE created_at<now()-interval '30 days'");
  return ids;
 });notify(changed);
}
export async function startRuleEngine(db) {
 await db.query("UPDATE sensor_rules SET armed=false WHERE armed");
 let busy=null,stopped=false;
 const timer=setInterval(()=>{if(stopped||busy)return;busy=evaluateRules(db).catch(e=>console.error('Sensor rules failed:',e.code??e.message)).finally(()=>busy=null);},1000);timer.unref();
 return async()=>{stopped=true;clearInterval(timer);if(busy)await busy;};
}
