// A real API client, not a dashboard-only fake. No board or MQTT needed in M1.
const origin = process.env.API_URL ?? "http://localhost:3000";
const token = process.env.DEVICE_TOKEN;
if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? "")) {
  console.error(
    "Set DEVICE_TOKEN in .device.env. Copy .device.env.example first.",
  );
  process.exit(1);
}
const url = new URL("/api/device/heartbeat", origin);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
)
  throw Error("Use HTTPS for non-local device credentials.");
let running = true;
process.on("SIGINT", () => {
  running = false;
  process.exit(0);
});
console.log(
  "Device simulator started. Press Ctrl+C to stop. The dashboard becomes offline after 30 seconds without a heartbeat.",
);
while (running) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) {
      console.error(
        "Device token is invalid, rotated, deleted, or disabled. Simulator stopped.",
      );
      break;
    }
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const result = await response.json();
    console.log(
      `${new Date().toLocaleTimeString()} · heartbeat accepted · ${result.deviceId}`,
    );
  } catch (e) {
    console.error("Heartbeat failed:", e.message);
  }
  await new Promise((r) => setTimeout(r, 10000));
}
