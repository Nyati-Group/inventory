# NYATI Procurement & Inventory Automation

Project-based buying cycle for NYATI: **material need â†’ RFQ â†’ vendor quotations (text / PDF / Word) â†’ automatic extraction & comparison â†’ recommendation â†’ multi-level approval â†’ purchase order â†’ delivery â†’ GRN & inspection â†’ automatic 5-pointer vendor rating** that feeds the next recommendation. Everything is scoped to the project selected in the top bar.

Stack: Next.js 14 (App Router) Â· TypeScript Â· Tailwind Â· Radix primitives Â· TanStack Table Â· Recharts Â· react-hook-form + zod Â· **MongoDB + Prisma** Â· NextAuth (credentials, roles) Â· pdf-lib / docxtemplater Â· pdfjs-dist + mammoth Â· **Google Gemini** (structured JSON output) Â· Nodemailer / Resend.

---

## Quick start

Requires **Node â‰¥ 22.3** and a **MongoDB replica set**: MongoDB Atlas (any tier, including the free one) or the Docker Compose file in this repo. Prisma needs a replica set because it uses transactions.

1. `cp .env.example .env`, then set:
   ```
   MONGODB_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority"
   MONGODB_DB="nyati_procurement"
   ```
   On Atlas, also allow your server's IP under *Network Access*. For local Docker: `npm run db:up` and `MONGODB_URI="mongodb://localhost:27017/?replicaSet=rs0&directConnection=true"`.
2. Install and start:
   ```bash
   npm install
   npm run db:seed      # creates collections + indexes (prisma db push) and loads demo data
   npm run dev          # http://localhost:3000
   ```
   `npm run db:seed` **wipes the database** before loading demo data. For a fresh production database, run `npm run db:push` instead (indexes only) and create the first admin user (see *Going live*).

`MONGODB_URI` and `MONGODB_DB` are combined into Prisma's connection string by `src/lib/mongo-url.ts`. If you prefer a single `DATABASE_URL` that already contains the database name, that works too.

### Demo accounts (password `nyati123`)

| Email | Role |
|---|---|
| admin@nyati.in | Admin (everything, System Settings) |
| buyer@nyati.in | Procurement Manager |
| approver@nyati.in | Approver: Project Head (level 1, all amounts) |
| finance@nyati.in | Approver: Finance (level 2, â‰¥ â‚¹5 L) |
| site@nyati.in | Site / Store Engineer |

### Seed data

1 company Â· 3 projects (Pune, Bengaluru, Navi Mumbai) Â· 25 materials Â· 12 vendors with per-project distances Â· 12 months of purchase-rate history Â· 38 closed orders with GRNs and 5-pointer ratings Â· 2 live RFQs with quotations submitted as **typed text, PDF and DOCX** (parsed by the job runner about 10 s after the app starts) Â· one accepted PO in transit, ready for a GRN Â· low-stock materials.

---

## Vendor links: what they need

Vendors never log in. Each vendor gets a private link:

| Link | Used for | Valid |
|---|---|---|
| `<VENDOR_PORTAL_URL>/vendor/rfq/<token>` | View the RFQ, download the RFQ PDF, submit or revise a quotation (text, PDF, Word, image, Excel), or decline | Accepts quotations until that vendor's deadline; the page stays viewable `VENDOR_LINK_GRACE_HOURS` (default 24) after it |
| `<VENDOR_PORTAL_URL>/vendor/po/<token>` | Accept the PO or request a change, post dispatch details (vehicle, driver, ETA), report a delay | `VENDOR_PO_LINK_DAYS` (default 120) after the PO is sent |

**For links to work from outside your office you need:**

1. **A public HTTPS address** for the app (for example `https://procure.nyati.in`), set as `APP_URL` and `NEXTAUTH_URL`. Set `VENDOR_PORTAL_URL` only if vendors should use a different public address. While the address is `localhost`, the app shows a warning next to every link, because vendors can't open it.
2. **Email sending** (SMTP or Resend) with demo mode switched off, so links reach vendors automatically. You can also copy a link or share it on **WhatsApp** from the RFQ page (*Vendors & delivery* tab) and the PO page. WhatsApp sharing uses the vendor's WhatsApp/phone number from the vendor master.
3. **A stable `NEXTAUTH_SECRET`.** It encrypts the stored copy of each link (so reminders can re-send it) and signs file downloads. Changing it breaks links that were already sent.
4. Paths `/vendor/*`, `/api/vendor/*` and `/api/files` must stay publicly reachable (the middleware already allows them). Everything else needs a login.

**Security.** Each link is a 32-byte random token that covers one vendor and one RFQ (or one PO). The database stores only its SHA-256 hash for lookup, plus an AES-256-GCM copy for reminders. Unknown or expired tokens show a neutral "link not valid" page. Requests are rate-limited per IP and per token. Opens and submissions are logged with IP and browser. If a link was forwarded to the wrong person, use **New link** on the RFQ page: the old link stops working at once, and quotations already received are kept.

---

## Demo walkthrough

