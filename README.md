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

## Überblick

Mobile-first Dashboard für Wetterstationsdaten (Ecowitt) mit Next.js 15, React 19 und Tailwind CSS. CSV-Dateien aus `DNT/` werden eingelesen, zeitlich aggregiert (Minute/Stunde/Tag) und als interaktive Zeitreihen visualisiert. Sensor-Kanalnamen (CH1–CH8) sind per JSON konfigurierbar.

## Voraussetzungen

- Node.js 18+ (empfohlen 20+)
- CSV-Dateien im Ordner `DNT/` (liegt außerhalb der Versionskontrolle, siehe `.gitignore`).

## Datenablage (`DNT/`)

- Legen Sie Ihre monatlichen CSVs in `DNT/` ab.
- Typische Muster:
  - Hauptdaten: `YYYYMMA.CSV` (z. B. `202508A.CSV`)
  - Allsensors: enthält mehrere Kanalblöcke CH1..CH8 (z. B. `202508Allsensors_A.CSV`)
- CSV-Eigenschaften (aus Beobachtungen):
  - Trennzeichen: Komma
  - Platzhalter für fehlende Werte: `--`
  - Datumsformat oft `YYYY/M/D H:MM` (Dashboard unterstützt zusätzlich ISO-ähnliche Varianten)
  - Deutsche Header (z. B. `Zeit`, `Luftfeuchtigkeit`, `Taupunkt`, `Wärmeindex`)

## Konfiguration der Kanalnamen

- Datei: `src/config/channels.json`
- Beispiel:

```json
{
  "ch1": { "name": "Garten" },
  "ch2": { "name": "Keller" },
  "ch3": { "name": "Dachboden" }
}
```

Die Namen erscheinen im Dashboard (Legende/Buttons). Nicht definierte Kanäle werden mit ihrer ID angezeigt (z. B. CH4).

## API-Endpunkte

- `GET /api/data/months`
  - Liefert verfügbare Monate aus Dateinamen in `DNT/` (Format `YYYYMM`).

- `GET /api/data/allsensors?month=YYYYMM&resolution=minute|hour|day`
  - Aggregiert Allsensors-Daten auf die gewünschte Auflösung. Optional kann clientseitig gefiltert werden.

- `GET /api/data/main?month=YYYYMM&resolution=minute|hour|day`
  - Aggregiert Hauptdaten A auf die gewünschte Auflösung.

- `GET /api/config/channels`
  - Liefert `channels.json`.

Alle API-Routen laufen im Node.js-Runtime-Kontext und lesen lokal vom Dateisystem.

## Entwicklung starten

```bash
npm install
npm run dev
# öffnet i. d. R. http://localhost:3000
```

## Nutzung des Dashboards

- **Datensatz**: Allsensors (CH1–CH8) oder Hauptdaten (A)
- **Monat**: Auswahl aus gefundenen `YYYYMM`
- **Auflösung**: Minute / Stunde / Tag (serverseitige Mittelung je Bucket)
- **Allsensors**: Metrik (Temperatur, Luftfeuchte, Taupunkt, Wärmeindex) + Kanäle auswählen
- **Hauptdaten**: numerische Spalten werden erkannt und sind auswählbar

## Hinweise zu Deployment

- Das Projekt verwendet Dateisystemzugriffe (CSV aus `DNT/`). Auf Plattformen wie Vercel stehen Runtime-Dateien nicht persistiert zur Verfügung. Für Produktivbetrieb empfehlen sich:
  - eigener Server/VPS oder Docker-Deployment mit gemountetem `DNT/`
  - oder eine Datenquelle/Storage, die serverseitig eingebunden wird (und Anpassung der Datei-Zugriffslogik)

## Troubleshooting

- **Keine Monate sichtbar**: Liegen CSVs im Ordner `DNT/` und entsprechen sie `YYYYMM*.CSV`?
- **Leere Charts**: Prüfen, ob Spaltennamen/Headers den erwarteten Mustern entsprechen und Werte nicht ausschließlich `--` sind.
- **Zeitachse seltsam**: Prüfen, ob das Datumsformat `YYYY/M/D H:MM` (oder ISO-ähnlich) vorliegt.
- **Build/TS-Fehler**: Stellen Sie sicher, dass `tsconfig.json` `baseUrl`/`paths` für `@/*` gesetzt hat (bereitgestellt).
