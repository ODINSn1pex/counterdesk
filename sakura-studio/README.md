# Sakura Studio

Eigene Bildbearbeitung für Windows (Electron + React) im Sakura-Nacht-Design.

## Bauen
```bash
npm install
npm run build                     # Web-Bundle nach dist/
npx electron-builder --win dir    # Programmordner release/win-unpacked
cd installer && makensis sakura.nsi   # Installer -> release/Sakura-Studio-Setup-1.0.0.exe
```
Der Installer legt standardmäßig `Desktop\Sakura Studio` an (Programm + Unterordner `Projekte`),
erstellt Desktop- und Startmenü-Verknüpfungen und verknüpft `.sakura`-Projektdateien.

## Aufbau
- `electron/` – Hauptprozess (rahmenloses Fenster, Datei-Dialoge, Arbeitsordner auf dem Desktop)
- `src/engine/` – Ebenen, Protokoll, Zusammensetzen, Auswahl, Filter & Korrekturen
- `src/tools.js` – alle Werkzeuge
- `src/ui/` – Oberfläche, Bedienfelder, Dialoge, Tutorial (erscheint beim ersten Start)
- `src/io/psd.js` – PSD-Import/-Export
