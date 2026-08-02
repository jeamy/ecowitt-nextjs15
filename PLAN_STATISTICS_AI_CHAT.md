# Plan: KI-Chat für Wetterstatistiken auf der Statistikseite

## Ziel

Auf der Ecowitt-Statistikseite wird ein Chat integriert, der natürliche Fragen zu den lokal gespeicherten Wetterdaten beantwortet. Die Kommunikation mit einem KI-Modell erfolgt nach dem Muster von TileCompile über einen Ecowitt-eigenen PI-AI-Sidecar, der als eigener Service im Ecowitt-Docker-Compose betrieben wird.

Beispiele:

- „Wann hatte es 2025 mehr als 30 °C?“
- „An welchen Tagen waren die Niederschläge am größten?“
- „Welcher Monat war 2024 der wärmste?“
- „Wie viele Regentage gab es im Sommer 2025?“

- „War es 2024 durchschnittlich wärmer als 2025?“
- „Wann wurde zwischen 2024 und 2026 die höchste Temperatur gemessen?“
- „Gab es 2024 oder 2025 mehr Niederschlag? Liste beide Werte und die Differenz auf.“



Die Antwort muss auf tatsächlich aus Ecowitt-Daten berechneten Werten beruhen. Das Modell darf weder selbst SQL ausführen noch nicht belegte Messwerte erfinden.

## Aktueller Implementierungsstand

Die erste Umsetzung ist im Ecowitt-Repository angelegt:

- Statistikseite mit Chat-Komponente sowie deutschen und englischen Texten;
- lokale Auswertung fuer Temperaturgrenzwerte, Grenzwertzaehlungen, Aggregationen, Niederschlagsranglisten, Jahresvergleiche und mehrjaehrige Temperatur-Extreme;
- serverseitiger Verlauf unter `data/statistics_chat/history` mit begrenzten Turns und deduplizierten Anfragen;
- persistenter Antwort-Cache unter `data/statistics_chat/cache`, validiert ueber Datenrevision und optionales TTL;
- Ecowitt-eigener `pi-sidecar/` als Compose-Service mit OpenAI-/Anthropic-Adapter und lokalem Fallback;
- nginx-Authentifizierung bleibt der vorgesehene Zugriffsschutz.

Der Faktenpfad deckt jetzt auch Allsensors-Kanaele und erkannte Messwertgruppen dynamisch ab; konfigurierte Kanalnamen werden auf CH-IDs abgebildet. Nicht erkannte oder semantisch unklare Spalten bleiben bewusst ausgeschlossen. Die Abfragen bleiben deterministisch und ohne freie SQL- oder Modellabfragen.

Fuer den Main-Datenpfad existieren erste automatisierte `node:test`-Tests mit Fixture-Tageswerten. Abgedeckt sind Parser-Regeln, strikte Grenzwertzaehlung `> 30`, Niederschlagsranking, Jahresvergleich 2024/2025, mehrjaehriges Temperaturmaximum und Niederschlagsaggregation.

Die konkrete Anfrage `wieviel hat es 2024 geregnet?` wird als Jahres-Niederschlagssumme erkannt und wurde gegen die laufende Docker-App getestet. Ergebnis im aktuellen Datenbestand: `923,5 mm` fuer `2024-01-01` bis `2024-12-31`, mit `366` gueltigen Tagen; eine identische zweite Anfrage wurde aus dem Antwort-Cache bedient.

Die Chat-UI zeigt den Verlauf nun im Chat-Stil mit Benutzerfrage und Assistentenantwort als kompakte Sprechblasen. Links befindet sich eine klickbare Fragenliste, die zur passenden Position im Verlauf scrollt. Jede Antwort besitzt ein ausklappbares Diagnosefenster `Datenverkehr`, das redigierte Traffic-Informationen anzeigt: Cache-Hit/-Miss, klassifizierter Intent, lokale Faktenberechnung, Sidecar-Endpunkt, Provider, Modell, HTTP-Status und Laufzeiten. API-Schluessel und vollstaendige Secrets werden nicht ausgegeben.

Fachfremde Fragen werden weiterhin vor dem Sidecar-Aufruf vom lokalen Parser abgewiesen und per `422 UNSUPPORTED_STATISTICS_QUESTION` beantwortet. Die UI zeigt dafuer nun eine freundliche Meldung mit Beispielen fuer erlaubte Wetterstatistik-Fragen statt des technischen Fehlercodes.

Weitere fachliche Luecken sind geschlossen: Der Parser erkennt jetzt Monats- und Saisonzeitraeume wie `Sommer 2024`; der Faktenpfad berechnet `rank_periods` fuer Monats-/Jahresranglisten sowie `availability` fuer Datenabdeckung. Faktenwerte enthalten optional `expectedDays` und `coverage`, und die UI zeigt gueltige/erwartete Tage sowie Abdeckungsprozent an. Live getestet wurden `Welcher Monat war 2024 der waermste?` mit Monatsranking und `Gibt es Daten fuer Sommer 2024?` mit `100 %` Abdeckung bei `92/92` Tagen.

