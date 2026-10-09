import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createTestDb } from "./database.js";
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
await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({
  headless: true,
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
  await page.screenshot({
    path: "docs/screenshots/dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Manage token for My laptop simulator" })
    .click();
  await page
    .getByLabel("Current password", { exact: true })
    .fill("safe-browser-password-123");
  await page.getByRole("button", { name: "Reveal token", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Device auth token", exact: true })
      .inputValue(),
    token,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Rename My laptop simulator", exact: true })
    .click();
  await page
    .getByLabel("Device name", { exact: true })
    .fill("Workshop simulator");
  await page
    .getByRole("button", { name: "Rename device", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage token for Workshop simulator" })
    .waitFor();
  await page.getByRole("link", { name: "My account", exact: true }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Nithin Maker");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Profile updated.", { exact: true }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/account.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Devices", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/screenshots/mobile-dashboard.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await page.goto("http://127.0.0.1:4178/");
  await page.getByRole("heading", { name: /Your devices/ }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/mobile-landing.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.goto("http://127.0.0.1:4178/dashboard");
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("safe-browser-password-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("heading", { name: "Your connected world." }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: registration, device creation, actual simulator heartbeat, token reveal, rename, profile, logout/login, protected route, desktop/mobile layout.",
  );
} catch (error) {
  console.error("UI check location:", page.url());
  console.error(
    "Visible errors:",
    await page.locator(".error-message").allTextContents(),
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  simulator?.kill("SIGTERM");
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.raw.close();
}
