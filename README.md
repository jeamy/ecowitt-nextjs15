This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

# ECOWITT WEATHER STATION
# DNT WLAN-Wetterstation WeatherScreen PRO

## Overview

Mobile-first dashboard for weather station data (Ecowitt - DNT) built with Next.js 15, React 19, and Tailwind CSS. CSV data stored on the weather station (microSD card) must be copied into the `DNT/` directory. From there, the app reads, processes, and aggregates the files (minute/hour/day) and visualizes them as interactive time series. Channel names (CH1–CH8) are configurable via JSON.

Supported weather stations:

- ECOWITT HP2551 Wi‑Fi Weather Station
- DNT WeatherScreen PRO (WLAN)
- Compatible ECOWITT/DNT models that save monthly CSV files

## Screenshots

### Grafik

<div align="center">
  <img src="Grafik.png" alt="Grafik – Zeitreihen" width="49%" />
  <img src="Grafik2.png" alt="Grafik 2 – Zeitreihen" width="49%" />
  
</div>

### Echtzeit

<p align="center">
  <img src="Echtzeit.png" alt="Echtzeit-Ansicht" width="70%" />
</p>

### Gespeicherte Daten

<p align="center">
  <img src="Archiv.png" alt="Gespeicherte Daten – Archiv" width="70%" />
</p>

## Prerequisites

- Node.js 18+ (20+ recommended)
- CSV files in folder `DNT/` (outside version control, see `.gitignore`).

## Data location (`DNT/`)

- Copy the monthly CSVs from the weather station's microSD card into `DNT/`.
- Typical patterns:
  - Main data: `YYYYMMA.CSV` (e.g., `202508A.CSV`)
  - Allsensors: contains multiple channel blocks CH1..CH8 (e.g., `202508Allsensors_A.CSV`)
 - Sample CSVs (for testing) are provided in the project root:
   - `202501A.CSV` (Main A)
   - `202501Allsensors_A.CSV` (Allsensors)
   - Copy these files into `DNT/` to try the app without your own data.
- CSV properties (observed):
  - Delimiter: comma
  - Placeholder for missing values: `--`
  - Common date format `YYYY/M/D H:MM` (dashboard also supports ISO-like variants)
  - German headers (e.g., `Zeit`, `Luftfeuchtigkeit`, `Taupunkt`, `Wärmeindex`)

## Channel name configuration

- File: `src/config/channels.json`
- Example:

```json
{
  "ch1": { "name": "Garten" },
  "ch2": { "name": "Keller" },
  "ch3": { "name": "Dachboden" }
}
```

Names appear in the dashboard (labels/options). Undefined channels fall back to their ID (e.g., CH4).

## API endpoints

- `GET /api/data/months`
  - Returns available months derived from filenames in `DNT/` (format `YYYYMM`).

- Allsensors
  - `GET /api/data/allsensors?month=YYYYMM&resolution=minute|hour|day`
  - `GET /api/data/allsensors?start=YYYY-MM-DD HH:MM&end=YYYY-MM-DD HH:MM&resolution=minute|hour|day`
  - Aggregates over Parquet via DuckDB (CSV fallback). Multiple months are merged automatically for range queries.

- Main (A)
  - `GET /api/data/main?month=YYYYMM&resolution=minute|hour|day`
  - `GET /api/data/main?start=YYYY-MM-DD HH:MM&end=YYYY-MM-DD HH:MM&resolution=minute|hour|day`
  - Aggregates over Parquet via DuckDB (CSV fallback). Multiple months are merged automatically for range queries.

- `GET /api/data/extent`
  - Returns global min/max timestamps detected across available data to power the global range slider.

- `GET /api/config/channels`
  - Returns `channels.json`.

All API routes run in the Node.js runtime and read from the local filesystem.

## Realtime data (Ecowitt API v3)

The homepage is split into three tabs:

- **Realtime (Echtzeit)**: Fetches live data from Ecowitt API v3 via a server-side proxy (`/api/rt/last`). Values are shown as key metrics and as gauges/charts.
- **Grafik**: Visual, realtime gauges for the station: outdoor temperature and humidity (with gradient guides), wind compass with speed/gust, barometric pressure, rainfall KPIs (rate/hour/day/week/month/year), solar radiation, UV index, indoor temperature/humidity, plus mini‑gauges for CH1–CH8.
- **Stored data (Gespeicherte Daten)**: Historical dashboard over local CSVs via DuckDB/Parquet.
  - Default view: last available month; default resolution: day.
  - Modes: Main sensors (A) and Channel sensors (CH1–CH8). Channel dropdown supports single‑channel or viewing all channels.
  - Optional global time range: enable “Ausgewählten Zeitraum verwenden” to pick start/end and query across months.
  - Charts are interactive (zoom/pan/reset) and labels are localized.
  - Channel names are configurable via `src/config/channels.json`.

