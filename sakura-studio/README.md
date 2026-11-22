# Lumora

Eigene Bildbearbeitung für Windows (Electron + React) im Themes Dunkel, Hell und Anime.

## Bauen
```bash
npm install
sh scripts/fetch-models.sh        # KI-Modelle (nicht im Repository)
npm run build                     # Web-Bundle nach dist/
npx electron-builder --win dir    # Programmordner release/win-unpacked
cd installer && makensis lumora.nsi   # Installer -> release/Lumora-Setup-4.0.0.exe
```
Der Installer legt standardmäßig `Desktop\Lumora` an (Programm + Unterordner `Projekte`),
erstellt Desktop- und Startmenü-Verknüpfungen und verknüpft `.lumora`-Projektdateien.

## Aufbau
- `electron/` – Hauptprozess (rahmenloses Fenster, Datei-Dialoge, Arbeitsordner auf dem Desktop)
- `src/engine/` – Ebenen, Protokoll, Zusammensetzen, Auswahl, Filter & Korrekturen
- `src/tools.js` – alle Werkzeuge
- `src/ui/` – Oberfläche, Bedienfelder, Dialoge, Tutorial (erscheint beim ersten Start)
- `src/io/psd.js` – PSD-Import/-Export (inkl. Ebenenstile und aller Füllmethoden)
- `src/io/presets.js` – Photoshop-Vorgaben: Muster (.pat), Stile (.asl), Verläufe (.grd), Farbfelder (.aco)
- `src/advanced.js` – Ausbessern, inhaltsbasiert verschieben/skalieren, generativ erweitern, Himmel austauschen,
  Hochskalieren, Ebenen ausrichten/überblenden, Photomerge, HDR, Export als SVG/PDF/mehrere Größen/Slices
- `src/engine/heavy.js` – rechenintensive Operationen im Worker (Seam Carving, Hochskalieren)
- `src/textTools.js` – Text verkrümmen, Absatz-/Zeichenformate, Suchen & Ersetzen
