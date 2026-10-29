# Glacier Tasks — Benutzerhandbuch

Glacier Tasks ist eine Aufgabenplanung, die komplett auf deinem Computer läuft. Sie braucht kein
Konto und keine Internetverbindung und schickt nie Daten irgendwohin. Dieses Handbuch erklärt
Installation, tägliche Arbeit, Backups und Fehlerbehebung. [English version](user-guide.en.md)

## 1. Installation

Lade die Dateien für dein System von der
[Release-Seite](https://github.com/Cracksoldier/glacier-tasks/releases) herunter. Unterstützt
wird nur x64 (64-Bit Intel oder AMD).

### Download prüfen

Die Builds sind nicht signiert. Jedes Release nennt die SHA-256-Prüfsumme jeder Datei in
`SHA256SUMS.txt`. Vergleiche sie mit der Prüfsumme deines Downloads:

- Windows (PowerShell): `Get-FileHash .\Glacier-Tasks-1.0.0-win-x64-Setup.exe`
- Linux: `sha256sum -c SHA256SUMS.txt --ignore-missing`

### Windows

Starte `Glacier-Tasks-<Version>-win-x64-Setup.exe`. Weil der Installer nicht signiert ist,
zeigt Windows SmartScreen eventuell „Der Computer wurde durch Windows geschützt“. Wähle
**Weitere Informationen → Trotzdem ausführen**, aber nur für eine Datei, deren Prüfsumme du
geprüft hast.

### Linux

- **AppImage:** ausführbar machen (`chmod +x Glacier-Tasks-<Version>-linux-x86_64.AppImage`) und
  starten. Manche Distributionen brauchen für AppImages `libfuse2`.
- **deb:** `sudo apt install ./Glacier-Tasks-<Version>-linux-amd64.deb`

### Aktualisieren

Installiere die neuere Version über die alte. Deine Daten bleiben im Datenordner (Abschnitt 6).

- **Datenformat:** ändert die neue Version es, speichert die App zuerst eine Sicherheitskopie
  der Datenbank in `backups/` und aktualisiert sie dann.
- **Kein Zurück:** eine ältere Version öffnet Daten einer neueren Version nicht.

## 2. Erste Schritte

1. **Einstellungen:** wähle ein Design (hell, dunkel oder wie das System) und eine Sprache
   (Deutsch oder Englisch). Datumsfelder wechseln nach einem Neustart in die neue Sprache; die
   Einstellungen bieten dafür **Jetzt neu starten** an.
2. **Neues Projekt:** gib ihm einen Namen und einen Schlüssel aus 2–10 Zeichen, zum Beispiel
   `GAME`. Jede Story und Unteraufgabe bekommt eine ID wie `GAME-12`. Der Schlüssel lässt sich
   nur ändern, solange es noch keine Aufgabe gibt.
3. **Profile:** lege Profile für die Personen an, denen du Arbeit zuweist (Namen und optional
   Bilder). Archivierte Profile bleiben in alten Aufgaben sichtbar.

## 3. Tägliche Arbeit

### Stories und Unteraufgaben

- **Felder:** eine Story hat Titel, Markdown-Beschreibung, Priorität, Status, Zuständige
  Person, Start- und Fälligkeitsdatum sowie Labels. Unteraufgaben gehören zu genau einer Story
  und lassen sich in eine andere Story verschieben.
- **Speichern:** Änderungen bleiben mit **Speichern** erhalten; **Abbrechen** verwirft sie. Hat
  sich die Aufgabe inzwischen geändert, behält die App deinen Text und bietet an, neu zu laden.
- **Status:** der Status einer Story und der ihrer Unteraufgaben sind unabhängig. Sind alle
  Unteraufgaben erledigt, ist die Story deshalb noch nicht erledigt.

### Board

- **Spalten:** eine pro Status, mit Stories als Karten. Ziehe eine Karte in eine andere Spalte
  oder an eine andere Stelle ihrer Spalte. Die Statusauswahl auf jeder Karte macht dasselbe per
  Tastatur. Eine in eine andere Spalte verschobene Karte kommt dort nach oben.
- **Gruppieren: Unteraufgaben:** jede Story mit Unteraufgaben bekommt eine eigene Zeile mit den
  Statusspalten, und jede Unteraufgabe lässt sich einzeln in einen anderen Status ziehen.
  Stories ohne Unteraufgaben folgen unter **Weitere Stories**.
- **Lange Spalten:** sie zeigen zuerst 100 Karten; **Mehr anzeigen** lädt den Rest.

### Liste, Filter und Suche

- **Liste:** Stories als aufklappbare Zeilen mit ihren Unteraufgaben. Spalten wählst du unter
  **Spalten**; sortiert und gefiltert wird nach Typ, Status, Priorität, Zuständigkeit, Labels und
  Fälligkeit.
- **Treffer:** eine passende Unteraufgabe erscheint unter ihrer Story; die Story ist
  ausgegraut, wenn sie selbst nicht passt.
- **Gespeichert:** Sortierung, Filter und Spalten pro Projekt. Das Board nutzt dieselben Filter
  für seine Story-Karten.
- **Suchseite:** **Suche** (Strg+F) durchsucht das zuletzt geöffnete Projekt oder alle Projekte.
  Die Suche findet Titel, Beschreibungen und Aufgabenschlüssel; jedes Wort wird ab seinem Anfang
  gesucht (`inv` findet „Inventory“).

### Workflows und Labels

In den **Projekteinstellungen** kannst du:
- Status anlegen, umbenennen, sortieren und einer Kategorie zuordnen. Jedes Projekt behält
  mindestens einen Erledigt-Status.
- einen Status löschen: seine Aufgaben (auch die im Papierkorb) wandern in einen Ersatz, den du
  auswählst.
- Labels mit acht Farben verwalten.

### Anhänge

- **Hinzufügen:** über **Dateien hinzufügen…** oder indem du Dateien auf den Anhangsbereich
  einer Aufgabe ziehst. Die App behält eine eigene Kopie, du kannst das Original also verschieben
  oder löschen.
- **Größenlimit:** in den Einstellungen festgelegt (Standard 100 MiB pro Datei).
- **Vorschau:** PNG-, JPEG-, GIF- und WebP-Bilder. **Einfügen** setzt ein Bild in die
  Beschreibung, wo es direkt angezeigt wird. Bilder aus anderen Quellen werden nie geladen.
- **Andere Dateien:** nach einer Bestätigung mit der App deines Systems öffnen, oder
  **Speichern unter…**.
- **Entfernen:** fragt nach und löscht die Datei sofort; der Verlauf behält einen Vermerk.

### Verlauf

- **Aufgabenverlauf:** jede Aufgabe zeigt ihren Verlauf, neueste Änderung zuerst.
- **Beschreibungsversionen:** zeige jede Version formatiert oder als Quelltext an und vergleiche
  sie mit der vorherigen.
- **Woanders:** der Reiter **Aktivität** im Projekt zeigt Änderungen an Projekt, Status, Labels
  und Aufgaben, und jedes Profil hat einen **Verlauf**-Knopf.

### Papierkorb

- **Was hineinkommt:** gelöschte Projekte, Stories und Unteraufgaben. Eine Story nimmt ihre
  Unteraufgaben mit, ein Projekt seinen ganzen Inhalt. Wiederherstellen bringt genau das zurück,
  was gemeinsam gelöscht wurde.
- **Filtern:** die Papierkorb-Seite lässt sich nach Projekt filtern; Projekte mit gelöschten
  Einträgen zeigen einen Link **Papierkorb (n)**.
- **Endgültig löschen** verlangt, den Schlüssel einzutippen (zum Beispiel `GAME-12`), und
  entfernt den Eintrag mit seinen Dateien. **Papierkorb leeren** verlangt ein
  Bestätigungswort. Endgültig gelöschte Daten bringt nur ein Backup zurück.

## 4. Backups

Unter **Einstellungen → Daten**:

- **Backup erstellen…:** speichert eine `.glaciertasks`-Datei mit allen Projekten, Profilen,
  Aufgaben, dem Verlauf, Anhängen und Bildern. Die Einstellungen dieses Computers gehören nicht
  dazu.
- **Aus Backup wiederherstellen…:**
  1. Die App prüft die Datei gründlich (Aufbau, Prüfsummen, Datenformat) und zeigt ihren Inhalt.
  2. Das Bestätigen **ersetzt alle aktuellen Daten**. Vorher wird ein Sicherheits-Backup der
     aktuellen Daten gespeichert, unter `backups/pre-restore-<Zeit>.glaciertasks` im
     Datenordner.
  3. Die App startet neu und schließt die Wiederherstellung ab. Geht dabei etwas schief, bleiben
     deine vorherigen Daten unverändert.
- **Automatische Backups (optional):** wähle einen Ordner, ein Intervall (Standard 24 Stunden)
  und wie viele behalten werden (Standard 7).
  - Ein Backup entsteht beim Start der App, wenn das Intervall abgelaufen ist.
  - In diesem Ordner werden nur Dateien gelöscht, die wie automatische Backups heißen.
  - Ist der Ordner nicht erreichbar, zeigt die App eine Warnung und arbeitet normal weiter.
- **Als JSON exportieren…:** zum Lesen oder für andere Werkzeuge, für ein Projekt oder alles.
  **Das ist kein Backup**: es lässt sich nicht wiederherstellen und enthält keine Anhänge oder
  Bilder.

**Empfehlungen:**
- Schalte automatische Backups in einen Ordner auf einem anderen Laufwerk oder einen
  synchronisierten Ordner ein.
- Erstelle vor größeren Änderungen ein manuelles Backup.
- Probiere ab und zu eine Wiederherstellung auf einem zweiten Computer oder Testkonto aus.

## 5. Umzug auf einen anderen Computer

1. Auf dem alten Computer: **Einstellungen → Daten → Backup erstellen…**
2. Installiere Glacier Tasks auf dem neuen Computer.
3. Dort: **Einstellungen → Daten → Aus Backup wiederherstellen…**, und wähle die Datei.

Einstellungen (Design, Sprache, Fenstergröße, Ordner für automatische Backups) gehören zum
jeweiligen Computer; lege sie auf dem neuen Computer erneut fest.

## 6. Datenordner

| System | Ordner |
| --- | --- |
| Windows | `%APPDATA%\Glacier Tasks` |
| Linux | `~/.config/Glacier Tasks` |

Er enthält:
- `glacier-tasks.sqlite` (mit `-wal`/`-shm`, solange die App läuft): die Datenbank
- `attachments/`, `avatars/`: die verwalteten Dateien, unter zufälligen Namen gespeichert
- `backups/`: Sicherheitskopien vor Aktualisierungen und Wiederherstellungen
- `logs/main.log`: technisches Protokoll; enthält nie Aufgabentexte oder Dateiinhalte
- `device-settings.json`: die Einstellungen dieses Computers

Bearbeite diese Dateien nicht, während die App läuft. Um neu anzufangen, beende die App und
verschiebe den ganzen Ordner an einen anderen Ort.

## 7. Fehlerbehebung

- **Die App zeigt beim Start einen Fehler:** die Meldung sagt, ob die Daten beschädigt,
  unlesbar oder von einer neueren Version sind. **Datenordner öffnen** zeigt die
  Sicherheitskopien in `backups/`. Stelle dein letztes `.glaciertasks`-Backup wieder her, oder
  eröffne ein Issue auf [GitHub](https://github.com/Cracksoldier/glacier-tasks/issues) und
  hänge `logs/main.log` an.
- **Die App startet kein zweites Mal:** es läuft nur eine Instanz. Das offene Fenster kommt nach
  vorne.
- **Eine Wiederherstellung hat nicht geklappt:** die App meldet „Die Wiederherstellung konnte
  nicht abgeschlossen werden“ und behält deine vorherigen Daten. Prüfe, ob die Datei ein
  `.glaciertasks`-Backup ist und kein JSON-Export.
- **Ein automatisches Backup ist fehlgeschlagen:** eine Warnung mit Link zu den Einstellungen
  erscheint. Prüfe, ob der Ordner existiert und beschreibbar ist.
- **Datumsfelder zeigen das falsche Format:** starte die App nach einem Sprachwechsel neu.

## 8. Einschränkungen

- **Ein Nutzer pro Installation:** ein einzelner Nutzer, keine Synchronisierung, kein Teilen,
  keine Konten.
- **Aufgabenstruktur:** eine Ebene Unteraufgaben. Keine Sprints, Epics, Abhängigkeiten,
  Kommentare oder Zeiterfassung.
- **Suche:** findet Wörter ab ihrem Anfang, nicht mitten im Wort.
- **Plattformen:** Windows und Linux auf x64. Keine Builds für macOS oder ARM.
- **Nicht signierte Builds:** rechne mit SmartScreen- oder ähnlichen Warnungen.