## Bestandsaufnahme

Die vorhandene Anwendung bringt bereits die wesentlichen Datenbausteine mit:

- `src/lib/statistics.ts` aggregiert die Main-Daten über DuckDB/Parquet auf Tagesebene.
- `src/types/statistics.ts` definiert Jahres-, Monats-, Temperatur-, Niederschlags- und Windstatistiken.
- `src/app/api/statistics/route.ts` liefert den Statistik-Cache.
- `src/app/api/statistics/daily/route.ts` liefert Tagesreihen, optional für ein Jahr.
- `src/app/api/statistics/range/route.ts` berechnet Bereichsstatistiken serverseitig.
- `src/app/api/statistics/channels/route.ts` unterstützt Temperaturstatistiken für zusätzliche Kanäle.
- `src/components/Statistics.tsx` rendert die Statistikseite inklusive Schwellenwertlisten und Jahres-/Monatsblöcken.
- Die persistierten Daten liegen in `data/weather.duckdb`, `data/parquet/...` und `data/statistics.json`.

Festgelegte Randbedingungen:

- Die komplette Ecowitt-Seite ist bereits durch nginx-Authentifizierung geschützt. Für den Chat ist deshalb keine zusätzliche Benutzer-/Admin-Authentifizierung innerhalb der Next.js-Anwendung vorgesehen.
- Der PI-Sidecar läuft als eigener Docker-Compose-Service und ist nur im internen Compose-Netzwerk erreichbar.
- Provider-API-Keys werden aus der Ecowitt-`.env` über `env_file` in den Sidecar-Container injiziert. Die Keys werden nicht an den Browser und nicht an die Ecowitt-API-Route weitergegeben.
- Der Chat berücksichtigt alle vorhandenen Kanäle und Messwerte aus Main- und Allsensors-Daten.
- Bei Nichterreichbarkeit oder Deaktivierung des Sidecars erzeugt Ecowitt aus den lokal berechneten Fakten eine regelbasierte Antwort.
- Tagesgrenzen und Datumsformatierung verwenden die Serverzeit.

TileCompile dient ausschließlich als technische Vorlage für:

- eine Backend-Route für den Chat;
- einen Ecowitt-eigenen serverseitigen HTTP-Client für Aufrufe zum PI-Sidecar;
- den Sidecar-Endpunkt `POST /run-chat`;
- ein strukturiertes `ai_request`-Objekt neben einem lesbaren Prompt;
- Gesprächsverlauf, Timeouts, Fehlerstatus und lokalen Fallback;
- eine strikt definierte Antwortstruktur statt unkontrolliertem Freitext.

## Empfohlene Zielarchitektur

```text
Statistikseite
  │  Frage + optionaler Zeitraum/Kanal
  ▼
POST /api/statistics/chat  (Next.js, Node-Runtime)
  │
  ├─ Eingabe validieren und maximale Länge prüfen
  ├─ Chatverlauf begrenzen und sensible Inhalte entfernen
  ├─ PI-Sidecar fragt nach einem strukturierten Statistik-Plan
  │    (nur erlaubte Operationen, keine SQL-Ausführung)
  ├─ Plan serverseitig validieren und mit DuckDB ausführen
  ├─ Datenqualität und Quellenbereich bestimmen
  └─ verifizierte Fakten an den PI-Sidecar zur Antwortformulierung senden
       │
       ▼
   Antwort mit Ergebnis, Zeitraum, Einheit, Datenquelle und Unsicherheiten
```

Für den ersten Ausbau kann die Planerzeugung und Antwortformulierung in einem Sidecar-Aufruf erfolgen, wenn die Ecowitt-Route dem Modell bereits eine verifizierte Faktenmenge übergibt. Die robustere Zielvariante besteht aus zwei klar getrennten Schritten:

1. **Planung:** Das Modell erzeugt nur ein JSON-Objekt aus einer kleinen Allowlist.
2. **Berechnung:** Ecowitt führt die erlaubte Operation selbst aus.
3. **Erklärung:** Das Modell formuliert aus dem Ergebnis eine verständliche Antwort.

So bleiben Zahlen, Filter und Sortierung deterministisch und auditierbar.

## Daten- und Abfragekonzept

### Einheitliche Statistik-Domäne

Eine neue serverseitige Bibliothek, zum Beispiel `src/lib/statisticsChat.ts`, kapselt die für den Chat erlaubten Abfragen. Sie verwendet die bereits vorhandenen Funktionen aus `src/lib/statistics.ts`, greift aber für Ranglisten und Zeitreihen bei Bedarf direkt auf DuckDB zu.

Zunächst werden Tageswerte als gemeinsame Vergleichsebene unterstützt; die Messwert-Allowlist wird jedoch aus allen vorhandenen Main- und Allsensors-Schemata abgeleitet:

