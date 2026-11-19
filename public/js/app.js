import { store } from './store.js';
import { settings } from './settings.js';
import { processPhoto } from './photos.js';
import { syncNow, startAutoSync, onSyncChange, isSyncing } from './sync.js';

const DEFAULT_MISSION_TYPES = [
  'Site Survey', 'Installation', 'Pre-Commissioning', 'Commissioning / SAT', 'FAT',
  'Preventive Maintenance', 'Corrective Maintenance', 'Fault Investigation',
  'Upgrade / Retrofit', 'Training', 'Other',
];
const DEFAULT_STATUSES = ['Completed', 'Partially Completed', 'On Hold', 'Blocked'];
const STATE_LABEL = { draft: 'Draft', outbox: 'Waiting to send', sent: 'Sent', failed: 'Rejected' };

const $view = document.getElementById('view');
const $net = document.getElementById('net');
const $toast = document.getElementById('toast');

let objectUrls = [];
let cleanupView = () => {};
let homeTab = 'active';

// ---------- helpers ----------
const esc = (v) =>
  v === null || v === undefined ? '' :
    String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function blobUrl(blob) {
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  objectUrls.push(u);
  return u;
}

function toast(msg, ms = 2600) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
}

function localDateTime(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function meta() {
  try {
    const m = JSON.parse(localStorage.getItem('mr.meta') || 'null');
    if (m?.missionTypes?.length) return m;
  } catch { /* ignore */ }
  return { missionTypes: DEFAULT_MISSION_TYPES, statuses: DEFAULT_STATUSES };
}

async function refreshMeta() {
  try {
    const res = await fetch(`${settings.get().serverUrl.replace(/\/$/, '')}/api/meta`);
    if (res.ok) localStorage.setItem('mr.meta', JSON.stringify(await res.json()));
  } catch { /* offline: keep cached list */ }
}

function options(list, selected) {
  return ['<option value="">Select…</option>', ...list.map((v) =>
    `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`)].join('');
}

async function updateNet() {
  const pending = (await store.listReports()).filter((r) => r.state === 'outbox').length;
  const online = navigator.onLine;
  $net.classList.toggle('off', !online);
  $net.textContent = !online
    ? `Offline${pending ? ` · ${pending} queued` : ''}`
    : isSyncing() ? 'Sending…' : pending ? `${pending} queued` : 'Online';
}

// ---------- router ----------
async function route() {
  cleanupView();
  cleanupView = () => {};
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
  window.scrollTo(0, 0);

  const hash = location.hash.replace(/^#/, '') || '/';
  const [, page, id] = hash.split('/');
  if (page === 'new') return newReport();
  if (page === 'edit' && id) return renderForm(id);
  if (page === 'view' && id) return renderDetail(id);
  if (page === 'settings') return renderSettings();
  return renderHome();
}

// ---------- home ----------
async function renderHome() {
  const all = await store.listReports();
  const groups = {
    active: all.filter((r) => r.state !== 'sent'),
    sent: all.filter((r) => r.state === 'sent'),
  };
  const list = groups[homeTab];
  const s = settings.get();

  const items = await Promise.all(list.map(async (r) => {
    const photos = await store.listPhotos(r.id);
    const thumb = photos[0]?.thumb ? `<img src="${blobUrl(photos[0].thumb)}" alt="">` : '<div class="ph"></div>';
    const href = r.state === 'draft' || r.state === 'failed' ? `#/edit/${r.id}` : `#/view/${r.id}`;
    return `<li><a class="item" href="${href}">
      ${thumb}
      <div class="meta">
        <div class="title">${esc(r.site || 'Untitled site')}${r.asset ? ' · ' + esc(r.asset) : ''}</div>
        <div class="sub">${esc(r.mission_type || 'No mission type')} · ${photos.length} photo${photos.length === 1 ? '' : 's'}</div>
        <div class="sub">${esc(fmtDate(r.sentAt || r.updatedAt))}</div>
        ${r.lastError && r.state !== 'sent' ? `<div class="err">${esc(r.lastError)}</div>` : ''}
      </div>
      <span class="pill ${r.state}">${STATE_LABEL[r.state]}</span>
    </a></li>`;
  }));

  $view.innerHTML = `
    ${!s.technician_name ? `<div class="card"><strong>Set up your profile.</strong> Add your name and the server details once in <a href="#/settings">Settings</a>; every new report is pre-filled from it.</div>` : ''}
    <div class="tabs" role="group" aria-label="Filter reports">
      <button data-tab="active" aria-pressed="${homeTab === 'active'}">In progress (${groups.active.length})</button>
      <button data-tab="sent" aria-pressed="${homeTab === 'sent'}">Sent (${groups.sent.length})</button>
    </div>
    ${groups.active.some((r) => r.state === 'outbox') && navigator.onLine
      ? '<button class="btn block" id="sync" style="margin-bottom:12px">Send queued reports now</button>' : ''}
    ${items.length ? `<ul class="list">${items.join('')}</ul>`
      : `<div class="empty">${homeTab === 'active' ? 'No reports in progress.' : 'Nothing sent from this device yet.'}</div>`}
    <a href="#/new" class="btn primary fab">+ New mission report</a>`;

  $view.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { homeTab = b.dataset.tab; renderHome(); }));
  $view.querySelector('#sync')?.addEventListener('click', () => syncNow());
}

