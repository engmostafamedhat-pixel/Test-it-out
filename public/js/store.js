// Local persistence (IndexedDB). Everything a technician captures lives on the
// device until the server confirms receipt, so no work is lost without signal.

const DB_NAME = 'mission-reports';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const reports = db.createObjectStore('reports', { keyPath: 'id' });
        reports.createIndex('state', 'state');
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('reportId', 'reportId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  const t = db.transaction(stores, mode);
  const result = await fn(...(Array.isArray(stores) ? stores : [stores]).map((s) => t.objectStore(s)));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
  return result;
}

export const store = {
  async listReports() {
    const all = await tx('reports', 'readonly', (s) => promisify(s.getAll()));
    return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },
  getReport(id) {
    return tx('reports', 'readonly', (s) => promisify(s.get(id)));
  },
  putReport(report) {
    report.updatedAt = new Date().toISOString();
    return tx('reports', 'readwrite', (s) => promisify(s.put(report)));
  },
  async listPhotos(reportId) {
    const photos = await tx('photos', 'readonly', (s) => promisify(s.index('reportId').getAll(reportId)));
    return photos.sort((a, b) => a.seq - b.seq);
  },
  putPhoto(photo) {
    return tx('photos', 'readwrite', (s) => promisify(s.put(photo)));
  },
  deletePhoto(id) {
    return tx('photos', 'readwrite', (s) => promisify(s.delete(id)));
  },
  async deleteReport(id) {
    await tx(['reports', 'photos'], 'readwrite', async (reports, photos) => {
      const keys = await promisify(photos.index('reportId').getAllKeys(id));
      keys.forEach((k) => photos.delete(k));
      reports.delete(id);
    });
  },
  // After a successful upload, drop the full-size images to free device storage
  // but keep thumbnails so the technician still sees what was sent.
  async purgeFullImages(reportId) {
    await tx('photos', 'readwrite', async (photos) => {
      const list = await promisify(photos.index('reportId').getAll(reportId));
      list.forEach((p) => { p.blob = null; photos.put(p); });
    });
  },
};