### Backend Realtime Processing

The app now uses a server-side background poller (via Next.js instrumentation) to:

1. Fetch data from Ecowitt API at configurable intervals (`RT_REFRESH_MS` in `.env`)
2. Cache the latest data for quick client access (`/api/rt/last`)
3. Automatically archive data to monthly CSV files in `DNT/` directory:
   - `YYYYMMAllsensors_A.CSV` for channel data
   - `YYYYMMA.CSV` for main station data

This ensures seamless integration between realtime and historical data without client-side polling.

Realtime API routes:

- `GET /api/rt/last` — returns the latest cached data (used by the frontend)
- `GET /api/rt?all=1` — direct proxy to Ecowitt API (full payload)
- `GET /api/rt` — direct proxy to Ecowitt API (subset of data)

The system uses credentials from `eco.ts` (server-only) so your keys aren't exposed to the browser.

Docs: https://doc.ecowitt.net/web/#/apiv3en?page_id=17 (Getting Device Real-Time Data)

## Development

```bash
npm install
npm run dev
# usually opens http://localhost:3000
```

### Configuration (.env and eco.ts)

1) Environment variables

- Copy `env.example` to `.env` and adjust as needed.
- Supported variable(s):

```
NEXT_PUBLIC_RT_REFRESH_MS=300000  # Realtime refresh interval in ms (default 300000 = 5 min)
```

2) Ecowitt credentials (server-side)

- Copy `eco.example.ts` to `eco.ts` and fill in your values:
  - `applicationKey`
  - `apiKey`
  - `mac` (station MAC, e.g., `F0:08:D1:07:AF:83`)
  - `server` (usually `api.ecowitt.net`)
- `eco.ts` is imported by the server-side proxy at `src/app/api/rt/route.ts`.

Security notes:

- `.env*` files and `eco.ts` are ignored by Git (see `.gitignore`).
- Do not commit your real keys.

## Scripts

- `npm run prewarm`
  - Scans `DNT/` and materializes Parquet files under `data/parquet/{allsensors,main}/` for all detected months.
  - Logs per-month status (built, up-to-date, error) to the console.

- `npm run dev`
  - Runs the prewarm script first (via `predev` hook), then starts Next.js dev server.

- `npm run start`
  - Runs the prewarm script first (via `prestart` hook), then starts Next.js in production mode.

## Using the dashboard

- **Dataset**: Allsensors (CH1–CH8) or Main (A)
- **Month**: choose from detected `YYYYMM`
- **Resolution**: minute / hour / day (server-side average per bucket)
- **Allsensors**: choose metric (Temperature, Humidity, Dew Point, Heat Index) and channels
- **Main**: numeric columns are auto-detected and selectable

Note: The UI does not display raw source filenames (e.g., CSV lists). Data is served via DuckDB/Parquet.
Default view shows the last available month.

## Interactive charts (Zoom & Reset)

Charts use Chart.js with zoom and pan support:

- Mouse wheel: Horizontal zoom on the X‑axis.
- Pinch (touch/touchpad): Zoom.
- Shift + drag: Select a range to zoom (drag‑zoom).
- Ctrl + drag: Pan horizontally.
- Reset: Button at the top right of the chart (greyed out until you zoom) or double‑click the chart.

Notes:

- Tooltips and legend remain usable while zoomed.
- The Reset button is always visible; it becomes highlighted when a zoom is active.
- On touch devices, pinch‑zoom is active; panning requires Ctrl on desktop.

## Deployment notes

- The project reads from the filesystem (CSVs in `DNT/`). On platforms like Vercel, runtime files are not persisted. For production, consider:
  - your own server/VPS or Docker deployment with `DNT/` mounted
  - or an external storage/data source mounted server-side (and adapt file access as needed)

## DuckDB/Parquet (Node Neo)

This project uses DuckDB for fast queries and stores monthly CSV data on-the-fly as Parquet.

- Engine: `@duckdb/node-api` (DuckDB Node “Neo”)
- Database file: `data/weather.duckdb`
- Parquet targets:
  - `data/parquet/allsensors/YYYYMM.parquet`
  - `data/parquet/main/YYYYMM.parquet`

