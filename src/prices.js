// Vorgabewerte für Preise und Stundensatz – mit Stand und Quelle.
//
// Alle Werte sind Annahmen, die im Bericht angepasst werden können. Beim
// Aktualisieren: Wert, `asOf` (Monat der Prüfung) und Quelle gemeinsam ändern;
// docs/preise.md beschreibt den Ablauf.

export const PRICES = {
  vmwareVcf: {
    label: 'VMware Cloud Foundation (VCF)',
    value: 350,
    unit: 'je Kern und Jahr',
    currency: 'USD',
    asOf: '2026-11',
    kind: 'reported',
    source: {
      title: 'Redress Compliance: VMware VCF pricing 2026',
      url: 'https://redresscompliance.com/vmware-vcf-pricing-2026',
    },
    note: 'Broadcom veröffentlicht keine Preisliste; berichteter US-Listenpreis, je nach Laufzeit bis 400 $.',
  },
  vmwareVvf: {
    label: 'VMware vSphere Foundation (VVF)',
    value: 135,
    unit: 'je Kern und Jahr',
    currency: 'USD',
    asOf: '2026-11',
    kind: 'reported',
    source: {
      title: 'NAND Research: Impact of VMware Subscription Changes (Dez. 2023)',
      url: 'https://nand-research.com/wp-content/uploads/2023/12/NAND-Impact-of-VMware-Subscription-Changes.pdf',
    },
    note: 'Von VMware Ende 2023 genannter Listenpreis; Berichte von 2026 nennen denselben Wert.',
  },
  vmwareVvs: {
    label: 'vSphere Standard',
    value: 50,
    unit: 'je Kern und Jahr',
    currency: 'USD',
    asOf: '2026-11',
    kind: 'reported',
    source: {
      title: 'NAND Research: Impact of VMware Subscription Changes (Dez. 2023)',
      url: 'https://nand-research.com/wp-content/uploads/2023/12/NAND-Impact-of-VMware-Subscription-Changes.pdf',
    },
    note: 'Von VMware Ende 2023 genannter Listenpreis; Berichte von 2026 nennen denselben Wert.',
  },
  vmwareMinOrder: {
    label: 'VMware-Mindestmenge je Bestellung',
    value: 72,
    unit: 'Kerne',
    currency: null,
    asOf: '2026-11',
    kind: 'reported',
    source: {
      title: 'Redress Compliance: VMware Cloud Foundation cost per core',
      url: 'https://redresscompliance.com/vmware-cloud-foundation-cost-per-core.html',
    },
    note: 'Von Händlern berichtet, von Broadcom nicht öffentlich bestätigt; deshalb standardmäßig nicht eingerechnet.',
  },
  proxmoxCommunity: {
    label: 'Proxmox VE Community',
    value: 120,
    unit: 'je CPU-Sockel und Jahr, netto',
    currency: 'EUR',
    asOf: '2026-10',
    kind: 'official',
    source: { title: 'Proxmox: Preise Proxmox VE', url: 'https://www.proxmox.com/proxmox-ve/pricing' },
  },
  proxmoxBasic: {
    label: 'Proxmox VE Basic',
    value: 370,
    unit: 'je CPU-Sockel und Jahr, netto',
    currency: 'EUR',
    asOf: '2026-10',
    kind: 'official',
    source: { title: 'Proxmox: Preise Proxmox VE', url: 'https://www.proxmox.com/proxmox-ve/pricing' },
  },
  proxmoxStandard: {
    label: 'Proxmox VE Standard',
    value: 550,
    unit: 'je CPU-Sockel und Jahr, netto',
    currency: 'EUR',
    asOf: '2026-10',
    kind: 'official',
    source: { title: 'Proxmox: Preise Proxmox VE', url: 'https://www.proxmox.com/proxmox-ve/pricing' },
  },
  proxmoxPremium: {
    label: 'Proxmox VE Premium',
    value: 1100,
    unit: 'je CPU-Sockel und Jahr, netto',
    currency: 'EUR',
    asOf: '2026-10',
    kind: 'official',
    source: { title: 'Proxmox: Preise Proxmox VE', url: 'https://www.proxmox.com/proxmox-ve/pricing' },
  },
  windowsServerStandard: {
    label: 'Windows Server 2025 Standard',
    value: 1176,
    unit: 'je 16 Kerne, einmalig',
    currency: 'USD',
    asOf: '2026-11',
    kind: 'official',
    source: {
      title: 'Microsoft: Windows Server pricing',
      url: 'https://www.microsoft.com/en-us/windows-server/pricing',
    },
    note: 'Unverbindliche Preisempfehlung (MSRP) in den USA; Preise je Land und Händler abweichend.',
  },
  hourlyRate: {
    label: 'Stundensatz IT-Infrastruktur (Median)',
    value: 95,
    unit: 'je Stunde',
    currency: 'EUR',
    asOf: '2026-07',
    kind: 'survey',
    source: {
      title: 'freelancermap: IT-Freelancer Stundensatz 2026 (Freelancer-Kompass 2026)',
      url: 'https://www.freelancermap.de/blog/stundensatz-it-freelancer/',
    },
    note: 'Befragung von Freelancern im DACH-Raum, November 2025 bis Februar 2026.',
  },
};

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** "2026-10" → "Oktober 2026". */
export function asOfLabel(asOf) {
  const [year, month] = String(asOf).split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/** Alter einer Angabe in vollen Monaten bezogen auf `today`. */
export function ageInMonths(asOf, today = new Date()) {
  const [year, month] = String(asOf).split('-').map(Number);
  return (today.getFullYear() - year) * 12 + (today.getMonth() + 1 - month);
}

/** Preise, deren Stand älter als `maxMonths` ist. */
export function stalePrices(maxMonths = 6, today = new Date()) {
  return Object.entries(PRICES)
    .filter(([, price]) => ageInMonths(price.asOf, today) > maxMonths)
    .map(([id, price]) => ({ id, label: price.label, asOf: price.asOf }));
}

/** Eindeutige Quellen in der Reihenfolge ihres ersten Auftretens. */
export function priceSources() {
  const seen = new Map();
  for (const price of Object.values(PRICES)) {
    const entry = seen.get(price.source.url) || { ...price.source, labels: [], asOf: price.asOf };
    entry.labels.push(price.label);
    if (price.asOf > entry.asOf) entry.asOf = price.asOf;
    seen.set(price.source.url, entry);
  }
  return [...seen.values()];
}
