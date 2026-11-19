// Outbox sync. Reports marked "outbox" are uploaded when the device has
// connectivity. The report UUID is generated on the device, and the server
// treats a repeat UUID as already received, so retries never create duplicates.

import { store } from './store.js';
import { settings } from './settings.js';

const listeners = new Set();
let running = false;

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

const PAYLOAD_FIELDS = [
  'project', 'site', 'asset', 'mission_type', 'status', 'technician_name', 'technician_id',
  'team_members', 'start_time', 'end_time', 'ptw_number', 'work_performed', 'findings',
  'issues', 'safety_notes', 'next_actions', 'lat', 'lng', 'gps_accuracy', 'signed_by',
];

const toIso = (local) => (local ? new Date(local).toISOString() : null);

async function uploadOne(report) {
  const photos = await store.listPhotos(report.id);
  const missing = photos.filter((p) => !p.blob);
  if (missing.length) throw new Error('Photo data missing on device; edit the report and re-attach photos.');

  const payload = { id: report.id, created_at: report.createdAt };
  for (const f of PAYLOAD_FIELDS) payload[f] = report[f] ?? null;
  payload.start_time = toIso(report.start_time);
  payload.end_time = toIso(report.end_time);
  payload.photos = photos.map((p) => ({ caption: p.caption || '', taken_at: p.takenAt }));

  const form = new FormData();
  form.append('report', JSON.stringify(payload));
  photos.forEach((p, i) => form.append('photos', p.blob, `photo-${i + 1}.jpg`));
  if (report.signature) form.append('signature', report.signature, 'signature.png');

  const { serverUrl, token } = settings.get();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/reports`, { method: 'POST', body: form, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error([body.error, ...(body.details || [])].filter(Boolean).join(': ') || `HTTP ${res.status}`);
    // 4xx (except 408/429) will not fix itself by retrying; surface to the user.
    err.permanent = res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status);
    throw err;
  }
  return body;
}

export async function syncNow() {
  if (running || !navigator.onLine) return;
  running = true;
  emit();
  try {
    const queue = (await store.listReports()).filter((r) => r.state === 'outbox');
    for (const report of queue) {
      try {
        const result = await uploadOne(report);
        report.state = 'sent';
        report.sentAt = new Date().toISOString();
        report.serverPath = result.url;
        report.lastError = null;
        await store.putReport(report);
        await store.purgeFullImages(report.id);
      } catch (err) {
        report.lastError = err.message;
        report.attempts = (report.attempts || 0) + 1;
        if (err.permanent) report.state = 'failed';
        await store.putReport(report);
        if (!err.permanent && err instanceof TypeError) break; // network down: stop, retry later
      }
      emit();
    }
  } finally {
    running = false;
    emit();
  }
}

export const isSyncing = () => running;

export function startAutoSync() {
  window.addEventListener('online', () => { emit(); syncNow(); });
  window.addEventListener('offline', emit);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(syncNow, 60_000);
  syncNow();
}