### Setup

```bash
# remove legacy package if present
npm remove duckdb

# install Neo client
npm install @duckdb/node-api
```

### Development (Node runtime)

```bash
npm run dev   # without --turbopack
```

Notes:

- API routes run with `export const runtime = "nodejs"` (not Edge runtime).
- `src/lib/db/duckdb.ts` dynamically imports `@duckdb/node-api` (prevents bundling native bindings).
- `next.config.ts` externalizes DuckDB native packages for the server build.

### On‑demand ingestion

- On first request for a month/range, CSV(s) from `DNT/` are read and written as Parquet (mtime check).
- Subsequent aggregations (minute/hour/day) run efficiently over Parquet via DuckDB.
- Fallback: if DuckDB/Parquet is unavailable, the API parses CSV directly.

### Prewarm at startup (optional but recommended)

Materialize Parquet files for all detected months before serving requests. This runs automatically before `dev`/`start`, and can also be run manually.

```bash
npm run prewarm           # manual
# or via hooks
npm run dev               # runs prewarm first
npm run start             # runs prewarm first
```

Console output example:

```
[prewarm] Scanning DNT/ for new CSV files and materializing Parquet via DuckDB...
[prewarm] Allsensors: found 39 month(s).
[prewarm] Allsensors 202508: built data/parquet/allsensors/202508.parquet
[prewarm] Allsensors 202507: up-to-date (data/parquet/allsensors/202507.parquet)
[prewarm] Main 202508: built data/parquet/main/202508.parquet
[prewarm] Main: 1 built, 38 up-to-date.
[prewarm] Done.
```

If a month fails to ingest, the script logs a per-month `ERROR` and continues with the next month.

### Timestamp detection (robust parsing)

CSV time columns vary (`Time`, `Zeit`, `DateUTC`, `DateTimeUTC`, etc.). The ingestion step introspects the CSV header to find the time column and parses common formats:

- `YYYY-M-D H:MM` / `YYYY/M/D H:MM` / `YYYY-MM-DDTHH:MM`
- with seconds variants: `...:SS`
- German: `DD.MM.YYYY HH:MM` (and with seconds)

This avoids binder/type errors and handles mixed datasets reliably.

### Useful API calls (test)

### Realtime

- curl

```bash
curl 'http://localhost:3000/api/rt/last'
curl 'http://localhost:3000/api/rt?all=1'
```

- fetch (client/server)

```ts
const rt = await fetch('/api/rt/last').then(r => r.json());
```

### Data (CSV/DuckDB-backed)

- Months and global extent

```bash
curl 'http://localhost:3000/api/data/months'
curl 'http://localhost:3000/api/data/extent'
```

- Main (A) — by month or by time range

```bash
curl 'http://localhost:3000/api/data/main?month=202501&resolution=day'
curl 'http://localhost:3000/api/data/main?start=2025-01-01%2000:00&end=2025-01-31%2023:59&resolution=hour'
```

- Allsensors (CH1–CH8) — by month or by time range

```bash
curl 'http://localhost:3000/api/data/allsensors?month=202501&resolution=hour'
curl 'http://localhost:3000/api/data/allsensors?start=2025-01-01%2000:00&end=2025-02-15%2000:00&resolution=day'
```

- fetch example

```ts
const res = await fetch('/api/data/allsensors?month=202501&resolution=hour');
const json = await res.json();
```

- Config (channel names)

```bash
curl 'http://localhost:3000/api/config/channels'
```

## Troubleshooting

- **No months found**: Are CSVs present in `DNT/` and named `YYYYMM*.CSV`?
- **Empty charts**: Check if headers match expected patterns and values are not all `--`.
- **Time axis looks off**: Check the date format is `YYYY/M/D H:MM` (or ISO-like alternative).
- **Build/TS errors**: Ensure `tsconfig.json` has `baseUrl`/`paths` set for `@/*` (provided).
- **Module not found `@duckdb/node-bindings-*/duckdb.node`**: Ensure `@duckdb/node-api` is installed, Turbopack is disabled in dev (`npm run dev` without the flag), routes run in Node runtime, and `src/lib/db/duckdb.ts` uses dynamic import. Remove `.next/` and restart if needed.
- **Unknown module type (@mapbox/node-pre-gyp)**: Remove legacy `duckdb` (`npm remove duckdb`), use `@duckdb/node-api` only.

## Attribution

This project was built with assistance from Windsurf (agentic AI coding assistant) and GPT-5.