- Außentemperatur: `tmax`, `tmin`, `tavg`;
- Niederschlag: `rain_day` in mm;
- Wind und Böen: `wind_max`, `gust_max`, `wind_avg`;
- gefühlte Temperatur, sofern in den Quelldaten vorhanden;
- Luftfeuchte, Luftdruck, Solarstrahlung, UV und alle weiteren numerischen Wetterwerte, sofern im erkannten Schema vorhanden;
- alle benannten CH1-CH8-Kanäle aus `src/config/channels.json` einschließlich ihrer Temperatur-/Feuchte-Messwerte;
- Roh-/Zeitreihenabfragen mit geeigneter Granularität für Werte, die nicht sinnvoll als Tagesmaximum/-summe aggregiert werden.

Für jeden Messwert werden Metadaten geführt: kanonischer Schlüssel, erkannte Quellspalten, Anzeigename, Einheit, Aggregationstyp, erlaubte Operationen und Datenquelle (`main` oder `allsensors`). Nicht numerische oder technisch interne Spalten werden nicht automatisch für KI-Abfragen freigegeben.

Die Abfrageebene muss ausdrücklich dokumentieren, wie Niederschlag gebildet wird. Die bestehende Tagesaggregation bevorzugt Tagesregen und fällt auf Stunden-/allgemeine Regenwerte zurück. Diese Semantik wird in der Chatantwort als Datenquelle und gegebenenfalls als Hinweis ausgegeben. Für alle Kanäle und Messwerte muss eine eindeutige Aggregation definiert sein; bei unklarer Semantik wird eine Rückfrage gestellt.

### Erlaubte Statistik-Operationen

Der erste Intent-Katalog sollte klein und testbar bleiben:

```json
{
  "operation": "threshold_days",
  "metric": "outdoor_temperature_max",
  "operator": ">",
  "value": 30,
  "unit": "°C",
  "start": "2025-01-01",
  "end": "2025-12-31",
  "limit": 100
}
```

Weitere Operationen:

- `extreme_day`: Maximum/Minimum einer Messgröße mit Datum innerhalb eines Zeitraums;
- `extreme_measurement`: höchster/niedrigster tatsächlich gemessener Rohwert inklusive Zeitstempel, mit Tageswert-Fallback, wenn keine feinere Zeitauflösung verfügbar ist;
- `top_days`: Top-N-Tage nach Temperatur, Niederschlag, Wind oder Böe;
- `aggregate_period`: Summe, Mittelwert, Minimum oder Maximum für Jahr, Monat oder benutzerdefinierten Zeitraum;
- `count_days`: Anzahl Tage, die einen Schwellenwert erfüllen;
- `compare_periods`: Vergleich von zwei oder mehr frei definierten Zeiträumen nach Mittelwert, Summe, Minimum, Maximum oder Anzahl;
- `rank_periods`: mehrere Jahre/Monate nach einer Messgröße sortieren;
- `difference`: absolute und, wenn sinnvoll, relative Differenz zwischen Vergleichszeiträumen;
- `availability`: Prüfen, ob Daten für den gewünschten Zeitraum vorhanden sind.

Der Server akzeptiert ausschließlich bekannte Metriken, Operatoren, Einheiten, Datumsformate, Vergleichszeiträume, Aggregationen und Grenzwerte. Unbekannte Werte führen zu einer Rückfrage oder zu einer verständlichen Fehlermeldung. Es wird niemals vom Modell erzeugtes SQL ausgeführt.

Beispiel für einen Vergleichs-Intent:

```json
{
  "operation": "compare_periods",
  "metric": "outdoor_temperature_avg",
  "aggregation": "mean_of_valid_daily_averages",
  "periods": [
    {"label": "2024", "start": "2024-01-01", "end": "2024-12-31"},
    {"label": "2025", "start": "2025-01-01", "end": "2025-12-31"}
  ],
  "unit": "°C"
}
```

Die serverseitig berechneten Vergleichsfakten enthalten pro Zeitraum mindestens `label`, `value`, `unit`, `valid_days`, `coverage`, außerdem `winner`, `difference_absolute` und – sofern mathematisch sinnvoll – `difference_relative_percent`. Die KI darf daraus nur eine sprachliche Zusammenfassung erstellen.

### Semantik der Beispielanfragen

„Wann hatte es in 2025 mehr als 30 °C?“ bedeutet standardmäßig:

- Zeitraum `2025-01-01` bis `2025-12-31`;
- Außentemperatur-Tagesmaximum `tmax`;
- strikter Vergleich `> 30`, nicht `>= 30`;
- Ergebnis als Liste von Tagen mit gemessenem Tagesmaximum;
- zusätzlich Anzahl und höchster Wert im Zeitraum.

„Wann waren die Niederschläge am größten?“ bedeutet standardmäßig:

- alle verfügbaren Tage im Datenbestand;
- `rain_day` absteigend sortiert;
- Top 5 als kompakte Antwort;
- Angabe, ob der Zeitraum vollständig oder nur teilweise vorhanden ist.

„War es 2024 durchschnittlich wärmer als 2025?“ bedeutet:

- je Jahr der Mittelwert aus den gültigen täglichen Außentemperatur-Mittelwerten;
- identische Einheiten und identische Aggregationsregeln für beide Jahre;
- Ausgabe beider Jahreswerte, des wärmeren Jahres und der absoluten Differenz in °C;
- Angabe gültiger Tage und Datenabdeckung pro Jahr.

