// End-to-end check of the field app in an emulated phone, including the
// offline queue. Run: node test/e2e.mjs   (needs Playwright + Chromium)
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright'); // project dep or global (NODE_PATH)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

const shotsDir = process.env.SHOTS_DIR || '';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-e2e-'));
const TOKEN = 'e2e-token';
const app = createApp({ dataDir, apiToken: TOKEN });
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: { latitude: 30.0444, longitude: 31.2357, accuracy: 6 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => { throw e; });
page.on('dialog', (d) => d.accept());

// Build a realistic 4000x3000 test photo in the browser.
await page.goto(base + '/');
const photoB64 = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 4000, 3000); grd.addColorStop(0, '#345'); grd.addColorStop(1, '#9ab');
  g.fillStyle = grd; g.fillRect(0, 0, 4000, 3000);
  g.fillStyle = '#ddd'; g.fillRect(1200, 600, 1600, 1900);
  const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); });
});
const photoPath = path.join(dataDir, 'site.jpg');
fs.writeFileSync(photoPath, Buffer.from(photoB64, 'base64'));

const shot = async (name) => shotsDir && page.screenshot({ path: path.join(shotsDir, name), fullPage: false });

// Settings
await page.goto(base + '/#/settings');
await page.fill('#f-technician_name', 'A. Engineer');
await page.fill('#f-technician_id', 'E1234');
await page.fill('#f-token', TOKEN);
await page.click('#test');
await page.waitForFunction(() => /Token accepted/.test(document.querySelector('#test-out').textContent));
await page.click('button[type=submit]');

async function fillReport(site) {
  await page.click('a.fab');
  await page.waitForSelector('#form');
  await page.fill('#f-project', 'SCADA Upgrade – Region North');
  await page.fill('#f-site', site);
  await page.fill('#f-asset', 'RTU-02 / Bay 3');
  await page.selectOption('#f-mission_type', 'Commissioning / SAT');
  await page.click('#gps');
  await page.waitForFunction(() => /30\.04440/.test(document.querySelector('#gps-val').textContent));
  await page.fill('#f-work_performed', 'Point-to-point test of 48 DI / 16 DO. IEC 104 link to control centre verified.');
  await page.fill('#f-issues', 'DI-17 wiring reversed at marshalling; corrected on site.');
  await page.fill('#f-ptw_number', 'PTW-2026-0912');
  await page.setInputFiles('#cam', photoPath);
  await page.waitForSelector('.photo img');
  await page.fill('.photo textarea', 'RTU cabinet, as-left');
  await page.locator('#sig').evaluate((el) => el.scrollIntoView({ block: 'center' })); // keep clear of the fixed action bar
  const box = await page.locator('#sig').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 }); await page.mouse.move(box.x + 220, box.y + 110, { steps: 8 });
  await page.mouse.up();
  await page.fill('#f-signed_by', 'Client rep – Protection Eng.');
  await page.waitForTimeout(600); // autosave debounce
}

// 1) Validation blocks empty submit
await page.goto(base + '/#/');
await page.click('a.fab');
await page.waitForSelector('#form');
await page.click('#submit');
await page.waitForSelector('.errors');
await shot('03-validation.png');
await page.click('#discard');

// 2) Online submit
await fillReport('Substation 132kV Alpha');
await page.evaluate(() => window.scrollTo(0, 0));
await shot('02-form.png');
await page.locator('.photos').scrollIntoViewIfNeeded();
await shot('04-photos.png');
await page.click('#submit');
await page.click('[data-tab=sent]');
await page.waitForSelector('.pill.sent', { timeout: 10000 });
await shot('05-sent.png');

// 3) Offline submit is queued, then sent when back online
await ctx.setOffline(true);
await page.click('[data-tab=active]').catch(() => {});
await fillReport('Substation 66kV Bravo');
await page.click('#submit');
await page.waitForSelector('.pill.outbox');
await page.waitForFunction(() => /Offline/.test(document.querySelector('#net').textContent));
await shot('01-home-offline.png');
let list = await (await fetch(`${base}/api/reports`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
assert.equal(list.length, 1, 'offline report must not reach the server yet');
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForFunction(() => !document.querySelector('.pill.outbox'), null, { timeout: 10000 });

list = await (await fetch(`${base}/api/reports`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
assert.equal(list.length, 2);
const full = await (await fetch(`${base}/api/reports/${list[0].id}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
assert.equal(full.photos.length, 1);
assert.equal(full.photos[0].caption, 'RTU cabinet, as-left');
assert.ok(full.photos[0].size < 1_000_000, `photo compressed (${full.photos[0].size} bytes)`);
assert.ok(full.signature_file, 'signature uploaded');
assert.equal(full.technician_name, 'A. Engineer');
assert.ok(Math.abs(full.lat - 30.0444) < 1e-6);
console.log(`Original photo ${fs.statSync(photoPath).size} B -> uploaded ${full.photos[0].size} B`);

if (shotsDir) {
  const p2 = await ctx.newPage();
  await p2.goto(`${base}/reports/${full.id}?token=${TOKEN}`);
  await p2.screenshot({ path: path.join(shotsDir, '06-server-report.png'), fullPage: true });
  const p3 = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  await p3.goto(base + '/admin.html');
  await p3.fill('#tok', TOKEN); await p3.click('#tok-save');
  await p3.waitForSelector('#rows tr td a');
  await p3.screenshot({ path: path.join(shotsDir, '07-dashboard.png') });
}

// 4) iPhone in a Safari tab: install instructions shown; stale unsent report flagged
const ios = await browser.newContext({ ...devices['iPhone 14'] });
const ip = await ios.newPage();
ip.on('pageerror', (e) => { throw e; });
await ip.goto(base + '/');
await ip.waitForSelector('#ios-install');
await ios.setOffline(true);
await ip.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('mission-reports'); q.onsuccess = () => r(q.result); });
  const old = new Date(Date.now() - 26 * 3600_000).toISOString();
  await new Promise((r) => {
    const t = db.transaction('reports', 'readwrite');
    t.objectStore('reports').put({ id: crypto.randomUUID(), state: 'outbox', site: 'Substation 33kV Charlie', submittedAt: old, updatedAt: old });
    t.oncomplete = r;
  });
});
await ip.reload();
await ip.waitForSelector('#stale');
assert.match(await ip.textContent('#sync'), /No connection/);
if (shotsDir) await ip.screenshot({ path: path.join(shotsDir, '08-iphone-safari.png') });
await ios.close();

await browser.close();
server.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('E2E passed');
