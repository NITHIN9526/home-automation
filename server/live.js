import { events } from "./events.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { hashToken, tokenPattern } from "./security.js";
import { snapshot } from "./pins.js";

// Read-only snapshots; HTTP commands retain normal session + CSRF checks.
export function attachLive(
  server,
  { db, origin, production = false, intervalMs = 2000 },
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const sessions = new Map();
  let pending = 0;
  async function identity(hash) {
    return (
      await db.query(
        "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()",
        [hash],
      )
    ).rows[0];
  }
  function reject(socket, status) {
    socket.end(
      `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
  async function upgrade(req, socket, head) {
    const onError = () => socket.destroy();
    socket.on("error", onError);
    if (wss.clients.size + pending >= 100) return reject(socket, 503);
    pending++;
    socket.setTimeout(5000, () => socket.destroy());
    try {
      const url = new URL(req.url, "http://local");
      if (url.pathname !== "/api/live") return reject(socket, 404);
      if (req.headers.origin !== origin) return reject(socket, 403);
      const id = z.uuid().safeParse(url.searchParams.get("deviceId"));
      if (!id.success) return reject(socket, 400);
      const cookieName = production
        ? "__Host-openiot_session"
        : "openiot_session";
      const token = (req.headers.cookie ?? "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      if (!tokenPattern.test(token ?? "")) return reject(socket, 401);
      const hash = hashToken(token),
        key = hash.toString("hex"),
        user = await identity(hash);
      if (!user) return reject(socket, 401);
      if (
        !(
          await db.query("SELECT id FROM devices WHERE id=$1 AND user_id=$2", [
            id.data,
            user.user_id,
          ])
        ).rows.length
      )
        return reject(socket, 404);
      if ((sessions.get(key) ?? 0) >= 5) return reject(socket, 429);
      if (socket.destroyed) return;
      socket.setTimeout(0);
      wss.handleUpgrade(req, socket, head, (ws) => {
        socket.removeListener("error", onError);
        sessions.set(key, (sessions.get(key) ?? 0) + 1);
        let dirty = false;
        let busy = false,
          alive = true;
        ws.on("error", () => ws.terminate());
        ws.on("pong", () => {
          alive = true;
        });
        ws.on("message", () => ws.close(1008, "Read-only stream"));
        async function send() {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (busy) { dirty = true; return; }
          dirty = false;
          busy = true;
          try {
            const u = await identity(hash);
            if (!u) return ws.close(1008, "Session expired");
            const data = await snapshot(db, id.data, u.user_id);
            if (ws.bufferedAmount > 128 * 1024) return ws.terminate();
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "snapshot", ...data }));
          } catch (e) {
            ws.close(
              e.status === 404 ? 1008 : 1011,
              e.status === 404 ? "Device unavailable" : "Service unavailable",
            );
          } finally {
            busy = false;
            if (dirty) queueMicrotask(send);
          }
        }
        const onState = (deviceId) => { if (deviceId === id.data) send(); };
        events.on("state", onState);
        const timer = setInterval(send, intervalMs);
        const heartbeat = setInterval(() => {
          if (!alive) return ws.terminate();
          alive = false;
          ws.ping();
        }, 30000);
        timer.unref();
        heartbeat.unref();
        ws.once("close", () => {
          events.off("state", onState);
          clearInterval(timer);
          clearInterval(heartbeat);
          const n = (sessions.get(key) ?? 1) - 1;
          if (n > 0) sessions.set(key, n);
          else sessions.delete(key);
        });
        send();
      });
    } catch {
      if (!socket.destroyed) reject(socket, 503);
    } finally {
      pending--;
    }
  }
  server.on("upgrade", upgrade);
  return () => {
    server.removeListener("upgrade", upgrade);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
}