„Wann wurde zwischen 2024 und 2026 die höchste Temperatur gemessen?“ bedeutet:

- inklusiver Zeitraum vom 01.01.2024 bis 31.12.2026;
- bevorzugt Rohmesswert mit exaktem Zeitstempel;
- falls Rohauflösung nicht verfügbar ist, Tagesmaximum mit Tagesdatum und entsprechendem Hinweis;
- Ausgabe von Wert, Einheit, Datum/Zeit, Messkanal und Datenquelle.

„Gab es 2024 oder 2025 mehr Niederschlag?“ bedeutet:

- Summe der gültigen Tagesniederschläge je Kalenderjahr;
- Ausgabe beider Werte in mm, der Differenz und des Jahres mit dem höheren Wert;
- Hinweis auf fehlende Tage oder unvollständige Datenabdeckung.

Diese Defaults müssen in UI-Hinweis und Tests sichtbar sein. Bei mehrdeutigen Fragen soll der Chat nach Zeitraum, Sensor oder Vergleichsoperator fragen, statt eine stille Annahme zu verstecken.

## API-Entwurf

### Chat-Endpunkt

Neue Route:

`POST /api/statistics/chat`

Request:

```json
{
  "conversation_id": "browser-generated-id",
  "message": "Wann hatte es in 2025 mehr als 30 °C?",
  "conversation": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "locale": "de",
  "station": "default"
}
```

Response:

```json
{
  "schema_version": "ecowitt.statistics-chat-answer.v1",
  "answer": "Im Jahr 2025 ...",
  "facts": {
    "operation": "threshold_days",
    "metric": "outdoor_temperature_max",
    "unit": "°C",
    "period": {"start": "2025-01-01", "end": "2025-12-31"},
    "count": 7,
    "items": [
      {"date": "2025-06-14", "value": 31.4}
    ]
  },
  "source": {
    "granularity": "day",
    "dataset": "main",
    "statistics_updated_at": "...",
    "coverage": {"first": "...", "last": "..."}
  },
  "warnings": [],
  "mode": "sidecar"
}
```

Fehlerfälle werden maschinenlesbar unterschieden:

- `400`: leere, zu lange oder formal ungültige Frage;
- `422`: Frage ist verständlich, aber benötigt eine Rückfrage oder enthält eine nicht unterstützte Statistik;
- `502`: PI-Sidecar oder Modell nicht erreichbar;
- `503`: Chat ist nicht konfiguriert oder deaktiviert.

### Sidecar-Payload

Ecowitt implementiert dieses Muster selbst und sendet an den konfigurierten Sidecar-Endpunkt:

`POST ${PI_SIDECAR_URL}/run-chat`

Die Payload enthält mindestens:

- `model`, wenn explizit konfiguriert;
- `prompt` als lesbare Aufgabenbeschreibung;
- `ai_request` mit Schema-Version, Benutzerfrage, Gespräch, Statistik-Katalog und erwarteter Antwortstruktur;
- `task: "ecowitt_statistics_chat"`;
- keine lokalen Dateipfade und keine Rohdaten, die für die Frage nicht benötigt werden.

Das `ai_request`-Schema sollte als Ecowitt-eigene Version geführt werden, etwa `ecowitt.statistics-ai-request.v1`. Die TileCompile-Version `pi.ai-request.v2` wird nicht als Code oder Laufzeitabhängigkeit übernommen. Ecowitt definiert und implementiert sein eigenes `ecowitt.statistics-ai-request.v1`; nur die bewährten Transportkonventionen wie `POST /run-chat`, Timeout und Fehlerübertragung dienen als Vorlage.

## Verlaufs- und Cache-Konzept

Die Chatverläufe werden wie in TileCompile serverseitig als kanonische Sitzungsverläufe gespeichert und zusätzlich im Browser gespiegelt. Die Implementierung bleibt vollständig Ecowitt-eigen.

### Sitzungsidentität und Speicherung

- Der Client erzeugt einmalig eine zufällige `conversation_id` und speichert sie lokal im Browser.
- Jede Statistik-Chat-Anfrage enthält `conversation_id`; der Server speichert die Antwort nach erfolgreicher Verarbeitung automatisch.
- Persistenzdateien liegen unter `data/statistics_chat/history/`, zum Beispiel `safe-id_hash.json`. IDs werden bereinigt und zusätzlich gehasht, damit keine Pfadmanipulation möglich ist.
- Das Dateiformat erhält die Version `ecowitt.statistics-chat-history.v1` und enthält `conversation_id`, `messages`, `turns`, `created_at`, `updated_at` und die letzte `data_revision`.
- Ein Turn enthält mindestens Frage, validierte Fakten, Antwort, Antwortmodus (`sidecar` oder `local_fallback`), Anfrage-Fingerprint, Datenrevision und Zeitstempel.
- Speicherung erfolgt atomar über temporäre Datei und Rename. Ungültige oder beschädigte Dateien werden kontrolliert als leerer Verlauf behandelt und protokolliert.
- Der Verlauf wird wie in TileCompile begrenzt, zunächst auf maximal 24 Messages und 24 Turns pro Sitzung. Der Sidecar erhält für Folgefragen nur die letzten relevanten Turns.

