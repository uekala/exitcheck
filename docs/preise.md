# Preisannahmen

Exitcheck rechnet mit Vorgabewerten, die im Bericht unter „Preise und Zeitraum anpassen“ und „Stundensatz und Zeiten anpassen“ geändert werden können. Für eine Entscheidung zählen die Preise aus dem eigenen Angebot. Alle Vorgaben stehen in [`src/prices.js`](../src/prices.js); der Bericht zeigt bei jeder Vorgabe den Stand und listet die Quellen unter „Grenzen der Prüfung“.

Stand dieser Übersicht: 10.11.2026.

| Annahme | Wert | Stand | Art | Quelle |
|---|---|---|---|---|
| VMware Cloud Foundation (VCF) | 350 $ je Kern und Jahr | November 2026 | berichtet | [Redress Compliance: VMware VCF pricing 2026](https://redresscompliance.com/vmware-vcf-pricing-2026) |
| VMware vSphere Foundation (VVF) | 135 $ je Kern und Jahr | November 2026 | berichtet | [NAND Research, Dez. 2023](https://nand-research.com/wp-content/uploads/2023/12/NAND-Impact-of-VMware-Subscription-Changes.pdf) |
| vSphere Standard | 50 $ je Kern und Jahr | November 2026 | berichtet | [NAND Research, Dez. 2023](https://nand-research.com/wp-content/uploads/2023/12/NAND-Impact-of-VMware-Subscription-Changes.pdf) |
| VMware-Mindestmenge je Bestellung | 72 Kerne (Vorgabe im Bericht: 0) | November 2026 | berichtet | [Redress Compliance: VCF cost per core](https://redresscompliance.com/vmware-cloud-foundation-cost-per-core.html) |
| Proxmox VE Community / Basic / Standard / Premium | 120 / 370 / 550 / 1.100 € je CPU-Sockel und Jahr, netto | Oktober 2026 | offiziell | [Proxmox: Preise Proxmox VE](https://www.proxmox.com/proxmox-ve/pricing) |
| Windows Server 2025 Standard | 1.176 $ je 16 Kerne, einmalig | November 2026 | offiziell (US-Preisempfehlung) | [Microsoft: Windows Server pricing](https://www.microsoft.com/en-us/windows-server/pricing) |
| Stundensatz IT-Infrastruktur (Median) | 95 € je Stunde | Juli 2026 | Befragung | [freelancermap: IT-Freelancer Stundensatz 2026](https://www.freelancermap.de/blog/stundensatz-it-freelancer/) |

Hinweise:

- **Broadcom veröffentlicht keine Preisliste.** Die VMware-Werte stammen aus Berichten von Analysten und Lizenzberatern. Die VVF- und vSphere-Standard-Preise hat VMware Ende 2023 genannt; Berichte von 2026 nennen dieselben Werte. Für VCF werden je nach Laufzeit 350 bis 400 $ genannt.
- **Dollar ohne Umrechnung:** VMware- und Windows-Preise sind US-Listenpreise und werden im Bericht ohne Währungsumrechnung als Euro-Betrag verwendet. Das ist eine grobe Näherung; deutsche Angebote weichen ab.
- **Mindestmenge:** Händler berichten von 72 Kernen je Bestellung. Broadcom bestätigt das nicht öffentlich, deshalb rechnet der Bericht standardmäßig ohne Mindestmenge.
- **Hyper-V:** Der Bericht rechnet den Preis je 16 Kerne auf einen Kern um (1.176 $ ÷ 16 ≈ 74). Sind die Hosts wegen Windows-VMs schon mit Windows Server lizenziert, fallen keine Kosten an.

## Aktualisieren

1. Die Quelle aus der Tabelle öffnen und den aktuellen Wert ablesen.
2. In `src/prices.js` Wert, `asOf` (Jahr und Monat der Prüfung) und bei Bedarf die Quelle ändern.
3. Diese Tabelle und den Abschnitt „Unveröffentlicht“ im [Changelog](../CHANGELOG.md) anpassen.
4. `npm test` und `npm run build` ausführen.

Die CI warnt mit `tools/check-prices.mjs`, sobald eine Annahme älter als sechs Monate ist. Der Build läuft trotzdem weiter.
