import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

// Smallest valid JPEG header is enough: the server stores bytes, it does not decode.
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

let server, base, dataDir;
const TOKEN = 'test-token-123';

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-test-'));
  const app = createApp({ dataDir, apiToken: TOKEN });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const auth = { Authorization: `Bearer ${TOKEN}` };

function form(report, photoCount = 2) {
  const fd = new FormData();
  fd.append('report', JSON.stringify(report));
  for (let i = 0; i < photoCount; i++) fd.append('photos', new Blob([JPEG], { type: 'image/jpeg' }), `p${i}.jpg`);
  return fd;
}

const valid = () => ({
  id: crypto.randomUUID(),
  project: 'SCADA Upgrade North',
  site: 'Substation 132kV Alpha',
  asset: 'RTU-02',
  mission_type: 'Commissioning / SAT',
  status: 'Completed',
  technician_name: 'A. Engineer',
  start_time: '2026-11-19T08:00:00.000Z',
  end_time: '2026-11-19T15:30:00.000Z',
  work_performed: 'Point-to-point test of 48 DI signals.',
  issues: '=HYPERLINK("x") formula injection probe',
  lat: 30.0444, lng: 31.2357, gps_accuracy: 8,
  photos: [{ caption: 'RTU cabinet as-left' }, { caption: 'Test sheet' }],
});

test('rejects requests without token', async () => {
  const res = await fetch(`${base}/api/reports`, { method: 'POST', body: form(valid()) });
  assert.equal(res.status, 401);
});

test('creates a report with photos and is idempotent on retry', async () => {
  const r = valid();
  const res = await fetch(`${base}/api/reports`, { method: 'POST', body: form(r), headers: auth });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.photos, 2);

  const retry = await fetch(`${base}/api/reports`, { method: 'POST', body: form(r), headers: auth });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);

  const got = await (await fetch(`${base}/api/reports/${r.id}`, { headers: auth })).json();
  assert.equal(got.photos.length, 2);
  assert.equal(got.photos[0].caption, 'RTU cabinet as-left');

  const img = await fetch(`${base}/files/${r.id}/${got.photos[0].filename}`, { headers: auth });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');

  const html = await (await fetch(`${base}/reports/${r.id}?token=${TOKEN}`)).text();
  assert.match(html, /Substation 132kV Alpha/);
  assert.match(html, /RTU cabinet as-left/);

  const list = await (await fetch(`${base}/api/reports?q=Alpha`, { headers: auth })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].photo_count, 2);

  const csv = await (await fetch(`${base}/api/reports.csv`, { headers: auth })).text();
  assert.match(csv, /'=HYPERLINK/);
});

test('validates required fields and photo presence', async () => {
  const r = { ...valid(), site: '', mission_type: 'Party' };
  const res = await fetch(`${base}/api/reports`, { method: 'POST', body: form(r, 0), headers: auth });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.details.includes('site is required'));
  assert.ok(body.details.includes('mission_type is invalid'));
  assert.ok(body.details.includes('At least one photo is required'));
});

test('rejects non-image uploads and bad ids', async () => {
  const fd = new FormData();
  fd.append('report', JSON.stringify(valid()));
  fd.append('photos', new Blob(['x'], { type: 'application/pdf' }), 'x.pdf');
  assert.equal((await fetch(`${base}/api/reports`, { method: 'POST', body: fd, headers: auth })).status, 415);

  const bad = await fetch(`${base}/api/reports`, { method: 'POST', body: form({ ...valid(), id: '../etc' }), headers: auth });
  assert.equal(bad.status, 400);
  assert.equal(fs.readdirSync(path.join(dataDir, 'tmp')).length, 0, 'temp uploads cleaned up');
});
