const KEY = 'mr.settings';
const defaults = {
  serverUrl: location.origin,
  token: '',
  technician_name: '',
  technician_id: '',
  stampPhotos: true,
};

function read() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export const settings = {
  get: read,
  set(patch) {
    const next = { ...read(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  },
};
