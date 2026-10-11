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
await context.addInitScript(() => Object.defineProperty(globalThis.crypto,"randomUUID",{value:undefined,configurable:true}));
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

  const device=(await db.query('SELECT id FROM devices')).rows[0].id;
  await page.getByRole('link',{name:'Rooms & groups',exact:true}).click();
  await page.getByRole('button',{name:'Add room / group'}).click();
  await page.getByLabel('Name',{exact:true}).fill('Living room');
  await page.getByLabel('My laptop simulator',{exact:true}).check();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('heading',{name:'Living room',exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Workshop');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('heading',{name:'Workshop',exact:true}).waitFor();
  await page.getByRole('link',{name:'Scenes',exact:true}).click();
  await page.getByRole('button',{name:'Add scene',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Evening');
  await page.getByRole('button',{name:'Add action',exact:true}).click();
  await page.getByLabel('Output 1',{exact:true}).selectOption(device+':V1');
  await page.getByRole('button',{name:'Add action',exact:true}).click();
  await page.getByLabel('Output 2',{exact:true}).selectOption(device+':V2');
  await page.getByLabel('Value 2',{exact:true}).fill('40');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('heading',{name:'Evening',exact:true}).waitFor();
  await page.getByRole('button',{name:'Run scene',exact:true}).click();
  await expect(page.getByText('confirmed',{exact:true})).toHaveCount(2,{timeout:15000});
  await page.screenshot({path:'docs/screenshots/m5-scenes-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Sensor rules',exact:true}).click();
  await page.getByRole('button',{name:'Add rule',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Warm room');
  await page.getByLabel('Sensor',{exact:true}).selectOption(device+':V0');
  await page.getByRole('button',{name:'Add action',exact:true}).click();
  await page.getByLabel('Value 1',{exact:true}).selectOption('false');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('heading',{name:'Warm room',exact:true}).waitFor();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('button',{name:'Enable',exact:true}).waitFor();
  await page.getByRole('button',{name:'Enable',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Threshold',{exact:true}).fill('26');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Above 26',{exact:true}).waitFor();
  await page.screenshot({path:'docs/screenshots/m5-rules-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  for(const title of ['Rooms & groups','Scenes','Sensor rules']) {
    await page.getByRole('link',{name:title,exact:true}).click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile overflow '+title);
  }
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile editor overflow');
  await page.screenshot({path:'docs/screenshots/m5-rule-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  page.on('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete Warm room',exact:true}).click();
  await page.getByRole('heading',{name:'Make your first sensor rule',exact:true}).waitFor();
  await page.getByRole('link',{name:'Rooms & groups',exact:true}).click();
  await page.getByRole('button',{name:'Delete Workshop',exact:true}).click();
  await page.getByRole('heading',{name:'Make your first room',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Browser passed: room create/edit/delete, multi-action scene and simulator ACK, rule create/edit/pause/enable/delete, desktop/mobile layout, insecure-context UUID fallback, no page errors.');
} catch(e) {
  console.error('Browser errors:',errors);
  console.error((await page.locator('body').innerText()).slice(-7000));
  await page.screenshot({path:'docs/screenshots/m5-failure.png',fullPage:true});throw e;
} finally {
  simulator?.kill();await browser.close();stopLive();await new Promise(r=>server.close(r));await db.raw.close();
}
