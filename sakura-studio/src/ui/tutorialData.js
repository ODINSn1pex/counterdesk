// Inhalte für Tutorial und Funktionslexikon
export const TOOL_HELP = {
  move: ['Verschieben (V)', 'Verschiebt die aktive Ebene oder Auswahl. Mit „Autom. ausw.“ oder Strg+Klick wird die Ebene unter dem Mauszeiger gewählt. Pfeiltasten verschieben pixelgenau. In derselben Gruppe: Zeichenflächen-Werkzeug zum Aufziehen neuer Zeichenflächen.'],
  marquee: ['Auswahlrechteck/-ellipse (M)', 'Zieht rechteckige oder runde Auswahlen auf. Umschalt = hinzufügen bzw. quadratisch, Alt = abziehen bzw. vom Mittelpunkt. „Weiche Kante“ macht weiche Übergänge.'],
  lasso: ['Lasso & Polygon-Lasso (L)', 'Freihand-Auswahl durch Umfahren. Das Polygon-Lasso setzt per Klick gerade Kanten, Doppelklick oder Klick auf den Startpunkt schließt die Auswahl.'],
  wand: ['Schnellauswahl, Zauberstab, Objektauswahl (W)', 'Schnellauswahl: über das Motiv malen. Zauberstab: wählt ähnliche Farben per Klick (Toleranz einstellbar). Objektauswahl: Rechteck um ein Objekt ziehen – die KI wählt es genau aus.'],
  crop: ['Freistellen (C)', 'Rahmen aufziehen oder Griffe ziehen, Enter schneidet zu. In der Optionsleiste lassen sich feste Seitenverhältnisse wählen (1:1, 16:9 …).'],
  eyedropper: ['Pipette & Lineal (I)', 'Pipette nimmt eine Farbe aus dem Bild als Vordergrundfarbe auf (Alt = Hintergrundfarbe). Das Lineal misst Abstände und Winkel und kann Ebenen gerade ausrichten.'],
  heal: ['Reparatur & Entfernen (J)', 'Bereichsreparatur: kleine Makel einfach übermalen. Reparatur-Pinsel: Alt+Klick legt die Quelle fest. Rote Augen: Klick auf das Auge. Entfernen-Werkzeug (KI): Objekte übermalen – beim Loslassen verschwinden sie und der Hintergrund wird ergänzt.'],
  brush: ['Pinsel, Buntstift, Farbe ersetzen (B)', 'Malen mit Größe, Härte, Deckkraft, Fluss und Glättung; Stiftdruck wird unterstützt. [ und ] ändern die Größe, Alt nimmt eine Farbe auf. Eigene und Photoshop-Pinsel (.abr) lassen sich importieren.'],
  stamp: ['Kopier- & Musterstempel (S)', 'Kopierstempel: Alt+Klick legt die Quelle fest, dann wird von dort übertragen. Musterstempel malt mit einem Muster.'],
  history: ['Protokollpinsel (Y)', 'Malt den Zustand aus einem früheren Protokollschritt zurück – ideal, um Teile einer Bearbeitung rückgängig zu machen.'],
  eraser: ['Radiergummis (E)', 'Radiergummi macht Pixel transparent. Hintergrund-Radiergummi entfernt nur Farben ähnlich der Mitte. Magischer Radiergummi löscht ähnliche Farben per Klick.'],
  gradient: ['Verlauf & Füllwerkzeug (G)', 'Verlauf: Linie ziehen (linear, radial, Winkel, reflektiert, Raute). Füllwerkzeug: füllt zusammenhängende Flächen mit Farbe oder Muster.'],
  blur: ['Weichzeichner, Scharfzeichner, Wischfinger (R)', 'Lokal weicher oder schärfer malen; der Wischfinger verschmiert Farben wie nasse Farbe.'],
  dodge: ['Abwedler, Nachbelichter, Schwamm (O)', 'Hellt auf oder dunkelt ab (Tiefen, Mitteltöne, Lichter); der Schwamm erhöht oder verringert die Sättigung.'],
  pen: ['Zeichenstift (P)', 'Präzise Pfade: Klick = Ecke, Ziehen = Kurve. Pfade können gefüllt, nachgezogen, in Auswahlen umgewandelt oder für Text auf Pfad genutzt werden.'],
  type: ['Text (T)', 'Klick setzt Text, Strg+Enter beendet. Schrift, Größe, Farbe, Fett/Kursiv, Ausrichtung, Laufweite – auch vertikal und entlang von Pfaden.'],
  select: ['Direktauswahl (A)', 'Verschiebt einzelne Ankerpunkte und Griffe eines Pfades oder den ganzen Pfad.'],
  shape: ['Formen (U)', 'Rechteck, abgerundetes Rechteck, Ellipse, Dreieck, Polygon, Linie, Stern, Herz, Pfeil, Sprechblase … Im Modus „Form“ bleiben sie Vektoren: Farbe, Kontur und Größe sind jederzeit änderbar.'],
  view: ['Hand & Zoom (H/Z)', 'Bild verschieben bzw. zoomen. Tipp: Leertaste halten = Hand, Strg + Mausrad = Zoom.'],
};

