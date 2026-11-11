# Changelog

Alle nennenswerten Änderungen an Exitcheck. Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## Unveröffentlicht

### Geändert

- Alle Preisannahmen und der Stundensatz stehen an einer Stelle (`src/prices.js`), jeweils mit Stand und Quelle. Die Vorgabewerte sind unverändert.
- Der Bericht nennt bei allen Vorgaben den Stand und listet unter „Grenzen der Prüfung“ die Quellen der Preisannahmen.

### Neu

- `docs/preise.md`: Übersicht der Preisannahmen und Ablauf zum Aktualisieren.
- `npm run coverage`: Tests mit Abdeckungsbericht und Mindestwerten (Zeilen 90 %, Zweige 80 %, Funktionen 90 %); läuft in der CI.
- `tools/check-prices.mjs` warnt in der CI, wenn eine Preisannahme älter als sechs Monate ist.
- Die Versionsprüfung vergleicht zusätzlich den neuesten Changelog-Eintrag.

## 0.1.1 – 2026-10-29

- Anleitung für Export und Auswertung (`docs/anleitung.md`), verlinkt in README und Seite.

## 0.1.0 – 2026-10-28

Erste Version.

- Liest RVTools-Exporte (xlsx oder CSV-Dateien je Blatt) vollständig im Browser; die Content-Security-Policy verbietet jede Netzwerkverbindung.
- Kostenvergleich: Broadcom-Lizenz nach Kernen gegen Proxmox-VE-Subskription nach Sockeln und Hyper-V, über einen wählbaren Zeitraum und inklusive Umzug.
- Stolpersteine je VM für Proxmox VE und Hyper-V.
- Aufwandsschätzung in Personentagen und reine Kopierzeit.
- „Namen ausblenden“ für Bericht, Druck und CSV-Export; eingebaute Beispieldaten.