### Verlauf-Endpunkte

Zusätzlich zur Chat-Route werden vorgesehen:

- `GET /api/statistics/chat/history?conversation_id=...` – serverseitigen Verlauf laden;
- `POST /api/statistics/chat/history` – optionalen Client-Verlauf mit dem Server zusammenführen;
- `DELETE /api/statistics/chat/history?conversation_id=...` – Verlauf und zugehörige Sitzungsdaten löschen.

Beim Zusammenführen werden Nachrichten über `role + normalisierten content` dedupliziert. Turns werden über `message + Ergebnis-/Antwort-Fingerprint` dedupliziert. Der Server bleibt nach dem Merge die maßgebliche Quelle. Nach Seitenneuladen oder Browserwechsel kann der Verlauf dadurch wiederhergestellt werden.

### Antwort- und Anfrage-Cache

Es werden zwei Cache-Ebenen vorgesehen:

1. **Deterministischer Fakten-Cache:** Ergebnis einer validierten Statistikabfrage, etwa `threshold_days` oder `top_days`.
2. **Antwort-Cache:** vollständige, validierte Antwort aus Fakten plus PI-Formulierung.

Der Cache-Key wird nicht aus dem Rohtext allein gebildet. Er basiert auf einer kanonischen Darstellung aus:

- normalisierter Frage bzw. validiertem Statistik-Intent;
- Zeitraum, Kanal, Messwert, Operator, Einheit, Sortierung und Limit;
- Locale;
- Prompt-/Antwortschema-Version;
- Datenrevision;
- Modell/Provider nur für den formulierten Antwort-Cache.

Damit werden gleiche Fragen trotz unterschiedlicher Großschreibung, Leerzeichen oder Satzzeichen wiederverwendet. Unterschiedliche Formulierungen werden nach der Intent-Normalisierung ebenfalls gemeinsam bedient, sofern sie dasselbe Ergebnis anfordern.

Die `data_revision` wird aus `statistics.json.updatedAt` und dem verfügbaren Datenbereich gebildet; bei Statistik-Neuberechnung oder veränderter Datenabdeckung werden alte Fakten- und Antwort-Caches nicht mehr verwendet. Cache-Einträge werden nur nach vollständig validierter Antwort gespeichert. Fehler, Rückfragen und Providerfehler werden nicht als erfolgreiche Antworten gecacht.

Bei Cache-Treffer liefert die API weiterhin `facts`, `answer`, `source` und `warnings`, ergänzt um `cache: {"hit": true, "key_version": "v1", "created_at": "..."}`. Bei Cache-Miss wird genau ein Eintrag erzeugt. Gleichzeitige identische Requests werden über eine serverseitige In-Flight-Deduplizierung zusammengeführt, damit nicht mehrere PI-Anfragen parallel für dieselbe Frage entstehen.

Der Cache liegt getrennt vom Sitzungsverlauf unter `data/statistics_chat/cache/`. Einträge werden durch Datenrevision und optional durch eine konfigurierbare maximale Lebensdauer begrenzt. Ein Cache-Treffer darf keine DuckDB-/Parquet-Daten verändern.

## Konfiguration

Neue Variablen in `.env` und `env.example`:

```text
STATISTICS_CHAT_ENABLED=false
PI_SIDECAR_URL=http://pi-sidecar:3001
PI_SIDECAR_MODEL=
PI_SIDECAR_PROVIDER=
PI_SIDECAR_TIMEOUT_MS=120000
STATISTICS_CHAT_MAX_MESSAGE_LENGTH=1000
STATISTICS_CHAT_MAX_HISTORY=12
STATISTICS_CHAT_HISTORY_LIMIT=24
STATISTICS_CHAT_CACHE_ENABLED=true
STATISTICS_CHAT_CACHE_TTL_MS=0
STATISTICS_CHAT_STORAGE_DIR=data/statistics_chat
```

Empfehlungen:

- `STATISTICS_CHAT_ENABLED` schaltet die Funktion bewusst frei; der Compose-Service darf bereits laufen, ohne dass die UI den Chat aktiviert.
- `STATISTICS_CHAT_CACHE_TTL_MS=0` bedeutet: Gültigkeit primär über `data_revision`; ein positiver Wert kann zusätzlich eine maximale Lebensdauer erzwingen.
- `STATISTICS_CHAT_STORAGE_DIR` enthält Verlauf und Cache auf einem persistenten Docker-Volume.
- API-Schlüssel für alle verwendeten PI-Provider werden aus `.env` über `env_file` in den Sidecar-Container geladen. Die konkreten Variablennamen werden in der Ecowitt-eigenen Sidecar-Konfiguration, zum Beispiel `pi-sidecar/src/config.ts`, zentral definiert und an die verwendeten PI-Provider weitergereicht.
- `PI_SIDECAR_URL` ist innerhalb des Compose-Netzwerks `http://pi-sidecar:3001`; `127.0.0.1` darf für die App-Kommunikation nicht verwendet werden.
- Der Sidecar erhält keinen veröffentlichten Host-Port, sondern nur `expose` im internen Compose-Netzwerk.
- Die Route läuft mit `runtime = "nodejs"`, da DuckDB und Dateisystemzugriff benötigt werden.