Demo mode is on: **no email leaves the app**. Emails appear in **Demo Outbox** (envelope icon in the top bar), and every vendor link is also on the RFQ page.

1. Sign in as `buyer@nyati.in`. On **Procurement**, low-stock rows are red and a banner offers one-click RFQs.
2. Click **RFQ** on a material â†’ quantity is pre-filled â†’ **Next**. Vendors are sorted by fit (distance and lead-time feasibility plus rating) â†’ **Preview RFQ PDF** â†’ **Send RFQ**.
3. **Open RFQ** â†’ *Vendors & delivery* shows per-vendor status with **Open vendor portal**, **Copy link**, **WhatsApp** and **New link** for each vendor.
4. In the vendor portal, submit a quote by typing text, uploading a PDF, or uploading a Word file; revise it, or decline.
5. **Quotations** tab: extracted fields, confidence, deviations and revision history. Low-confidence quotes go to a side-by-side **Needs review** screen.
6. **Comparison** tab: the recommendation with an explanation, the runner-up, "Why not the cheapest?", a split-order suggestion, what-if weights and charts â†’ **Send for approval**.
7. Approve as `approver@nyati.in`, then `finance@nyati.in` (orders â‰¥ â‚¹5 L). This creates the **PO**, and the other vendors get a "not selected" email.
8. On the PO: **Send PO to vendor** â†’ open the vendor PO link â†’ **Accept** and post dispatch details â†’ **Record GRN**. Accepted quantity is added to stock; rejected quantity raises a return request.
9. When the full quantity has been accepted, the PO **closes automatically** and the **5-pointer rating** is computed. **Vendor Ratings** shows the league table, breakdowns, trends, and an audited Â±1â˜… override. The new rating changes the next RFQ's vendor ordering and comparison scores.

The same flow runs as an automated test: `npm run test:flow` (against the database in `.env`; it adds records, so use a demo database).

---

## Scripts

