import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const app = createApp({ dataDir });

app.listen(port, () => {
  console.log(`Mission Reports server listening on http://localhost:${port}`);
  console.log(`  Field app:  http://localhost:${port}/`);
  console.log(`  Dashboard:  http://localhost:${port}/admin.html`);
  console.log(`  Data dir:   ${dataDir}`);
  if (!process.env.API_TOKEN) console.warn('  WARNING: API_TOKEN not set - API is open. Set it before exposing this server.');
});