Die nginx-Authentifizierung gilt als ausreichender Zugriffsschutz. Eine zusätzliche `ADMIN_API_TOKEN`-Prüfung für `POST /api/statistics/chat` ist nicht vorgesehen. Der Sidecar bleibt ohne öffentliche Portfreigabe im internen Compose-Netzwerk.

## UI-Konzept für `Statistics.tsx`

Unterhalb der Statistik-KPIs wird eine eigene Komponente `StatisticsChat.tsx` eingebaut:

- Textarea mit Beispielsfragen;
- Button „KI fragen“;
- Ladezustand und Abbruch-/Fehleranzeige;
- Verlauf der aktuellen Sitzung, lokal begrenzt und beim Laden mit dem serverseitigen Verlauf synchronisiert;
- Verlauf löschen über die serverseitige History-Route;
- Antwort mit Faktenkarten für Datum, Messwert, Einheit und Zeitraum;
- aufklappbare „Berechnungsdetails“ mit verwendeter Metrik und Datenabdeckung;
- Hinweis „Antwort basiert auf lokalen Messdaten“;
- leere, nicht konfigurierte und Sidecar-nicht-erreichbare Zustände;
- Tastaturbedienung, sichtbarer Fokus, `aria-live` für neue Antworten und mobile Darstellung.

Der Chat soll die aktive Sprache der Anwendung verwenden. Neue Schlüssel kommen in `src/locales/de/common.json` und `src/locales/en/common.json`. Markdown aus dem Modell wird nicht ungefiltert als HTML gerendert; entweder wird nur ein sicherer Text-/Zeilenumbruch-Renderer verwendet oder Markdown wird mit einer geprüften, erlaubten Teilmenge behandelt.

Der Client ruft ausschließlich die Ecowitt-Route auf. Die Sidecar-URL und Modellkonfiguration dürfen niemals an den Browser gelangen.

## Prompt- und Antwortregeln

Der System-/Aufgabenprompt muss dem Modell ausdrücklich vorgeben:

1. Nur die übergebenen Fakten verwenden.
2. Keine Messwerte ergänzen oder schätzen.
3. Zeitraum, Sensor, Aggregation und Einheit nennen.
4. Bei fehlender Datenabdeckung Unsicherheit offen benennen.
5. Bei nicht unterstützten Fragen eine Rückfrage oder Einschränkung formulieren.
6. Temperaturen und Niederschlag nicht verwechseln.
7. Datumsangaben nach der Serverzeitzone ausgeben.
8. Die strukturierte Antwort muss gültiges JSON entsprechend der Schema-Version sein.

Die serverseitige Route validiert die Modellantwort erneut. Bei ungültigem JSON wird entweder ein sicherer lokaler Fallback verwendet oder ein kontrollierter Fehler zurückgegeben; ungültige Modellfelder werden nicht ungeprüft an die UI weitergereicht.

## Sicherheits- und Datenschutzanforderungen

- Keine Provider-API-Schlüssel im Next.js-Client oder in Browserantworten.
- Keine freie SQL- oder Dateisystem-Schnittstelle für das Modell.
- Allowlist für Operationen, Metriken, Operatoren, Sortierungen, Zeitraumgröße und `limit`.
- Maximale Nachrichten- und Verlaufslänge sowie Request-Timeout; zusätzliche Client-Authentifizierung oder Rate-Limits sind wegen der nginx-Absicherung nicht Bestandteil dieses Plans.
- Prompt-Injection aus Benutzertext darf die Statistik-Allowlist nicht erweitern.
- Rohdaten nur für die konkret benötigte Zeitspanne und mit begrenzter Zeilenanzahl an den Sidecar senden.
- Logs dürfen keine API-Schlüssel, vollständigen Gesprächsverläufe oder unnötigen Messdaten enthalten.
- Sidecar-Fehler, Providerfehler und Datenfehler getrennt behandeln und ohne interne Pfade an den Browser melden.
- Chat-Historie wird serverseitig unter der zufälligen `conversation_id` persistent gespeichert; der Browser hält nur eine lokale Spiegelung für schnelle Wiederherstellung.

## Umsetzungsphasen

### Phase 1: Datenabfragen und Verträge

