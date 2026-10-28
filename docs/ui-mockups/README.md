# Weather Control / Ecowitt UI-Mockups

Der Klickdummy [`eta-control-modern.html`](./eta-control-modern.html) zeigt eine rein visuelle
Modernisierung der bestehenden Startseite. Er enthält alle sechs heutigen Ansichten:

- Echtzeit
- Grafik
- Prognose
- Analyse
- Gespeicherte Daten
- Statistik

Der Mockup übernimmt keine Produktlogik und ruft keine APIs auf. Tabs, Hell/Dunkel-Modus,
PHI-SPACES-Farbpaletten, Stationsauswahl und einige Darstellungsumschalter dienen nur dazu,
die vorgesehenen UI-Zustände beurteilen zu können.

## Prüfen

Die HTML-Datei kann direkt im Browser geöffnet werden. Sinnvolle Prüfpunkte:

1. Desktopbreite ab 1200 px sowie Mobilbreite um 390 px.
2. Hell- und Dunkelmodus über die Buttons oben rechts.
3. Mehrere Paletten, besonders `Ecowitt Standard`, `Ozean-Puls` und `Bernstein-Signal`.
4. Horizontales Scrollen der Hauptnavigation auf schmalen Bildschirmen.
5. Lesbarkeit der semantischen Wetterfarben in allen Themes.

## Gestaltungsgrenzen

- Temperatur, Niederschlag, Feuchte, Wind, Warnung und Fehler behalten semantische Farben.
- Die Palette färbt Hintergründe, Flächen, Linien, Fokus und Auswahlzustände.
- Daten, Bezeichnungen und Bedienelemente orientieren sich am aktuellen React-Code; die
  Beispielwerte sind statisch.
