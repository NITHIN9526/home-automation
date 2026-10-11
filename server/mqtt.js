import { Aedes } from 'aedes';
import net from 'node:net';
import { hashToken, tokenPattern } from './security.js';
import { syncDevice } from './pins.js';
import { events } from './events.js';

export async function startMqtt({ db, host = '127.0.0.1', port = 1883 }) {
  const broker = await Aedes.createBroker({ connectTimeout: 5000, queueLimit: 20 });
  const clients = new Map();
  async function tx(fn) {
    const cx = await db.connect();
    try { await cx.query('BEGIN'); const r = await fn(cx); await cx.query('COMMIT'); return r; }
    catch(e) { await cx.query('ROLLBACK'); throw e; }
    finally { cx.release(); }
  }
  async function valid(c) {
    if (!c?.credentialHash) return false;
    return !!(await db.query('SELECT id FROM devices WHERE id=$1 AND token_hash=$2 AND token_version=$3 AND disabled_at IS NULL', [c.id, c.credentialHash, c.tokenVersion])).rows.length;
  }
  broker.preConnect = (c, packet, cb) => cb(null, packet.clean === true && !packet.will && /^[0-9a-f-]{36}$/i.test(packet.clientId) && broker.connectedClients < 100);
  broker.authenticate = (c, username, password, cb) => {
    const token = password?.toString() ?? '';
    if (username !== 'device' || !tokenPattern.test(token)) return cb(null, false);
    db.query('SELECT id,token_version FROM devices WHERE token_hash=$1 AND disabled_at IS NULL', [hashToken(token)]).then(({rows}) => {
      const d = rows[0];
      if (!d || c.id !== d.id) return cb(null, false);
      c.credentialHash = hashToken(token); c.deviceToken = token; c.tokenVersion = d.token_version;
      c.windowStart = Date.now(); c.messages = 0; cb(null, true);
    }).catch(() => cb(null, false));
  };
  broker.authorizePublish = (c, p, cb) => {
    if (!c) return cb(null);
    if (Date.now() - c.windowStart > 10000) { c.windowStart = Date.now(); c.messages = 0; }
    if (++c.messages > 40 || p.topic !== `iot/${c.id}/sync` || p.retain || p.payload.length > 4096) return cb(Error('Publish denied'));
    valid(c).then(ok => cb(ok ? null : Error('Credential revoked'))).catch(() => cb(Error('Unavailable')));
  };
  broker.authorizeSubscribe = (c, sub, cb) => {
    valid(c).then(ok => cb(null, ok && sub.topic === `iot/${c.id}/down` ? sub : null)).catch(() => cb(null, null));
  };
  // Downlink is never retained or queued for offline clients; DB keeps pending commands.
  async function deliver(c, result) {
    if (!(await valid(c))) { c.close(); return; }
    const commands = result.commands.map(x => ({...x, valueText: JSON.stringify(x.value)}));
    await new Promise((resolve, reject) => broker.publish({topic:`iot/${c.id}/down`,payload:Buffer.from(JSON.stringify({...result,commands})),qos:0,retain:false},e=>e?reject(e):resolve()));
  }
  async function push(id) {
    const c = clients.get(id); if (!c) return;
    try {
      const {rows:commands} = await db.query(`SELECT id,pin,value,expires_at AS "expiresAt" FROM device_commands WHERE device_id=$1 AND token_version=$2 AND status='pending' AND expires_at>now() ORDER BY created_at,id`,[id,c.tokenVersion]);
      await deliver(c,{commands,acknowledged:[],ignored:[],serverTime:new Date().toISOString()});
    } catch { c.close(); }
  }
  broker.on('clientReady', c => clients.set(c.id,c));
  broker.on('clientDisconnect', c => { if(clients.get(c.id)===c) clients.delete(c.id); c.deviceToken = ''; });
  broker.on('publish',(p,c)=> {
    if (!c || p.topic !== `iot/${c.id}/sync`) return;
    // Bound the per-client work queue; transactions serialize device state changes.
    c.queued = (c.queued ?? 0) + 1;
    if(c.queued > 8) { c.close(); return; }
    c.work = (c.work ?? Promise.resolve()).then(async()=> {
      const result = await syncDevice(tx,c.deviceToken,JSON.parse(p.payload.toString()));
      await deliver(c,result);
    }).catch(()=>c.close()).finally(()=>{c.queued--;});
  });
  broker.on('clientError',()=>{}); broker.on('connectionError',()=>{});
  events.on('command',push);
  const sweep = setInterval(()=> { for(const c of clients.values()) valid(c).then(ok=>{if(!ok)c.close();}).catch(()=>c.close()); },5000);
  sweep.unref();
  const server = net.createServer(broker.handle);
  server.maxConnections = 100;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return { broker, port:server.address().port, async close() {
    clearInterval(sweep); events.off('command',push);
    for(const c of clients.values()) c.close();
    await new Promise(r=>broker.close(r));
    await new Promise(r=>server.close(r));
  }};
}
