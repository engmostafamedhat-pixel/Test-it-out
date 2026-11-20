# Site Mission Reports

Mobile app for site teams to file mission reports with photo evidence, built for field conditions in grid automation work: substations with no signal, gloves, sunlight, and photo evidence that must hold up in a punch-list or client dispute.

| Component | Path | Users |
|---|---|---|
| Field app (installable PWA, offline-first) | `public/index.html` | Technicians and engineers on site |
| Back-office dashboard | `public/admin.html` | Project office, PM, site managers |
| Printable report (Print / Save as PDF) | `/reports/:id` | Client, QA, archive |
| REST API + storage | `server/` | Integrations (ERP, DMS, SharePoint) |

## Field app capabilities

- **Report form**: project, site/substation, bay/panel/asset, mission type (Survey, Installation, Pre-Commissioning, SAT, FAT, PM/CM, Fault Investigation, Upgrade, Training), start/end time, lead engineer, team, outcome (Completed / Partially / On Hold / Blocked), work performed, findings/measurements, issues/NCRs, next actions, Permit-to-Work number, HSE observations.
- **Photos**: camera capture or gallery, caption per photo, removal. Each photo is orientation-corrected, downscaled to 1920 px and compressed on the device (12 MP, 4–8 MB → about 300–600 KB). Date, site/asset and GPS are optionally stamped into the image, so the evidence stays with the photo after it is exported.
- **GPS capture** with stated accuracy.
- **Client/supervisor acknowledgement**: name, role, finger signature.
- **Offline-first**: the app shell is cached by a service worker. Reports and photos are stored in IndexedDB. Submitted reports go to an outbox and upload automatically when a connection is available (on reconnect, when the app regains focus, and every 60 s). Drafts save themselves while you type.
- **No duplicate reports**: the report ID is generated on the device, and the server treats a repeated ID as already received. A retry after a dropped connection therefore cannot create a second copy.
- **Storage hygiene**: after the server confirms receipt, full-size images are removed from the phone and thumbnails are kept.
- **iPhone safeguards**:
  - Opened in a Safari tab, the app shows step-by-step install instructions. It warns that data created in a Safari tab stays separate from the installed app.
  - Reports left unsent for more than 8 hours trigger a red warning.
  - The home-screen icon can show a count of unsent reports.
  - The app resumes syncing as soon as it is brought back to the foreground.
- Validation happens on the device and again on the server. Reports the server rejects are marked "Rejected" with the reason and can be corrected and resent.

## Quick start

**Windows:** double-click `start-server.cmd`. On first run it installs dependencies. It asks for the access token, prints the addresses for the PC and phone, and starts the server. Because it runs in cmd, the PowerShell script policy that blocks `npm` does not apply.

**Any OS:**

```bash
npm install
API_TOKEN=change-me npm start        # http://localhost:3000
```

- Field app: `http://<server>:3000/`. On the phone, open it and choose **Add to Home screen** / **Install app**. In **Settings**, enter your name, employee ID and the access token.
- Dashboard: `http://<server>:3000/admin.html`. It offers search, filters, KPIs, CSV export, and links to each printable report.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite DB (`reports.db`) and photos (`uploads/<reportId>/`) |
| `API_TOKEN` | *(empty: API open)* | Shared bearer token for app and dashboard. **Mandatory outside a lab.** |

Requires Node.js ≥ 22.13, which provides built-in `node:sqlite`, so there are no native modules to compile.

**HTTPS is required in production.** Browsers allow camera, GPS, service workers and installation only over HTTPS (localhost is the exception). Put the server behind a reverse proxy (IIS/ARR, nginx, Azure App Service, etc.) with a valid certificate.

## Tests

```bash
npm test            # API: auth, idempotent upload, validation, file-type rejection, CSV injection guard
npm run test:e2e    # Phone-emulated browser run (Playwright): settings, validation, photo,
                    # GPS, signature, online submit, offline queue -> automatic resend
```

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/reports` | multipart: `report` (JSON), `photos[]` (JPEG/PNG/WebP/HEIC, max 40 × 15 MB), `signature` (optional). Returns 201 when created, 200 `{duplicate:true}` when already received, 422 with `details[]` when validation fails. |
| `GET` | `/api/reports` | Filters: `q`, `site`, `status`, `mission_type`, `from`, `to`, `limit` |
| `GET` | `/api/reports/:id` | Report with its photo list |
| `GET` | `/api/reports.csv` | Export with spreadsheet-formula neutralisation |
| `GET` | `/reports/:id` | Printable HTML report |
| `GET` | `/files/:id/:name` | Photo and signature files |
| `GET` | `/api/meta` | Mission types and outcomes. The app uses this list, so editing `MISSION_TYPES` in `server/app.js` updates every device. |

Auth: `Authorization: Bearer <API_TOKEN>`, or `?token=` for browser links.

## Risk register: close these before production rollout

| # | Risk | Impact | Mitigation in this build | Action required |
|---|---|---|---|---|
| R1 | One shared token; no individual identity | No individual accountability or revocation; the lead engineer name is typed in by the user | Constant-time token check; the token is kept in session storage for the dashboard | Integrate corporate SSO (Entra ID / OIDC) with field and office roles before go-live |
| R2 | Single server with local disk storage | Loss of the evidence archive | SQLite in WAL mode, with files grouped per report | Schedule backups of `DATA_DIR`, or move photos to object storage (S3/Azure Blob). Define the retention period per contract. |
| R3 | Data left on the phone if it is lost before sync | Lost reports, or exposure of client site data | Data persists until confirmed; `navigator.storage.persist()` is requested | Require MDM-managed devices. Instruct teams to sync before leaving the site. |
| R4 | iOS has no background sync; iOS can clear storage of a web app that goes unused for a long period | Unsent reports lost on rarely used iPhones | Install guide shown in Safari tabs; red warning for reports unsent after 8 h; unsent count on the app icon (iOS 16.4+, after notification permission); sync when the app is resumed or regains focus; storage-protection status shown in Settings | Sync before leaving site. If iPhones are the main platform, build the native iOS wrapper (Capacitor) |
| R5 | Photos of critical infrastructure (substation layouts, protection settings) | Security and regulatory exposure (NERC CIP / IEC 62443 / national CI rules) | Files are served only with the token; there are no public URLs | Have the client's cybersecurity function classify the data. Host on approved infrastructure only. |
| R6 | Free-text fields only, with no structured test results | Weak analytics | Search and CSV export are available | Phase 2: structured checklists per mission type (ITP/test-sheet templates) |

## Suggested roadmap

1. **Pilot (2 weeks)**: one project, 5–10 technicians, HTTPS host, token auth. Measure the share of reports submitted on the day of the mission, average photos per report, and how many sync failures need support.
2. **Hardening**: SSO and roles, backups and object storage, audit log, approval workflow for site managers (Submitted → Reviewed → Accepted by client).
3. **Integration**: push accepted reports as PDF to the document management system or SharePoint; link them to ERP work orders and NCR registers.
4. **Structured content**: mission-type checklists, punch-list items with owner and due date, QR scan of asset tags.
