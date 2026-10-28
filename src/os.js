// Erkennt Gastbetriebssysteme und deren Supportende.
// Nur gut belegte Termine; Quelle jeweils Hersteller-Lebenszyklus (Stand Oktober 2026).

const EOL = [
  { re: /windows server 2003/i, label: 'Windows Server 2003', end: '2015-07-14' },
  { re: /windows server 2008/i, label: 'Windows Server 2008 / 2008 R2', end: '2020-01-14' },
  { re: /windows server 2012/i, label: 'Windows Server 2012 / 2012 R2', end: '2023-10-10' },
  { re: /windows server 2016/i, label: 'Windows Server 2016', end: '2027-01-12' },
  { re: /windows server 2019/i, label: 'Windows Server 2019', end: '2029-01-09' },
  { re: /windows server 2022/i, label: 'Windows Server 2022', end: '2031-10-14' },
  { re: /windows (xp|vista)\b/i, label: 'Windows XP / Vista', end: '2017-04-11' },
  { re: /windows 7\b/i, label: 'Windows 7', end: '2020-01-14' },
  { re: /windows 8(\.1)?\b/i, label: 'Windows 8 / 8.1', end: '2023-01-10' },
  { re: /windows 10\b/i, label: 'Windows 10', end: '2025-10-14' },
  { re: /centos( linux)? ?[4-6]\b/i, label: 'CentOS 6 oder älter', end: '2020-11-30' },
  { re: /centos( linux)? ?7\b/i, label: 'CentOS 7', end: '2024-06-30' },
  { re: /centos( linux)? ?8\b/i, label: 'CentOS 8', end: '2021-12-31' },
  { re: /red hat enterprise linux [3-6]\b/i, label: 'Red Hat Enterprise Linux 6 oder älter', end: '2020-11-30' },
  { re: /red hat enterprise linux 7\b/i, label: 'Red Hat Enterprise Linux 7', end: '2024-06-30' },
  { re: /debian gnu\/linux [4-9]\b/i, label: 'Debian 9 oder älter', end: '2022-06-30' },
  { re: /debian gnu\/linux 10\b/i, label: 'Debian 10', end: '2024-06-30' },
  { re: /debian gnu\/linux 11\b/i, label: 'Debian 11', end: '2026-08-31' },
];

/** Windows-Versionen, für die aktuelle VirtIO-Treiber nicht mehr gebaut werden. */
const OLD_WINDOWS = /windows (server (2003|2008|2012)|xp|vista|7\b|8\b|8\.1\b)/i;

/** Kürzt VMware-Bezeichnungen: "Microsoft Windows Server 2019 Standard (64-bit)" → "Windows Server 2019 Standard". */
export function shortOsName(text) {
  return String(text || '')
    .replace(/^Microsoft\s+/i, '')
    .replace(/\s*\((32|64)-bit\)\s*$/i, '')
    .trim();
}

export function classifyOs(configOs, toolsOs) {
  const text = toolsOs || configOs || '';
  const both = `${toolsOs || ''} ${configOs || ''}`;
  let family = 'unknown';
  if (/windows/i.test(both)) family = 'windows';
  else if (/linux|ubuntu|debian|centos|red hat|rhel|suse|sles|oracle|rocky|alma|photon|fedora|amazon|coreos|asianux/i.test(both)) family = 'linux';
  else if (text) family = 'other';
  const appliance = /photon/i.test(both) || /vmware esx/i.test(both);
  return {
    name: shortOsName(text) || 'unbekannt',
    family,
    appliance,
    oldWindows: family === 'windows' && OLD_WINDOWS.test(both),
    // "Windows Server 2016 or later" ist mehrdeutig – dann kein Supportende ableiten
    eol: /or later/i.test(text) ? null : (EOL.find((e) => e.re.test(text)) ?? null),
  };
}

/** Status des Supportendes relativ zu "heute". */
export function eolStatus(eol, today) {
  if (!eol) return null;
  const end = new Date(`${eol.end}T00:00:00Z`);
  const days = Math.round((end - today) / 86400000);
  if (days < 0) return { state: 'ended', end, label: eol.label };
  if (days <= 365) return { state: 'soon', end, label: eol.label };
  return null;
}
