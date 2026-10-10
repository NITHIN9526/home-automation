// Board-free device: simulated temperature + absolute actuator commands over HTTP.
const origin = process.env.API_URL ?? "http://localhost:3000";
const token = process.env.DEVICE_TOKEN;
if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? "")) {
  console.error(
    "Set DEVICE_TOKEN in .device.env. Keep your existing M1 token.",
  );
  process.exit(1);
}
const url = new URL("/api/device/sync", origin);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
)
  throw Error("Use HTTPS for non-local device credentials.");
const values = new Map(),
  acknowledgements = new Map();
let sample = 0;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => process.exit(0));
console.log(
  "Simulator M2 started. V0: temperature, V1: power, V2: brightness. Press Ctrl+C to stop.",
);
while (true) {
  try {
    const temperature = Number(
      (24 + Math.sin(sample++ / 10) * 2 + Math.random() * 0.3).toFixed(2),
    );
    const pending = [...acknowledgements.values()];
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telemetry: [{ pin: "V0", value: temperature }],
        acknowledgements: pending,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) {
      console.error(
        "Token invalid, rotated, disabled, or deleted. Update the config if needed, then restart.",
      );
      process.exitCode = 1;
      break;
    }
    if (!response.ok)
      throw Error(
        `HTTP ${response.status}: ${(await response.json()).error ?? "Sync failed"}`,
      );
    const result = await response.json();
    for (const id of [...result.acknowledged, ...result.ignored])
      acknowledgements.delete(id);
    if (result.ignored.length)
      console.warn(
        "A command acknowledgement expired or was cancelled; check dashboard state.",
      );
    console.log(
      `${new Date().toLocaleTimeString()} · heartbeat accepted · V0=${temperature}°C`,
    );
    for (const command of result.commands) {
      if (new Date(command.expiresAt) <= new Date(result.serverTime)) continue;
      // Absolute SET, safe to repeat after lost responses. No physical hardware is driven.
      if (!acknowledgements.has(command.id)) {
        values.set(command.pin, command.value);
        console.log(
          `Applied ${command.pin}=${command.value} · acknowledgement queued`,
        );
      }
      acknowledgements.set(command.id, {
        id: command.id,
        value: values.get(command.pin),
      });
    }
  } catch (e) {
    console.error("Sync failed:", e.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
