# Anleitung: Umgebung exportieren und mit Exitcheck auswerten

Vom Export bis zum fertigen Bericht vergehen meist nur wenige Minuten. Sie brauchen:

- einen Windows-Rechner, der den vCenter (oder einen ESXi-Host) erreicht, zum Beispiel Ihren Admin-PC
- ein Konto im vCenter, das nur lesen darf
- einen aktuellen Browser (Edge, Chrome, Firefox oder Safari)

## 1. RVTools besorgen

[RVTools](https://www.dell.com/support/kbdoc/de-de/000325532/rv-4-8-1) ist ein kostenloses Inventarwerkzeug für vSphere, das inzwischen Dell herausgibt. Laden Sie die aktuelle Version herunter und installieren Sie sie auf dem Windows-Rechner.

Dürfen auf Ihren Admin-Rechnern nur freigegebene Programme laufen, klären Sie das vorher.

## 2. Mit dem vCenter verbinden

1. RVTools starten.
2. Den Namen (FQDN) des vCenters eintragen.
3. Mit einem Konto anmelden, das nur lesen darf. Die vCenter-Rolle „Read-only“ genügt; mehr Rechte braucht RVTools nicht.

Ohne vCenter geht es auch direkt mit einem ESXi-Host – dann enthält der Export nur diesen einen Host.

**Wenn die Verbindung am Zertifikat scheitert:** Seit Version 4.8.1 prüft RVTools Zertifikate streng. Hinterlegen Sie das Zertifikat des vCenters auf dem Rechner als vertrauenswürdig. Für Läufe in der Kommandozeile oder als geplante Aufgabe gibt es zusätzlich den Schalter `-BypassSSLCheck`.

## 3. Alles exportieren

1. Warten, bis RVTools alles eingelesen hat. Bei vielen VMs dauert das einige Minuten.
2. Im Menü *File* den Punkt *Export all to Excel* wählen.
3. Die `.xlsx`-Datei speichern.

Hat jeder Standort einen eigenen vCenter, machen Sie für jeden einen Export. Exitcheck führt die Dateien später zu einem Bericht zusammen.

Statt Excel funktionieren auch die CSV-Dateien von *Export all to csv*. Legen Sie dann alle CSV-Dateien des Exports gemeinsam ab.

## 4. Exitcheck öffnen

Öffnen Sie <https://uekala.github.io/exitcheck/>.

Die Seite rechnet vollständig im Browser und sendet nichts – ihre Content-Security-Policy verbietet jede Netzwerkverbindung. Wer ganz sicher gehen will, speichert sie über den Link ganz unten auf der Seite als Datei und öffnet diese Datei auf dem Admin-PC ohne Internet.

## 5. Exporte ablegen und Annahmen anpassen

1. Alle Exportdateien zusammen in das Feld „RVTools-Export hier ablegen“ ziehen oder über „Datei auswählen“ öffnen.
2. Oben das Ziel wählen: **Proxmox VE** oder **Hyper-V**. Stolpersteine und Kosten richten sich danach.
3. Unter **Kosten → Preise und Zeitraum anpassen** die Zahlen aus Ihrem Broadcom-Angebot eintragen, die gewünschte Proxmox-Supportstufe wählen und angeben, ob die Hosts schon mit Windows Server lizenziert sind.
4. Unter **Aufwand → Stundensatz und Zeiten anpassen** den eigenen oder angebotenen Stundensatz eintragen.

Die Einstellungen merkt sich der Browser für den nächsten Besuch.

## 6. Ergebnis prüfen und weitergeben

- Ganz unten unter **Grenzen der Prüfung** steht, welche Angaben im Export fehlen – etwa die vTPM-Spalte bei älteren RVTools-Versionen. Diese Punkte von Hand prüfen.
- Ein Klick auf einen VM-Namen in **Alle VMs** zeigt jeden Befund mit dem Hinweis, was zu tun ist.
- Vor dem Weitergeben **Namen ausblenden** einschalten. VM-, Host-, Cluster-, Datastore- und Netzwerknamen werden dann durch neutrale Bezeichnungen ersetzt – im Bericht, beim Drucken und im CSV-Export.
- **Drucken** erzeugt über „Als PDF speichern“ einen Bericht für die Entscheidungsvorlage.
- **Als CSV speichern** liefert die VM-Liste mit allen Befunden für Excel.

## Datenschutz

Ein RVTools-Export enthält VM- und Hostnamen, IP-Adressen, Betriebssysteme und Lizenzangaben. Behandeln Sie die Datei wie jede andere interne Dokumentation: nicht in Online-Dienste, Chats oder Tickets hochladen. Exitcheck braucht das nicht – die Auswertung bleibt auf Ihrem Rechner. Lizenzschlüssel liest Exitcheck gar nicht erst ein.

## Wenn etwas nicht passt

| Meldung oder Beobachtung | Ursache und Abhilfe |
|---|---|
| „Im Export fehlt das Blatt vInfo“ | Die Datei ist kein vollständiger Export, etwa nur ein einzelnes Blatt. Mit *Export all to Excel* neu exportieren. |
| Kostenvergleich fehlt | Das Blatt vHost fehlt im Export. Vollständig exportieren. |
| Zahlen wirken unplausibel | Bitte ein [Issue anlegen](https://github.com/uekala/exitcheck/issues) mit den **Spaltenüberschriften** der Blätter vInfo und vHost und der RVTools-Version – ohne Inhalte aus Ihrer Umgebung. |

[Zurück zur Übersicht](../README.md)