| Script | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:push` | create or update collections and indexes in MongoDB (safe, keeps data) |
| `npm run db:seed` | `db:push` + **wipe** + load demo data |
| `npm run db:up` | local MongoDB replica set via Docker |
| `npm run db:studio` | Prisma Studio (browse data) |
| `npm run create-admin -- <email> "<name>" "<password>"` | create or reset an admin user |
| `npm test` | unit tests: scoring, rating, landed cost, units, extraction, MongoDB URL, vendor links |
| `npm run test:flow` | end-to-end service flow (RFQ â†’ â€¦ â†’ rating) against the seeded database |
| `npm run test:e2e` | Playwright browser smoke test (`npx playwright install chromium` first) |

---

## Environment variables

See `.env.example`.

| Variable | Purpose | Without it |
|---|---|---|
| `MONGODB_URI`, `MONGODB_DB` | database | required |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | sessions; the secret also encrypts vendor-link copies and signs file URLs | required |
| `APP_URL` | public address used in emails | falls back to `NEXTAUTH_URL` |
| `VENDOR_PORTAL_URL`, `VENDOR_LINK_GRACE_HOURS`, `VENDOR_PO_LINK_DAYS` | vendor links (see above) | `APP_URL`, 24 h, 120 days |
| `DEMO_MODE` | initial demo-mode value (toggle later in System Settings) | `true` |
| `EMAIL_PROVIDER` = `smtp` \| `resend`, `EMAIL_FROM`, `SMTP_*`, `RESEND_API_KEY` | outgoing email | failures are logged and retried |
| `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.8-flash`) | quotation reading (text, PDF, scanned PDFs, photos) and market-price extraction | rule-based extractor; scanned PDFs and photos go to manual review |
| `MAPS_PROVIDER` = `google` \| `ors` \| `haversine`, `GOOGLE_MAPS_API_KEY`, `ORS_API_KEY` | geocoding + driving distance | straight-line distance Ã— 1.3 road factor |
| `MARKET_RATE_PROVIDER` = `tavily` \| `serper` \| `demo`, `TAVILY_API_KEY`, `SERPER_API_KEY` | online market rates | demo provider, clearly labelled as simulated |
| `STORAGE_DRIVER` = `local` \| `s3`, `S3_*` | file storage | `./.data/uploads` |
| `CRON_SECRET` | protects `/api/cron` | endpoint disabled |

---

## Swapping providers

- **LLM**: `src/lib/llm.ts` â†’ `llmJson()` calls Gemini with `responseMimeType: "application/json"` + `responseJsonSchema`, validates with zod, and retries once on invalid output. PDFs and images are sent inline, so Gemini reads scanned documents directly.
- **Email**: `src/lib/email/service.ts` (`EmailService`: SMTP, Resend). All sends go through `queueEmail()`, which is idempotent, writes `EmailLog`, and retries with back-off.
- **Maps**: `src/lib/geo.ts`. **Market rates**: `src/lib/market-rates.ts` (`MarketRateProvider`). **Storage**: `src/lib/storage.ts` (local, S3; S3 needs `npm i @aws-sdk/client-s3`).
- **Jobs**: `src/lib/jobs.ts` is a database-backed queue plus sweeps every minute (emails, parsing, reminders, deadline closing, low-stock and delivery-delay alerts). It runs inside the app; with several app instances, set `DISABLE_JOB_RUNNER=true` and call `GET /api/cron` (`Authorization: Bearer $CRON_SECRET`) from one scheduler.

---

## Formulas

**Landed cost**: `Î£(qty Ã— rate) + GST + freight + loading + other`; a mismatch with the vendor's stated total is flagged above `max(â‚¹10, 0.5 %)`.

**Recommendation score** (weights per project, default 40/20/10/20/10):

| Criterion | Score 0â€“100 |
|---|---|
| Landed price | `100 Ã— lowest unit landed Ã· vendor unit landed` |
| Delivery vs need | 100 on time; `100 Ã— (1 âˆ’ daysLate Ã· (maxDelay + 1))`; 0 beyond max delay; 50 if no date given |
| Proximity | 0 outside the service radius; else `100 âˆ’ 70 Ã— distance Ã· radius`, âˆ’10 if transit > 24 h |
| Vendor rating | `rating Ã— 20`; vendors with < 3 completed orders use a neutral 3.5 |
| Commercial terms | credit days (40) + validity (20) + warranty (10) + no deviations (30, âˆ’10 each) |

Hard filters (shown with a reason): blacklisted, quantity short, beyond max delay, validity expired. When no single vendor qualifies, a **split order** is suggested.

**Vendor rating** (computed when a PO closes, i.e. the full quantity is accepted at GRN):

| Pointer | Weight | Inputs |
|---|---|---|
| Price competitiveness | 25 | final rate vs lowest quote, market average and our previous rate |
| Delivery timeliness | 25 | per GRN: 100 on time, âˆ’12.5 per day late |
| Quality & quantity | 25 | accepted Ã· delivered (50) + spec match (20) + no damage (15) + test certificate (15) âˆ’ 10 per return |
| Responsiveness | 15 | quote speed vs RFQ window, PO acceptance time, dispatch updates |
| Commercial & documentation | 10 | GST registration on file (30), challan no. on every GRN (30), challan scan uploaded (20), PO accepted without change requests (20) |

Stars = score Ã· 20. Rolling rating with exponential decay (0.8). Grades: â‰¥ 4.5 Excellent Â· 3.5â€“4.4 Good Â· 2.5â€“3.4 Average Â· < 2.5 Poor Â· < 3 orders = New.

---

## Going live

1. Production database on Atlas (M10 or higher recommended), with your server's IP allowed. Run `npm run db:push`.
2. Set `APP_URL`/`NEXTAUTH_URL` (and optionally `VENDOR_PORTAL_URL`) to your HTTPS domain, generate new secrets, configure email, add `GEMINI_API_KEY`, and set `DEMO_MODE="false"`.
3. Create the first admin: `npm run create-admin -- you@nyati.in "Your Name" "a-strong-password"`. Then sign in and add users, projects, vendors and materials from the app (CSV import is available for vendors and materials).
4. `npm run build && npm start` behind a reverse proxy (Nginx or Caddy) with HTTPS.

### Deploying on Render (or any HTTPS host)

- **Build command:** `npm install && npm run build` · **Start command:** `npm start` · **Node:** 22 or later (set `NODE_VERSION=22` if needed).
- **Environment variables:** copy every value from your `.env`, then change:
  - `NEXTAUTH_URL` and `APP_URL` → your public address, e.g. `https://nyati-inventory.onrender.com` (https, no trailing slash);
  - `NEXTAUTH_SECRET` → a long random value; keep it unchanged afterwards, because changing it signs everyone out and breaks vendor links already sent.
- **MongoDB Atlas → Network Access:** allow `0.0.0.0/0`. Render's outgoing IPs change, so a single IP won't work.
- **First admin:** from your machine (same `.env` database), run `npm run create-admin -- you@nyati.in "Your Name" "password"`.
- **If sign-in fails, open `https://<your-app>/api/health`.** It lists exactly what's wrong (missing secret, wrong `NEXTAUTH_URL`, database unreachable, no admin user) without showing any secrets.

## Defaults chosen (configurable)

- Currency INR; money stored as numbers rounded to 2 decimals; dates in UTC, shown in Asia/Kolkata.
- Quotation deadline 48 h; reminders 24 h and 3 h before; max delay 7 days; Finance approval â‰¥ â‚¹5 L (per project).
- Invoices and payments are **not tracked** in this app; payment terms still appear on quotations and POs.
- A PO closes when the full quantity is accepted at GRN; rejected quantity must be replaced (or the PO stays partially delivered).
- RFQ PDFs always use the NYATI layout; with a Word template active, the filled `.docx` is attached as well.

## Known limitations

- Legacy binary `.doc` files have limited support; `.docx` works fully.
- Site and vendor locations are latitude/longitude fields (or geocoded from the address) with a "view on map" link; there is no embedded map picker.
- `rollup` is aliased to `@rollup/wasm-node` so tests run on machines that block native binaries; this is harmless elsewhere.
