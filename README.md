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
# ecowitt-nextjs15

## Overview

Mobile-first dashboard for weather station data (Ecowitt) built with Next.js 15, React 19, and Tailwind CSS. CSV files from `DNT/` are loaded, time-aggregated (minute/hour/day), and visualized as interactive time series. Channel names (CH1–CH8) are configurable via JSON.

## Prerequisites

- Node.js 18+ (20+ recommended)
- CSV files in folder `DNT/` (outside version control, see `.gitignore`).

## Data location (`DNT/`)

- Place your monthly CSVs in `DNT/`.
- Typical patterns:
  - Main data: `YYYYMMA.CSV` (e.g., `202508A.CSV`)
  - Allsensors: contains multiple channel blocks CH1..CH8 (e.g., `202508Allsensors_A.CSV`)
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

- `GET /api/data/allsensors?month=YYYYMM&resolution=minute|hour|day`
  - Aggregates Allsensors data to the desired resolution. Additional client-side filtering is possible.

- `GET /api/data/main?month=YYYYMM&resolution=minute|hour|day`
  - Aggregates main (A) data to the desired resolution.

- `GET /api/config/channels`
  - Returns `channels.json`.

All API routes run in the Node.js runtime and read from the local filesystem.

## Development

```bash
npm install
npm run dev
# usually opens http://localhost:3000
```

## Using the dashboard

- **Dataset**: Allsensors (CH1–CH8) or Main (A)
- **Month**: choose from detected `YYYYMM`
- **Resolution**: minute / hour / day (server-side average per bucket)
- **Allsensors**: choose metric (Temperature, Humidity, Dew Point, Heat Index) and channels
- **Main**: numeric columns are auto-detected and selectable

Note: The UI does not display raw source filenames (e.g., CSV lists). Data is served via DuckDB/Parquet.

## Deployment notes

- The project reads from the filesystem (CSVs in `DNT/`). On platforms like Vercel, runtime files are not persisted. For production, consider:
  - your own server/VPS or Docker deployment with `DNT/` mounted
  - or an external storage/data source mounted server-side (and adapt file access as needed)

## DuckDB/Parquet (Node Neo)

This project uses DuckDB for fast queries and stores monthly CSV data on-the-fly as Parquet.

- Engine: `@duckdb/node-api` (DuckDB Node “Neo”)
- Database file: `data/weather.duckdb`
- Parquet target: `data/parquet/allsensors/YYYYMM.parquet`

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

### Useful API calls (test)

- Month: `/api/data/allsensors?month=202501&resolution=hour`
- Range: `/api/data/allsensors?start=2025-01-01 00:00&end=2025-08-13 00:00&resolution=day`

## Troubleshooting

- **No months found**: Are CSVs present in `DNT/` and named `YYYYMM*.CSV`?
- **Empty charts**: Check if headers match expected patterns and values are not all `--`.
- **Time axis looks off**: Check the date format is `YYYY/M/D H:MM` (or ISO-like alternative).
- **Build/TS errors**: Ensure `tsconfig.json` has `baseUrl`/`paths` set for `@/*` (provided).
- **Module not found `@duckdb/node-bindings-*/duckdb.node`**: Ensure `@duckdb/node-api` is installed, Turbopack is disabled in dev (`npm run dev` without the flag), routes run in Node runtime, and `src/lib/db/duckdb.ts` uses dynamic import. Remove `.next/` and restart if needed.
- **Unknown module type (@mapbox/node-pre-gyp)**: Remove legacy `duckdb` (`npm remove duckdb`), use `@duckdb/node-api` only.