// ---------- new / edit ----------
async function newReport() {
  const s = settings.get();
  const report = {
    id: crypto.randomUUID(),
    state: 'draft',
    createdAt: new Date().toISOString(),
    project: s.lastProject || '',
    site: s.lastSite || '',
    technician_name: s.technician_name,
    technician_id: s.technician_id,
    status: 'Completed',
    start_time: localDateTime(),
  };
  await store.putReport(report);
  history.replaceState(null, '', `#/edit/${report.id}`);
  return renderForm(report.id);
}

function field(name, label, value, { type = 'text', req = false, hint = '', attrs = '' } = {}) {
  const l = `<label for="f-${name}">${esc(label)}${req ? ' <span class="req">*</span>' : ''}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}</label>`;
  if (type === 'textarea') return `${l}<textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea>`;
  return `${l}<input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;
}

async function renderForm(id) {
  const report = await store.getReport(id);
  if (!report) { location.hash = '#/'; return; }
  if (report.state === 'outbox' || report.state === 'sent') { location.hash = `#/view/${id}`; return; }

  const m = meta();
  const r = report;
  $view.innerHTML = `
    <h1>${r.state === 'failed' ? 'Fix and resend report' : 'Mission report'}</h1>
    ${r.state === 'failed' && r.lastError ? `<div class="errors">Server rejected this report: ${esc(r.lastError)}</div>` : ''}
    <div id="errors"></div>
    <form id="form" novalidate autocomplete="off">
      <section class="card">
        <h2>Mission</h2>
        ${field('project', 'Project', r.project, { req: true, attrs: 'placeholder="e.g. SCADA upgrade – Region North"' })}
        <div class="row">
          <div>${field('site', 'Site / substation', r.site, { req: true })}</div>
          <div>${field('asset', 'Bay / panel / asset', r.asset, { attrs: 'placeholder="e.g. RTU-02, Bay 3"' })}</div>
        </div>
        <label for="f-mission_type">Mission type <span class="req">*</span></label>
        <select id="f-mission_type" name="mission_type">${options(m.missionTypes, r.mission_type)}</select>
        <div class="row">
          <div>${field('start_time', 'Start', r.start_time, { type: 'datetime-local', req: true })}</div>
          <div>${field('end_time', 'End', r.end_time, { type: 'datetime-local' })}</div>
        </div>
      </section>

      <section class="card">
        <h2>Team & location</h2>
        <div class="row">
          <div>${field('technician_name', 'Lead technician', r.technician_name, { req: true })}</div>
          <div>${field('technician_id', 'Employee ID', r.technician_id)}</div>
        </div>
        ${field('team_members', 'Other team members', r.team_members, { hint: 'comma separated' })}
        <label>GPS position</label>
        <div class="gps">
          <button type="button" class="btn" id="gps">Capture location</button>
          <span class="val" id="gps-val">${r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} (±${Math.round(r.gps_accuracy || 0)} m)` : 'Not captured'}</span>
        </div>
      </section>

      <section class="card">
        <h2>Work</h2>
        <label for="f-status">Outcome <span class="req">*</span></label>
        <select id="f-status" name="status">${options(m.statuses, r.status)}</select>
        ${field('work_performed', 'Work performed', r.work_performed, { type: 'textarea', req: true, attrs: 'placeholder="Activities carried out, tests executed, configuration changes…"' })}
        ${field('findings', 'Findings / measurements', r.findings, { type: 'textarea', attrs: 'placeholder="Readings, test results, firmware versions, as-found / as-left…"' })}
        ${field('issues', 'Issues / non-conformances', r.issues, { type: 'textarea', attrs: 'placeholder="Defects, punch-list items, blockers, NCR numbers…"' })}
        ${field('next_actions', 'Next actions / support needed', r.next_actions, { type: 'textarea' })}
      </section>

      <section class="card">
        <h2>HSE</h2>
        ${field('ptw_number', 'Permit to Work no.', r.ptw_number)}
        ${field('safety_notes', 'Safety observations', r.safety_notes, { type: 'textarea', attrs: 'placeholder="Isolations, LOTO, near misses, hazards observed…"' })}
      </section>

      <section class="card">
        <h2>Photos <span class="req">*</span></h2>
        <div class="photos" id="photos"></div>
        <div class="photo-actions">
          <label class="btn primary" style="margin:0">Take photo
            <input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
          <label class="btn" style="margin:0">From gallery
            <input type="file" accept="image/*" multiple id="gal" hidden></label>
        </div>
        <div class="busy" id="busy" hidden></div>
      </section>

      <section class="card">
        <h2>Client / supervisor acknowledgement</h2>
        ${field('signed_by', 'Name and role', r.signed_by, { attrs: 'placeholder="Optional"' })}
        <label>Signature</label>
        <div class="sig-wrap"><canvas id="sig"></canvas></div>
        <div class="sig-tools"><span class="hint">Sign with finger</span><button type="button" class="btn" id="sig-clear">Clear</button></div>
      </section>

      <button type="button" class="btn danger block" id="discard">Delete this report</button>
    </form>
    <div class="actionbar">
      <button type="button" class="btn" id="save">Save draft</button>
      <button type="button" class="btn primary" id="submit">Submit</button>
    </div>`;

  const form = $view.querySelector('#form');

  // --- autosave every field change ---
  let saveTimer;
  const persist = async () => {
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) if (typeof v === 'string') report[k] = v;
    if (report.state === 'failed') report.state = 'draft';
    if (sigDirty) {
      report.signature = sigEmpty ? null : await new Promise((res) => sig.toBlob(res, 'image/png'));
      sigDirty = false;
    }
    await store.putReport(report);
  };
  form.addEventListener('input', (e) => {
    e.target.classList.remove('invalid');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  });
  cleanupView = () => { clearTimeout(saveTimer); };

  // --- GPS ---
  $view.querySelector('#gps').addEventListener('click', () => {
    const out = $view.querySelector('#gps-val');
    if (!('geolocation' in navigator)) { out.textContent = 'GPS not available on this device'; return; }
    out.textContent = 'Acquiring…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        report.lat = pos.coords.latitude;
        report.lng = pos.coords.longitude;
        report.gps_accuracy = pos.coords.accuracy;
        out.textContent = `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)} (±${Math.round(report.gps_accuracy)} m)`;
        await persist();
      },
      (err) => { out.textContent = `Could not get location: ${err.message}`; },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    );
  });

  // --- photos ---
  const $photos = $view.querySelector('#photos');
  const $busy = $view.querySelector('#busy');
  const drawPhotos = async () => {
    const photos = await store.listPhotos(id);
    $photos.innerHTML = photos.map((p, i) => `
      <div class="photo" data-id="${p.id}">
        <img src="${blobUrl(p.thumb)}" alt="Photo ${i + 1}">
        <span class="num">#${i + 1}</span>
        <button type="button" class="rm" aria-label="Remove photo ${i + 1}">×</button>
        <textarea data-caption placeholder="Caption (what does this show?)">${esc(p.caption)}</textarea>
      </div>`).join('');
  };
  $photos.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('rm')) return;
    if (!confirm('Remove this photo?')) return;
    await store.deletePhoto(e.target.closest('.photo').dataset.id);
    drawPhotos();
  });
  $photos.addEventListener('input', async (e) => {
    if (!e.target.matches('[data-caption]')) return;
    e.stopPropagation();
    const pid = e.target.closest('.photo').dataset.id;
    const p = (await store.listPhotos(id)).find((x) => x.id === pid);
    if (p) { p.caption = e.target.value; await store.putPhoto(p); }
  });

  const addFiles = async (files) => {
    if (!files.length) return;
    await persist();
    const s = settings.get();
    const existing = await store.listPhotos(id);
    let seq = existing.length ? existing[existing.length - 1].seq : 0;
    $busy.hidden = false;
    for (const [i, file] of [...files].entries()) {
      $busy.textContent = `Processing photo ${i + 1} of ${files.length}…`;
      try {
        const takenAt = new Date(file.lastModified || Date.now());
        const stamp = s.stampPhotos ? [
          takenAt.toLocaleString(),
          [report.site, report.asset].filter(Boolean).join(' · ') || report.project || '',
          report.lat != null ? `GPS ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}` : '',
        ].filter(Boolean) : null;
        const { blob, thumb } = await processPhoto(file, { stamp });
        await store.putPhoto({
          id: crypto.randomUUID(), reportId: id, seq: ++seq, caption: '',
          takenAt: takenAt.toISOString(), blob, thumb,
        });
      } catch (err) {
        toast(`Could not read ${file.name || 'photo'}: ${err.message}`, 4000);
      }
    }
    $busy.hidden = true;
    drawPhotos();
  };
  for (const sel of ['#cam', '#gal']) {
    const input = $view.querySelector(sel);
    input.addEventListener('change', async () => { await addFiles(input.files); input.value = ''; });
  }
  drawPhotos();

  // --- signature pad ---
  const sig = $view.querySelector('#sig');
  const ctx = sig.getContext('2d');
  let sigDirty = false;
  let sigEmpty = !report.signature;
  let drawing = false;
  const sizeCanvas = () => {
    const ratio = window.devicePixelRatio || 1;
    sig.width = sig.clientWidth * ratio;
    sig.height = sig.clientHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0a2540';
    if (report.signature) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, sig.clientWidth, sig.clientHeight);
      img.src = blobUrl(report.signature);
    }
  };
  sizeCanvas();
  const pt = (e) => { const b = sig.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  sig.addEventListener('pointerdown', (e) => {
    drawing = true; sig.setPointerCapture(e.pointerId);
    ctx.beginPath(); ctx.moveTo(...pt(e));
  });
  sig.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    ctx.lineTo(...pt(e)); ctx.stroke(); sigDirty = true; sigEmpty = false;
  });
  const end = () => { if (drawing) { drawing = false; persist(); } };
  sig.addEventListener('pointerup', end);
  sig.addEventListener('pointercancel', end);
  $view.querySelector('#sig-clear').addEventListener('click', () => {
    ctx.clearRect(0, 0, sig.width, sig.height);
    sigDirty = true; sigEmpty = true; persist();
  });

  // --- actions ---
  $view.querySelector('#save').addEventListener('click', async () => {
    await persist();
    toast('Draft saved on this device');
    location.hash = '#/';
  });
  $view.querySelector('#discard').addEventListener('click', async () => {
    if (!confirm('Delete this report and its photos from this device?')) return;
    await store.deleteReport(id);
    toast('Report deleted');
    location.hash = '#/';
  });
  $view.querySelector('#submit').addEventListener('click', async () => {
    await persist();
    const photos = await store.listPhotos(id);
    const errors = [];
    const mark = (name, msg) => { form.elements[name]?.classList.add('invalid'); errors.push(msg); };
    if (!report.project?.trim()) mark('project', 'Project is required');
    if (!report.site?.trim()) mark('site', 'Site / substation is required');
    if (!report.mission_type) mark('mission_type', 'Mission type is required');
    if (!report.start_time) mark('start_time', 'Start time is required');
    if (!report.technician_name?.trim()) mark('technician_name', 'Lead technician is required');
    if (!report.status) mark('status', 'Outcome is required');
    if (!report.work_performed?.trim()) mark('work_performed', 'Work performed is required');
    if (report.end_time && report.start_time && report.end_time < report.start_time) mark('end_time', 'End time is before start time');
    if (!photos.length) errors.push('Add at least one photo');
    const $err = $view.querySelector('#errors');
    if (errors.length) {
      $err.innerHTML = `<div class="errors"><strong>Cannot submit yet:</strong><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    report.state = 'outbox';
    report.lastError = null;
    report.submittedAt = new Date().toISOString();
    await store.putReport(report);
    settings.set({ lastProject: report.project, lastSite: report.site });
    toast(navigator.onLine ? 'Sending report…' : 'Saved. Will send automatically when signal returns.', 3500);
    homeTab = 'active';
    location.hash = '#/';
    syncNow();
  });
}