const T = (id) => ({ title: TOOL_HELP[id][0], text: TOOL_HELP[id][1], target: 'tool-' + id, tool: id });

export const CHAPTERS = [
  { name: 'Grundlagen', steps: [
    { title: 'Willkommen bei Lumora', text: 'Diese Tour erklärt dir alle Bereiche und Funktionen. Mit den Kapitel-Punkten oben kannst du jederzeit springen; „Hilfe › Tutorial starten“ öffnet sie wieder, F1 das Funktionslexikon.', target: null, prep: 'sample', theme: true },
    { title: 'Menüleiste', text: 'Alle Befehle: Datei, Bearbeiten, Bild, Ebene, Schrift, Auswahl, Filter, Ansicht, Fenster, Hilfe. Rechts neben jedem Befehl steht sein Tastenkürzel.', target: 'menu' },
    { title: 'Werkzeugleiste', text: 'Alle Werkzeuge. Ein Dreieck in der Ecke heißt: Hier gibt es weitere Werkzeuge – Maustaste gedrückt halten oder Rechtsklick. Umschalt + Kürzel wechselt innerhalb der Gruppe.', target: 'tools' },
    { title: 'Optionsleiste', text: 'Zeigt die Einstellungen des aktiven Werkzeugs. Auf eine Beschriftung (z. B. „Deckkr.:“) klicken und ziehen ändert Werte stufenlos. Ganz rechts: Werkzeug zurücksetzen.', target: 'options', prep: 'brush' },
    { title: 'Arbeitsfläche', text: 'Mausrad scrollt, Strg + Mausrad zoomt, Leertaste halten verschiebt. Hilfslinien zieht man aus den Linealen. Bilder einfach hierher ziehen, um sie zu öffnen oder zu platzieren.', target: 'canvas' },
    { title: 'Vorder- & Hintergrundfarbe', text: 'Klick öffnet den Farbwähler. X tauscht, D setzt Schwarz/Weiß. Alt + Klick ins Bild nimmt beim Malen eine Farbe auf.', target: 'colors' },
    { title: 'Bedienfelder', text: 'Oben Farbe, Farbfelder, Verläufe, Muster; in der Mitte Eigenschaften, Korrekturen, Bibliotheken; unten Ebenen, Kanäle, Pfade. Doppelklick auf einen Reiter klappt ein; das Menü-Symbol schließt; „Fenster“ holt alles zurück.', target: 'panel-color' },
    { title: 'Seitenleiste', text: 'Weitere Bedienfelder zum Aufklappen: Protokoll (jeden Schritt zurückholen), Aktionen, Navigator, Info, Pinsel, Zeichen und Absatz.', target: 'side' },
  ] },
  { name: 'Werkzeuge', steps: ['move', 'marquee', 'lasso', 'wand', 'crop', 'eyedropper', 'heal', 'brush', 'stamp', 'history', 'eraser', 'gradient', 'blur', 'dodge', 'pen', 'type', 'select', 'shape', 'view'].map(T) },
  { name: 'Ebenen', steps: [
    { title: 'Das Ebenen-Bedienfeld', text: 'Ebenen liegen wie Folien übereinander. Auge = ein/aus, Ziehen = neu anordnen (auf eine Gruppe ziehen = hineinlegen), Doppelklick auf den Namen = umbenennen.', target: 'panel-layers', prep: 'layer' },
    { title: 'Ebenenarten', text: 'Pixel-, Text-, Form-, Einstellungs- und Füllebenen, Gruppen sowie Smart-Objekte. Text, Formen, Einstellungen und Smart-Objekte bleiben jederzeit bearbeitbar – ihre Werte stehen im Eigenschaften-Bedienfeld.', target: 'panel-layers' },
    { title: 'Masken & Stile', text: 'Unten im Bedienfeld: fx = Ebenenstile (Schatten, Kontur, Schein …), Maske = Bereiche ausblenden statt löschen (schwarz malen = ausblenden), Halbkreis = Einstellungs- und Füllebenen, Ordner = Gruppe (Strg+G).', target: 'panel-layers' },
    { title: 'Füllmethoden & Deckkraft', text: 'Oben im Bedienfeld: Füllmethode (Multiplizieren, Negativ multiplizieren, Ineinanderkopieren …), Deckkraft, Fläche und Fixierungen. Strg+E reduziert auf eine Ebene.', target: 'panel-layers' },
    { title: 'Eigenschaften', text: 'Zeigt immer passende Einstellungen: Leinwandgröße, Werte von Einstellungsebenen, Form- und Textoptionen, Smart-Objekt-Aktionen und Masken.', target: 'panel-props' },
  ] },
  { name: 'Auswählen & Entfernen', steps: [
    { title: 'Aktionsleiste', text: 'Unten auf der Arbeitsfläche erscheinen passende Aktionen: ohne Auswahl „Motiv auswählen“, „Hintergrund entfernen“, „Objekt entfernen“ – mit Auswahl „Entfernen“, „Ausschneiden → Ebene“, „Maske“, „Freistellen“, „Verfeinern“ …', target: 'quickbar' },
    { title: 'Hintergrund entfernen', text: 'Ein Klick: Die lokale KI stellt das Motiv frei und legt eine Ebenenmaske an. In der Maske kannst du mit dem Pinsel nachbessern (weiß = sichtbar, schwarz = ausgeblendet).', target: 'quickbar' },
    { title: 'Bereiche entfernen', text: 'Markiere etwas (z. B. mit dem Lasso) und wähle „Entfernen“ (Umschalt+Strg+Entf): Die KI füllt die Stelle mit passendem Inhalt. Oder nimm das Entfernen-Werkzeug (J) und übermale das Objekt.', target: 'tool-heal' },
    { title: 'Ausschneiden & Kopieren', text: '„Ausschneiden → Ebene“ (Umschalt+Strg+J) verschiebt die Auswahl auf eine eigene Ebene, „Kopieren → Ebene“ (Strg+J) dupliziert sie. Entf löscht die Auswahl transparent.', target: 'quickbar' },
    { title: 'Auswahl verfeinern', text: 'Auswahl › Auswählen und maskieren: Kanten abrunden, weichzeichnen und verschieben – mit Ausgabe als Auswahl, Maske oder neue Ebene.', target: 'menu' },
  ] },
  { name: 'Farbe, Korrekturen & Filter', steps: [
    { title: 'Korrekturen', text: 'Im Korrekturen-Bedienfeld erzeugt ein Klick eine Einstellungsebene (nicht-destruktiv): Helligkeit/Kontrast, Gradationskurven, Farbton/Sättigung, Schwarzweiß … Alt+Klick wendet direkt auf die Ebene an.', target: 'panel-props', prep: 'adjust' },
    { title: 'Filter', text: 'Menü Filter: über 50 Filter mit Live-Vorschau – Weichzeichner, Scharfzeichner, Rauschen, Stilisieren, Verzerren, Vergröbern, Rendern. Auf Smart-Objekten werden sie zu abschaltbaren Smartfiltern.', target: 'menu' },
    { title: 'Verflüssigen', text: 'Filter › Verflüssigen (Umschalt+Strg+X): Bildteile krümmen, aufblasen, zusammenziehen oder strudeln – ideal für Retusche und Effekte.', target: 'menu' },
    { title: 'Farbe wählen', text: 'Farbfeld, Farbtonleiste, RGB/HEX-Eingabe, Farbfelder und Verläufe – alle im oberen Bedienfeld.', target: 'panel-color' },
  ] },
  { name: 'Transformieren', steps: [
    { title: 'Frei transformieren', text: 'Strg+T: Ecken ziehen = skalieren, außerhalb ziehen = drehen, innen ziehen = verschieben. Enter bestätigt, Esc bricht ab.', target: 'canvas' },
    { title: 'Verzerren, Perspektive, Verformen, Formgitter', text: 'Während der Transformation in der Optionsleiste umschalten: Ecken frei verzerren, perspektivisch anpassen, über ein Gitter biegen oder mit Pins (Formgitter) natürlich verformen.', target: 'options' },
    { title: 'Smart-Objekte', text: 'Ebene › Smart-Objekte › In Smart-Objekt konvertieren: danach beliebig oft verkleinern und vergrößern, ohne Qualität zu verlieren.', target: 'menu' },
  ] },
  { name: 'Text, Formen & Pfade', steps: [
    { title: 'Text', text: 'T wählen, ins Bild klicken, tippen. Schrift und Größe in der Optionsleiste, mehr im Zeichen-Bedienfeld. Schrift › Text auf Pfad erstellen setzt Text entlang eines Zeichenstift-Pfads.', target: 'tool-type' },
    { title: 'Formen', text: 'U wählen und aufziehen (Umschalt = proportional). Formen bleiben Vektoren: Farbe, Kontur, Radius im Eigenschaften-Bedienfeld.', target: 'tool-shape' },
    { title: 'Pfade', text: 'Mit dem Zeichenstift (P) präzise Umrisse erstellen und im Pfade-Bedienfeld füllen, nachziehen oder als Auswahl laden.', target: 'tool-pen' },
  ] },
  { name: 'Automatisieren & Animation', steps: [
    { title: 'Aktionen', text: 'Seitenleiste › Aktionen: „Aufnehmen“, Arbeitsschritte ausführen, „Beenden“ – danach mit einem Klick auf andere Bilder anwenden. Stapelverarbeitung bearbeitet ganze Ordner.', target: 'side' },
    { title: 'Zeitleiste', text: 'Fenster › Zeitleiste: Ebenen ein-/ausblenden und Frames anlegen oder „Frames aus Ebenen“ nutzen. Export als animiertes GIF oder Video (MP4/WebM).', target: 'menu' },
    { title: 'Plugins', text: 'Hilfe › Plugin-Ordner öffnen: Eigene Filter und Befehle als JavaScript-Datei ablegen – ein Beispiel-Plugin (Sepia) liegt bereits dort.', target: 'menu' },
  ] },
  { name: 'Dateien & Export', steps: [
    { title: 'Speichern', text: 'Strg+S speichert ein Lumora-Projekt (.lumora) mit allen Ebenen, Standard-Ordner: Desktop › Lumora › Projekte. Ungespeichertes wird automatisch gesichert und nach einem Absturz angeboten.', target: 'menu' },
    { title: 'Photoshop & RAW', text: 'PSD-Dateien mit Gruppen, Text und Einstellungsebenen öffnen und speichern. RAW-Fotos (CR2, NEF, ARW, DNG …) öffnen den RAW-Entwicklungsdialog mit Weißabgleich, Belichtung und Rauschreduzierung.', target: 'menu' },
    { title: 'Exportieren', text: 'Datei › Exportieren: PNG, JPG, WebP, TIFF, CMYK-TIFF für die Druckerei, Ebenen als Einzeldateien, Zeichenflächen, Animationen. Ansicht › Proof-Farben (Strg+Y) zeigt die Druckvorschau.', target: 'menu' },
  ] },
  { name: 'Einstellungen & Hilfe', steps: [
    { title: 'Voreinstellungen', text: 'Bearbeiten › Voreinstellungen (Strg+K): Theme (Dunkel, Hell, Anime), Akzentfarbe, Skalierung, Mausrad-Zoom, Stiftdruck, Autosave, KI-Modelle, Raster, Einheiten und mehr.', target: 'menu' },
    { title: 'Hilfe jederzeit', text: 'F1 öffnet das Funktionslexikon mit Suche zu jeder Funktion. Hilfe › Tastaturbefehle listet alle Kürzel. Viel Spaß mit Lumora!', target: null, prep: 'layer' },
  ] },
];

// Schnelltour: wichtigste Schritte
export const QUICK = [
  CHAPTERS[0].steps[0], CHAPTERS[0].steps[1], CHAPTERS[0].steps[2], CHAPTERS[0].steps[3], CHAPTERS[0].steps[4],
  CHAPTERS[2].steps[0], CHAPTERS[3].steps[0], CHAPTERS[3].steps[2], CHAPTERS[4].steps[0], CHAPTERS[8].steps[0], CHAPTERS[9].steps[1],
];
