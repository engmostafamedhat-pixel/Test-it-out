import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  project         TEXT NOT NULL,
  site            TEXT NOT NULL,
  asset           TEXT,
  mission_type    TEXT NOT NULL,
  status          TEXT NOT NULL,
  technician_name TEXT NOT NULL,
  technician_id   TEXT,
  team_members    TEXT,
  start_time      TEXT,
  end_time        TEXT,
  ptw_number      TEXT,
  work_performed  TEXT NOT NULL,
  findings        TEXT,
  issues          TEXT,
  safety_notes    TEXT,
  next_actions    TEXT,
  lat             REAL,
  lng             REAL,
  gps_accuracy    REAL,
  signed_by       TEXT,
  signature_file  TEXT,
  created_at      TEXT NOT NULL,
  received_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_received ON reports(received_at);
CREATE INDEX IF NOT EXISTS idx_reports_site ON reports(site);

CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  report_id  TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  caption    TEXT,
  taken_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_photos_report ON photos(report_id);
`;

export const REPORT_FIELDS = [
  'project', 'site', 'asset', 'mission_type', 'status', 'technician_name', 'technician_id',
  'team_members', 'start_time', 'end_time', 'ptw_number', 'work_performed', 'findings',
  'issues', 'safety_notes', 'next_actions', 'lat', 'lng', 'gps_accuracy', 'signed_by',
];

export function openDb(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'reports.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const insertReport = db.prepare(`
    INSERT INTO reports (id, ${REPORT_FIELDS.join(', ')}, signature_file, created_at, received_at)
    VALUES (:id, ${REPORT_FIELDS.map((f) => ':' + f).join(', ')}, :signature_file, :created_at, :received_at)
  `);
  const insertPhoto = db.prepare(`
    INSERT INTO photos (id, report_id, seq, filename, mime, size, caption, taken_at)
    VALUES (:id, :report_id, :seq, :filename, :mime, :size, :caption, :taken_at)
  `);
  const getReport = db.prepare('SELECT * FROM reports WHERE id = ?');
  const getPhotos = db.prepare('SELECT * FROM photos WHERE report_id = ? ORDER BY seq');

  return {
    raw: db,
    exists(id) {
      return !!getReport.get(id);
    },
    insert(report, photos) {
      db.exec('BEGIN');
      try {
        insertReport.run(report);
        for (const p of photos) insertPhoto.run(p);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    get(id) {
      const report = getReport.get(id);
      if (!report) return null;
      return { ...report, photos: getPhotos.all(id) };
    },
    list({ q, site, status, missionType, from, to, limit = 200 } = {}) {
      const where = [];
      const params = {};
      if (q) {
        where.push(`(project LIKE :q OR site LIKE :q OR asset LIKE :q OR technician_name LIKE :q
                     OR work_performed LIKE :q OR findings LIKE :q OR issues LIKE :q)`);
        params.q = `%${q}%`;
      }
      if (site) { where.push('site = :site'); params.site = site; }
      if (status) { where.push('status = :status'); params.status = status; }
      if (missionType) { where.push('mission_type = :mt'); params.mt = missionType; }
      if (from) { where.push('COALESCE(start_time, created_at) >= :from'); params.from = from; }
      if (to) { where.push('COALESCE(start_time, created_at) <= :to'); params.to = to; }
      params.limit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
      const sql = `
        SELECT r.*, (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
        FROM reports r
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY received_at DESC
        LIMIT :limit`;
      return db.prepare(sql).all(params);
    },
  };
}