// ---------- read-only detail ----------
async function renderDetail(id) {
  const r = await store.getReport(id);
  if (!r) { location.hash = '#/'; return; }
  const photos = await store.listPhotos(id);
  const s = settings.get();
  const serverLink = r.serverPath
    ? `${s.serverUrl.replace(/\/$/, '')}${r.serverPath}${s.token ? `?token=${encodeURIComponent(s.token)}` : ''}` : '';
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');

  $view.innerHTML = `
    <h1>${esc(r.site)}${r.asset ? ' · ' + esc(r.asset) : ''}</h1>
    <div class="card">
      <span class="pill ${r.state}">${STATE_LABEL[r.state]}</span>
      ${r.state === 'sent' ? `<p class="hint">Received by server ${esc(fmtDate(r.sentAt))}.</p>` : ''}
      ${r.state === 'outbox' ? `<p class="hint">Queued on this device. It uploads automatically when there is a connection.${r.lastError ? ` Last attempt: ${esc(r.lastError)}` : ''}</p>` : ''}
      <dl class="kv">
        ${row('Project', r.project)}${row('Mission', r.mission_type)}${row('Outcome', r.status)}
        ${row('Start', fmtDate(r.start_time))}${row('End', fmtDate(r.end_time))}
        ${row('Technician', r.technician_name)}${row('Team', r.team_members)}${row('PTW', r.ptw_number)}
        ${row('Work', r.work_performed)}${row('Findings', r.findings)}${row('Issues', r.issues)}
        ${row('HSE', r.safety_notes)}${row('Next actions', r.next_actions)}
      </dl>
    </div>
    <div class="card"><h2>Photos (${photos.length})</h2>
      <div class="photos">${photos.map((p, i) => `<div class="photo"><img src="${blobUrl(p.thumb)}" alt=""><span class="num">#${i + 1}</span>${p.caption ? `<div class="hint" style="padding:6px 8px">${esc(p.caption)}</div>` : ''}</div>`).join('')}</div>
    </div>
    ${serverLink ? `<a class="btn primary block" href="${esc(serverLink)}" target="_blank" rel="noopener">Open full report</a>` : ''}
    ${r.state === 'outbox' ? '<button class="btn block" id="unqueue">Move back to drafts to edit</button>' : ''}
    ${r.state === 'sent' ? '<button class="btn danger block" id="forget" style="margin-top:10px">Remove from this device</button>' : ''}`;

  $view.querySelector('#unqueue')?.addEventListener('click', async () => {
    if (isSyncing()) { toast('Upload in progress, try again in a moment'); return; }
    r.state = 'draft';
    await store.putReport(r);
    location.hash = `#/edit/${id}`;
  });
  $view.querySelector('#forget')?.addEventListener('click', async () => {
    if (!confirm('Remove the local copy? The report stays on the server.')) return;
    await store.deleteReport(id);
    location.hash = '#/';
  });
}

