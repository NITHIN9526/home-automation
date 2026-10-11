import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createTestDb } from "./database.js";
import { attachLive } from "../server/live.js";
import { runSchedules } from "../server/features.js";
import { DateTime } from "luxon";
import { createApp } from "../server/app.js";
import { randomBytes } from "node:crypto";
const db = await createTestDb();
const app = await createApp({
  db,
  encryptionKey: randomBytes(32),
  origin: "http://127.0.0.1:4178",
  bcryptRounds: 4,
  disableLimits: true,
});
const server = app.listen(4178, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const stopLive = attachLive(server, { db, origin: "http://127.0.0.1:4178" });
await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let simulator;
try {
  await page.goto("http://127.0.0.1:4178");
  await page.getByRole("heading", { name: /Your devices/ }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/landing.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Nithin Demo");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("safe-browser-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("heading", { name: "Your connected world." }).waitFor();
  await page.getByRole("button", { name: "Add your first device" }).click();
  await page
    .getByLabel("Device name", { exact: true })
    .fill("My laptop simulator");
  await page
    .getByRole("button", { name: "Create device", exact: true })
    .click();
  const token = await page
    .getByRole("textbox", { name: "Device auth token", exact: true })
    .inputValue();
  assert.equal(token.length, 43);
  await page.getByRole("button", { name: "Close dialog" }).click();
  simulator = spawn(process.execPath, ["scripts/simulator.js"], {
    env: {
      ...process.env,
      DEVICE_TOKEN: token,
      API_URL: "http://127.0.0.1:4178",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Simulator heartbeat timed out")),
      8000,
    );
    simulator.stdout.on("data", (data) => {
      if (data.toString().includes("heartbeat accepted")) {
        clearTimeout(timer);
        resolve();
      }
    });
    simulator.once("error", reject);
  });
  await page.getByText("Online", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "My dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Add your first widget" }).click();
  async function add(kind, pin, label, x) {
    await page.getByLabel("Widget type", { exact: true }).selectOption(kind);
    await page.getByLabel("Virtual pin", { exact: true }).selectOption(pin);
    await page.getByLabel("Widget label", { exact: true }).fill(label);
    await page.getByText("Keyboard layout settings", { exact: true }).click();
    await page.getByLabel("Desktop Column", { exact: true }).fill(String(x));
    await page
      .getByLabel("Desktop Row", { exact: true })
      .fill(kind === "chart" ? "5" : "0");
    if (kind === "chart")
      await page.getByLabel("Desktop Width", { exact: true }).fill("8");
    await page
      .getByRole("button", { name: "Add widget", exact: true })
      .last()
      .click();
  }
  await add("switch", "V1", "Workshop light", 0);
  await page.getByRole("button", { name: "Add widget", exact: true }).click();
  await add("slider", "V2", "Brightness", 4);
  await page.getByRole("button", { name: "Add widget", exact: true }).click();
  await add("gauge", "V0", "Temperature", 8);
  await page.getByRole("button", { name: "Add widget", exact: true }).click();
  await add("chart", "V0", "Temperature history", 0);
  await page
    .getByLabel("Dashboard name", { exact: true })
    .fill("Workshop dashboard");
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await page.getByText("Dashboard saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "ON", exact: true }).click();
  await expect(
    page
      .locator(".m4-widget")
      .filter({
        has: page.getByRole("heading", { name: "Workshop light", exact: true }),
      })
      .locator(".m4-value"),
  ).toHaveText("ON", { timeout: 12000 });
  const slider = page.getByRole("slider", { name: "Brightness target" });
  await slider.fill("30");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page
      .locator(".m4-widget")
      .filter({
        has: page.getByRole("heading", { name: "Brightness", exact: true }),
      })
      .locator(".m4-value"),
  ).toHaveText("30%", { timeout: 12000 });
  await page.reload();
  await page
    .getByRole("heading", { name: "Workshop dashboard", exact: true })
    .waitFor();
  assert.equal(await page.locator(".m4-widget").count(), 4);
  await page.screenshot({
    path: "docs/screenshots/m4-builder-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click();
  // Real pointer drag and resize, then verify persistence.
  const handle = page.locator(".m4-handle").first();
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 150, h.y + h.height / 2 + 80, {
    steps: 10,
  });
  await page.mouse.up();
  const corner = page.locator(".react-resizable-handle").first();
  const c = await corner.boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2 + 80, {
    steps: 10,
  });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await page.getByText("Dashboard saved.", { exact: true }).waitFor();
  const layout = await page.evaluate(() =>
    fetch("/api/dashboard-layout").then((r) => r.json()),
  );
  assert.ok(layout.widgets[0].layouts.lg.h >= 5);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page
    .getByRole("heading", { name: "Workshop dashboard", exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "mobile overflow",
  );
  await page.screenshot({
    path: "docs/screenshots/m4-builder-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Automations", exact: true }).click();
  await page
    .getByRole("button", { name: "Create your first automation", exact: true })
    .click();
  await page
    .getByLabel("Automation name", { exact: true })
    .fill("Evening lights");
  await page.getByLabel("Output pin", { exact: true }).selectOption("V1");
  await page.getByLabel("Action", { exact: true }).selectOption("false");
  await page.getByLabel("Timezone", { exact: true }).fill("Asia/Kolkata");
  await page.getByLabel("Time", { exact: true }).fill("22:00");
  await page
    .getByRole("button", { name: "Save automation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Evening lights", exact: true })
    .waitFor();
  await db.query(
    "UPDATE automations SET next_run_at=now()-interval '1 second'",
  );
  await runSchedules(db);
  await page
    .getByText("Confirmed", { exact: true })
    .waitFor({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Pause Evening lights", exact: true })
    .click();
  await page.getByText("Inactive", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Edit Evening lights", exact: true })
    .click();
  await page.getByLabel("Repeat", { exact: true }).selectOption("weekly");
  await page.getByLabel("Enable this automation", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save automation", exact: true })
    .click();
  await page.getByText("Enabled", { exact: true }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/m4-automations-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "automation mobile overflow",
  );
  await page.screenshot({
    path: "docs/screenshots/m4-automations-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser passed: widget CRUD, saved responsive layouts, drag/resize, device controls, automation creation, execution ACK, pause/edit, desktop/mobile, no JS errors.",
  );
} catch (e) {
  console.error("Browser errors:",errors);
  console.error((await page.locator("body").innerText()).slice(-7000));
  await page.screenshot({path:"docs/screenshots/m4-failure.png",fullPage:true});
  throw e;
} finally {
  simulator?.kill();
  await browser.close();
  stopLive();
  await new Promise((r) => server.close(r));
  await db.raw.close();
}
