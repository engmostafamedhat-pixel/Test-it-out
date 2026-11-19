import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, REPORT_FIELDS } from './db.js';
import { renderReportHtml } from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export const MISSION_TYPES = [
  'Site Survey', 'Installation', 'Pre-Commissioning', 'Commissioning / SAT', 'FAT',
  'Preventive Maintenance', 'Corrective Maintenance', 'Fault Investigation',
  'Upgrade / Retrofit', 'Training', 'Other',
];
export const STATUSES = ['Completed', 'Partially Completed', 'On Hold', 'Blocked'];

const MAX_PHOTOS = 40;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function str(v, max = 10000) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validateReport(input) {
  const errors = [];
  const r = {};
  for (const f of REPORT_FIELDS) {
    r[f] = ['lat', 'lng', 'gps_accuracy'].includes(f) ? num(input[f]) : str(input[f]);
  }
  for (const f of ['project', 'site', 'mission_type', 'status', 'technician_name', 'work_performed']) {
    if (!r[f]) errors.push(`${f} is required`);
  }
  if (r.mission_type && !MISSION_TYPES.includes(r.mission_type)) errors.push('mission_type is invalid');
  if (r.status && !STATUSES.includes(r.status)) errors.push('status is invalid');
  if (r.lat !== null && (r.lat < -90 || r.lat > 90)) errors.push('lat out of range');
  if (r.lng !== null && (r.lng < -180 || r.lng > 180)) errors.push('lng out of range');
  if (r.start_time && r.end_time && Date.parse(r.end_time) < Date.parse(r.start_time)) {
    errors.push('end_time is before start_time');
  }
  return { report: r, errors };
}

export function createApp({ dataDir, apiToken = process.env.API_TOKEN || '' } = {}) {
  const uploadDir = path.join(dataDir, 'uploads');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const db = openDb(dataDir);

  const upload = multer({
    dest: tmpDir,
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_PHOTOS + 1, fields: 10, fieldSize: 1024 * 1024 },
    fileFilter(_req, file, cb) {
      if (!IMAGE_EXT[file.mimetype]) return cb(new HttpError(415, `Unsupported file type: ${file.mimetype}`));
      cb(null, true);
    },
  });

  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;

  function requireToken(req, _res, next) {
    if (!apiToken) return next();
    const header = req.get('authorization') || '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : req.query.token || '';
    const a = Buffer.from(String(supplied));
    const b = Buffer.from(apiToken);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
    next(new HttpError(401, 'Invalid or missing access token'));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, authRequired: !!apiToken }));
  app.get('/api/meta', (_req, res) => res.json({ missionTypes: MISSION_TYPES, statuses: STATUSES }));

  app.post(
    '/api/reports',
    requireToken,
    upload.fields([{ name: 'photos', maxCount: MAX_PHOTOS }, { name: 'signature', maxCount: 1 }]),
    (req, res, next) => {
      const files = [...(req.files?.photos || []), ...(req.files?.signature || [])];
      const cleanup = () => files.forEach((f) => fs.rmSync(f.path, { force: true }));
      try {
        let input;
        try {
          input = JSON.parse(req.body?.report || '');
        } catch {
          throw new HttpError(400, 'Field "report" must be valid JSON');
        }
        const id = String(input.id || '');
        if (!UUID_RE.test(id)) throw new HttpError(400, 'Report id must be a client-generated UUID');

        // Idempotent: a retry after a dropped connection must not create a duplicate.
        if (db.exists(id)) {
          cleanup();
          return res.status(200).json({ id, duplicate: true, url: `/reports/${id}` });
        }

        const { report, errors } = validateReport(input);
        const photoFiles = req.files?.photos || [];
        if (photoFiles.length === 0) errors.push('At least one photo is required');
        if (errors.length) throw new HttpError(422, 'Validation failed', errors);

        const meta = Array.isArray(input.photos) ? input.photos : [];
        const reportDir = path.join(uploadDir, id);
        fs.mkdirSync(reportDir, { recursive: true });

        const photos = photoFiles.map((f, i) => {
          const photoId = crypto.randomUUID();
          const filename = `${String(i + 1).padStart(2, '0')}-${photoId}${IMAGE_EXT[f.mimetype]}`;
          fs.renameSync(f.path, path.join(reportDir, filename));
          return {
            id: photoId,
            report_id: id,
            seq: i + 1,
            filename,
            mime: f.mimetype,
            size: f.size,
            caption: str(meta[i]?.caption, 500),
            taken_at: str(meta[i]?.taken_at, 40),
          };
        });

        let signatureFile = null;
        const sig = req.files?.signature?.[0];
        if (sig) {
          signatureFile = `signature${IMAGE_EXT[sig.mimetype]}`;
          fs.renameSync(sig.path, path.join(reportDir, signatureFile));
        }

        db.insert(
          {
            id,
            ...report,
            signature_file: signatureFile,
            created_at: str(input.created_at, 40) || new Date().toISOString(),
            received_at: new Date().toISOString(),
          },
          photos,
        );
        res.status(201).json({ id, url: `/reports/${id}`, photos: photos.length });
      } catch (err) {
        cleanup();
        next(err);
      }
    },
  );

  app.get('/api/reports', requireToken, (req, res) => {
    res.json(db.list({
      q: req.query.q, site: req.query.site, status: req.query.status,
      missionType: req.query.mission_type, from: req.query.from, to: req.query.to, limit: req.query.limit,
    }));
  });

  app.get('/api/reports.csv', requireToken, (req, res) => {
    const rows = db.list({ q: req.query.q, from: req.query.from, to: req.query.to, limit: 1000 });
    const cols = ['id', 'received_at', ...REPORT_FIELDS, 'photo_count'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    res.type('text/csv').attachment(`mission-reports-${new Date().toISOString().slice(0, 10)}.csv`).send(csv);
  });

  app.get('/api/reports/:id', requireToken, (req, res, next) => {
    const r = db.get(req.params.id);
    if (!r) return next(new HttpError(404, 'Report not found'));
    res.json(r);
  });

  app.get('/files/:id/:name', requireToken, (req, res, next) => {
    const { id, name } = req.params;
    if (!UUID_RE.test(id) || !/^[\w.-]+$/.test(name)) return next(new HttpError(404, 'Not found'));
    res.sendFile(path.join(uploadDir, id, name), { maxAge: '7d', immutable: true }, (err) => {
      if (err) next(new HttpError(404, 'Not found'));
    });
  });

  app.get('/reports/:id', requireToken, (req, res, next) => {
    const r = db.get(req.params.id);
    if (!r) return next(new HttpError(404, 'Report not found'));
    const token = apiToken ? String(req.query.token || '') : '';
    res.type('html').send(renderReportHtml(r, token));
  });

  app.use(express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status || 500;
    if (err instanceof multer.MulterError) status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, details: err.details });
  });

  return app;
}