// ---------- settings ----------
function renderSettings() {
  const s = settings.get();
  $view.innerHTML = `
    <h1>Settings</h1>
    <form id="sf" class="card">
      <h2>Profile</h2>
      ${field('technician_name', 'Your name', s.technician_name)}
      ${field('technician_id', 'Employee ID', s.technician_id)}
      <h2 style="margin-top:20px">Server</h2>
      ${field('serverUrl', 'Server address', s.serverUrl, { type: 'url' })}
      ${field('token', 'Access token', s.token, { type: 'password', hint: 'issued by your project office' })}
      <div class="switch" style="margin-top:16px">
        <label for="f-stamp" style="margin:0">Stamp date, site and GPS on photos</label>
        <input type="checkbox" id="f-stamp" ${s.stampPhotos ? 'checked' : ''}>
      </div>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button type="button" class="btn" id="test">Test connection</button>
        <button type="submit" class="btn primary" style="flex:1">Save</button>
      </div>
      <p class="hint" id="test-out"></p>
    </form>
    <p class="hint">Install: in the browser menu choose “Add to Home screen” / “Install app”. Reports and photos are stored on this device until the server confirms receipt.</p>`;

  const f = $view.querySelector('#sf');
  const values = () => ({
    technician_name: f.elements.technician_name.value.trim(),
    technician_id: f.elements.technician_id.value.trim(),
    serverUrl: f.elements.serverUrl.value.trim() || location.origin,
    token: f.elements.token.value.trim(),
    stampPhotos: f.querySelector('#f-stamp').checked,
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    settings.set(values());
    refreshMeta();
    toast('Settings saved');
    location.hash = '#/';
  });
  $view.querySelector('#test').addEventListener('click', async () => {
    const out = $view.querySelector('#test-out');
    const v = values();
    out.textContent = 'Checking…';
    try {
      const base = v.serverUrl.replace(/\/$/, '');
      const health = await (await fetch(`${base}/api/health`)).json();
      if (health.authRequired) {
        const res = await fetch(`${base}/api/reports?limit=1`, { headers: v.token ? { Authorization: `Bearer ${v.token}` } : {} });
        out.textContent = res.ok ? 'Connected. Token accepted.' : 'Server reachable, but the access token was rejected.';
      } else {
        out.textContent = 'Connected.';
      }
    } catch (err) {
      out.textContent = `Cannot reach server: ${err.message}`;
    }
  });
}

// ---------- boot ----------
window.addEventListener('hashchange', route);
onSyncChange(async () => {
  updateNet();
  const hash = location.hash || '#/';
  if (hash === '#/' || hash.startsWith('#/view/')) route();
});
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

route();
updateNet();
refreshMeta();
startAutoSync();