- Statistik-Chat-Typen für Request, Intent, Fakten, Quelle, Verlauf, Cache und Antwort anlegen.
- Gemeinsame Normalisierung für Datum, Zahl, Einheit und Zeitzone definieren.
- Erlaubte Operationen implementieren: `threshold_days`, `top_days`, `extreme_day`, `count_days`, `aggregate_period`.
- DuckDB-Abfragen mit parametrisierten/allowlist-basierten Ausdrücken implementieren.
- Abdeckung, fehlende Tage und Datenquelle in jedem Ergebnis ausgeben.
- Datenrevision, kanonische Intent-Fingerprints, History-Persistenz und Cache-Key-Bildung implementieren.
- Unit-Tests für 2025-Temperatur über 30 °C, größte Niederschlagstage, Vergleiche 2024/2025, globale Extremwerte 2024–2026, Kanalwerte, leere Bereiche und fehlende Werte schreiben.

### Phase 2: Sidecar-Adapter

- `src/lib/server/piSidecar.ts` als kleinen, gekapselten HTTP-Client anlegen.
- `src/lib/server/statisticsChatStore.ts` für History, Fakten-Cache, Antwort-Cache und atomare JSON-Speicherung anlegen.
- Konfiguration aus Umgebungsvariablen laden und validieren.
- POST `/run-chat`, JSON-Parsing, Timeout, Statuscodes und redigiertes Fehlerlogging implementieren.
- Ecowitt-`ai_request`-Schema und Prompt-Builder anlegen.
- Erst den lokalen Statistikplan testen; danach den Sidecar zur Plan-/Antwortformulierung aktivieren.
- Sidecar-Ausfall mit verständlichem lokalem, regelbasiertem Ergebnis behandeln, wenn die Fakten bereits berechnet werden konnten.

### Phase 3: Next.js-API-Route

- `src/app/api/statistics/chat/route.ts` erstellen.
- Body, Locale, Verlauf und Message-Limit validieren.
- Frage klassifizieren/planen lassen oder für den MVP einen begrenzten lokalen Parser plus Sidecar-Nachbearbeitung verwenden.
- Intent validieren, Abfrage ausführen, Fakten prüfen, Antwort generieren und Antwortschema validieren.
- `Cache-Control: no-store` und passende Fehlerantworten setzen.
- Route mit und ohne Sidecar-Konfiguration testen.

### Phase 4: UI und Übersetzungen

- `src/components/StatisticsChat.tsx` implementieren.
- In `src/components/Statistics.tsx` an geeigneter Stelle einbinden.
- `src/constants.js` um `STATISTICS_CHAT` ergänzen.
- Deutsche und englische Übersetzungen, Lade-/Fehler-/Fallbackzustände und Beispielprompts ergänzen.
- Responsive Layout und Accessibility prüfen.

### Phase 5: Betrieb und Dokumentation

- `env.example`, `README.md` und Docker-Dokumentation um Sidecar-Netzwerk und Konfiguration ergänzen.
- Start-/Health-Checks dokumentieren: Ecowitt-Route, Sidecar-Verfügbarkeit, Modellkonfiguration.
- Redigiertes KI-Traffic-Logging nur bei bewusst aktivierter Diagnoseoption vorsehen.
- Metriken erfassen: Anfrageanzahl, Latenz, Sidecarfehler, ungültige Pläne, Fallbackrate.

## Testplan

### Fachliche Tests

- „Wann hatte es in 2025 mehr als 30 °C?“ liefert ausschließlich Tage mit `tmax > 30`.
- Ein Tag mit exakt `30.0 °C` wird bei „mehr als 30“ nicht gelistet.
- Größte Niederschläge sind absteigend nach Tageswert sortiert und enthalten mm sowie Datum.
- Jahres-, Monats- und benutzerdefinierte Zeiträume grenzen sich korrekt ab.
- Vergleichszeiträume liefern Werte für alle angeforderten Perioden, auch wenn eine Periode keine Daten enthält.
- Absolute und relative Differenzen werden mit korrektem Vorzeichen und ohne Division durch null ausgegeben.
- Der globale Extremwert über mehrere Jahre verwendet den Rohzeitstempel, sofern verfügbar.
- Fehlende Messwerte werden nicht als 0 gezählt.
- Nicht vollständige Datenabdeckung wird angezeigt.
- Grenzwerte, negative Temperaturen, Dezimalkomma und deutsche Datumsformulierungen funktionieren.
- Kanalfragen verwenden den Messwertkatalog, die konfigurierte Kanalbezeichnung und die passende Aggregation; bei unbekannter Kanal-ID erfolgt eine Rückfrage.

### Technische Tests

- API-Tests für Requestvalidierung, Intent-Allowlist, DuckDB-Abfrage, Antwortschema, Verlauf und Cache-Fingerprints.
- Tests für Cache-Hit, Cache-Miss, Datenrevisionswechsel, deduplizierte Turns und parallele identische Requests schreiben.
- Mock-Sidecar für Erfolg, Timeout, HTTP-Fehler, ungültiges JSON und Providerfehler.
- Keine Seiteneffekte auf `weather.duckdb`, Parquet-Dateien oder Statistik-Cache durch reine Chatfragen.
- UI-Tests für Laden, Mehrfachfragen, Verlauf-Wiederherstellung, Verlauf-Löschen, Cache-Hinweis, leere Antworten, Fehler, lange Antworten und mobile Breite.
- Build- und TypeScript-Prüfung mit `npm run build`.
- Manueller Integrationstest mit echtem PI-Sidecar und einem Zeitraum, dessen Ergebnis gegen die Statistikseite gegengeprüft wird.

