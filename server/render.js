const esc = (v) =>
  v === null || v === undefined
    ? ''
    : String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

const block = (label, text) =>
  text ? `<section><h2>${label}</h2><p class="pre">${esc(text)}</p></section>` : '';

export function renderReportHtml(r, token = '') {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  const file = (name) => `/files/${r.id}/${encodeURIComponent(name)}${q}`;
  const gps =
    r.lat !== null && r.lng !== null
      ? `<a href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</a>${r.gps_accuracy ? ` (±${Math.round(r.gps_accuracy)} m)` : ''}`
      : '—';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mission Report – ${esc(r.site)}</title>
<style>
  :root{--ink:#14202b;--muted:#5b6b78;--line:#d6dde3;--accent:#0b6e4f}
  *{box-sizing:border-box} body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);margin:0;background:#fff}
  main{max-width:900px;margin:0 auto;padding:24px 16px 48px}
  header{border-bottom:3px solid var(--accent);padding-bottom:12px;margin-bottom:16px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin:20px 0 6px}
  .sub{color:var(--muted)} .pre{white-space:pre-wrap;margin:0}
  table{width:100%;border-collapse:collapse} td{border:1px solid var(--line);padding:6px 8px;vertical-align:top}
  td:nth-child(odd){background:#f4f7f9;font-weight:600;width:22%}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;background:#e6f2ee;color:var(--accent);font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  figure{margin:0;border:1px solid var(--line);border-radius:6px;overflow:hidden;break-inside:avoid}
  figure img{display:block;width:100%;height:auto} figcaption{padding:6px 8px;font-size:12px;color:var(--muted)}
  .sig img{max-width:320px;border:1px solid var(--line);border-radius:4px}
  .actions{margin:12px 0} .actions button{padding:8px 14px;font:inherit;cursor:pointer}
  @media print{.actions{display:none} main{padding:0} .grid{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body><main>
<header>
  <h1>Site Mission Report</h1>
  <div class="sub">${esc(r.project)} · ${esc(r.site)}${r.asset ? ' · ' + esc(r.asset) : ''}</div>
</header>
<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
<table>
  <tr><td>Mission type</td><td>${esc(r.mission_type)}</td><td>Status</td><td><span class="badge">${esc(r.status)}</span></td></tr>
  <tr><td>Lead engineer</td><td>${esc(r.technician_name)}${r.technician_id ? ` (${esc(r.technician_id)})` : ''}</td><td>Team</td><td>${esc(r.team_members) || '—'}</td></tr>
  <tr><td>Start</td><td>${fmt(r.start_time)}</td><td>End</td><td>${fmt(r.end_time)}</td></tr>
  <tr><td>Permit to Work</td><td>${esc(r.ptw_number) || '—'}</td><td>GPS</td><td>${gps}</td></tr>
  <tr><td>Report ID</td><td style="font-family:monospace;font-size:12px">${esc(r.id)}</td><td>Received</td><td>${fmt(r.received_at)}</td></tr>
</table>
${block('Work performed', r.work_performed)}
${block('Findings / measurements', r.findings)}
${block('Issues / non-conformances', r.issues)}
${block('HSE observations', r.safety_notes)}
${block('Next actions', r.next_actions)}
<section><h2>Photo evidence (${r.photos.length})</h2><div class="grid">
${r.photos
  .map(
    (p) => `<figure><a href="${file(p.filename)}" target="_blank"><img loading="lazy" src="${file(p.filename)}" alt="${esc(p.caption || 'Photo ' + p.seq)}"></a>
<figcaption><strong>#${p.seq}</strong> ${esc(p.caption) || ''}${p.taken_at ? ` · ${fmt(p.taken_at)}` : ''}</figcaption></figure>`,
  )
  .join('\n')}
</div></section>
${
  r.signature_file
    ? `<section class="sig"><h2>Client / supervisor acknowledgement</h2><img src="${file(r.signature_file)}" alt="Signature"><div>${esc(r.signed_by) || ''}</div></section>`
    : ''
}
</main></body></html>`;
}
