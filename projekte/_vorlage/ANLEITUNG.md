# Neues Projekt anlegen

1. Diesen Ordner kopieren und umbenennen, z.B. `projekte/mein-projekt`
   (Kleinbuchstaben, Bindestriche, keine Umlaute, **kein** Unterstrich am Anfang).
2. In der neuen `index.html` anpassen:
   - `data-slug="..."` im `<body>` = Ordnername
   - `--akzent:#......` im `<body>` = Akzentfarbe des Projekts
   - Nummer (`p-nr`), Titel, Slogan, Texte. Jeder Text steht zweimal:
     `<span lang="de">…</span><span lang="en">…</span>`
   - Kennzahlen: `<span class="zahl" data-wert="78.1" data-dez="1">` zählt hoch
     und formatiert sich je nach Sprache selbst (Punkt als Dezimaltrenner in `data-wert`).
   - Abschnitte, die du nicht brauchst, einfach löschen.
3. Medien in einen Unterordner `media/` legen.
   Bilder als WebP unter 300 KB, Videos als MP4 ohne Ton (H.264), möglichst unter 2 MB.
4. In `projekte/projekte.js` einen Eintrag ergänzen (`slug` = Ordnername).
   Damit erscheint die Karte auf der Startseite und der Link "Nächstes Projekt".

Dieser Vorlagenordner beginnt mit einem Unterstrich und wird deshalb von
GitHub Pages nicht veröffentlicht.