## Abnahmekriterien

Die erste Version ist fertig, wenn:

- der Chat auf der Statistikseite sichtbar und in Deutsch/Englisch bedienbar ist;
- die beiden genannten Beispielanfragen mit lokal nachprüfbaren Zahlen funktionieren;
- keine freie SQL-Ausführung und kein Client-seitiger KI-Schlüssel existiert;
- Sidecar-Ausfall verständlich angezeigt wird und die Seite selbst funktionsfähig bleibt;
- ein Seitenreload den serverseitig gespeicherten Verlauf wiederherstellt;
- identische Fragen bei unveränderter Datenrevision aus dem Cache bedient werden und dies in den API-Daten erkennbar ist;
- eine geänderte Datenrevision keinen veralteten Statistik-Cache verwendet;
- Antwort, Zeitraum, Einheit, Datenquelle und mögliche Datenlücken sichtbar sind;
- automatisierte Tests die Grenzfälle für `> 30 °C`, Niederschlagsranking, Jahresvergleiche, mehrjährige Extremwerte und fehlende Werte abdecken;
- die Betriebs-/Konfigurationsschritte für Docker und lokale Entwicklung dokumentiert sind.

## Bewusste Nicht-Ziele des MVP

- keine Wettervorhersagen oder allgemeine Wetterberatung;
- keine Schreiboperationen auf Wetterdaten;
- keine freie Analyse unbekannter oder technisch interner CSV-Spalten durch das Modell; alle vorhandenen unterstützten Messwerte und Kanäle werden jedoch über den Messwertkatalog zugänglich gemacht;
- keine Speicherung personenbezogener Profildaten; der Verlauf wird nur unter einer zufälligen `conversation_id` geführt;
- keine automatische Langzeit-Memory oder Modellfeinabstimmung;
- keine Visualisierungserzeugung durch die KI; vorhandene Chart-/Statistikkomponenten bleiben die Quelle für Diagramme.

## Festgelegte Entscheidungen

1. Die bestehende nginx-Authentifizierung ist ausreichend; keine zusätzliche Chat-Authentifizierung in Next.js.
2. Der PI-Sidecar wird als eigener Service in `docker-compose.yml` betrieben und über den internen Namen `pi-sidecar` angesprochen.
3. Provider-API-Keys werden aus der Ecowitt-`.env` per `env_file` in den Sidecar injiziert; Schlüsselwerte werden weder in Compose-Dateien eingecheckt noch an den Browser übertragen.
4. Der Chat unterstützt alle vorhandenen Kanäle und Messwerte über einen serverseitig erzeugten, validierten Messwertkatalog.
5. Bei Sidecar-Ausfall wird eine lokale regelbasierte Antwort aus den berechneten Fakten erzeugt.
6. Tagesgrenzen und Datumsformatierung basieren auf der Serverzeit.

## Docker-Compose-Umsetzung

Die Sidecar-Implementierung liegt vollständig im Ecowitt-Repository, beispielsweise unter `pi-sidecar/`. Vorgesehene Dateien sind `pi-sidecar/package.json`, `pi-sidecar/src/server.ts`, `pi-sidecar/src/config.ts`, `pi-sidecar/src/piRunChatService.ts` und `pi-sidecar/Dockerfile`. Diese Dateien werden unabhängig von TileCompile entwickelt, getestet und gebaut.

- `app` erhält `depends_on` auf `pi-sidecar` mit `condition: service_healthy`.
- `PI_SIDECAR_URL` wird in `app` auf `http://pi-sidecar:3001` gesetzt.
- Der neue `pi-sidecar` wird vollständig im Ecowitt-Repository implementiert und mit einem Ecowitt-eigenen `pi-sidecar/Dockerfile` gebaut. Der Build-Kontext ist ausschließlich das Ecowitt-Repository; es gibt keine Abhängigkeit zu TileCompile-Dateien oder -Images.
- Der Sidecar bindet dieselbe Ecowitt-`.env` per `env_file` ein; darin enthaltene Provider-Keys werden nicht in Compose-Dateien dupliziert.
- Der Sidecar veröffentlicht keinen Host-Port, sondern nur Port 3001 per `expose`.
- Der Healthcheck ruft `GET /health` auf; der vorhandene Sidecar-Endpunkt ist dafür geeignet.
- Die Route verwendet serverseitige Zeit für Tagesgrenzen.

## Empfohlene Reihenfolge

Zuerst Phase 1 und die fachlichen Tests umsetzen. Danach den Compose-Sidecar mit Provider-Umgebungsvariablen und Healthcheck bereitstellen und anschließend Phase 2 sowie die API-Route bauen. Erst wenn die Zahlen unabhängig vom Modell korrekt sind, werden UI und echter PI-Sidecar aktiviert. Der lokale Fallback bleibt dauerhaft verfügbar, damit die Statistikseite auch bei Provider- oder Sidecar-Problemen nutzbar bleibt.
