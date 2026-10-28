// Befunde zur Umgebung als Ganzes (Hosts, Cluster, Speicher, Netze).

// Ende des allgemeinen Supports laut VMware/Broadcom
const ESX_SUPPORT = [
  { test: (v) => v.major === 8, end: '2027-10-11', label: 'ESXi 8' },
  { test: (v) => v.major === 7, end: '2025-10-02', label: 'ESXi 7' },
  { test: (v) => v.major === 6 && v.minor >= 5, end: '2022-10-15', label: 'ESXi 6.5/6.7' },
  { test: (v) => v.major === 6, end: '2020-03-12', label: 'ESXi 6.0' },
  { test: (v) => v.major < 6, end: '2018-09-19', label: 'ESXi 5.x oder älter' },
];

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function esxSupport(host, today) {
  if (!host.esx) return null;
  const entry = ESX_SUPPORT.find((e) => e.test(host.esx));
  if (!entry) return null;
  const end = new Date(`${entry.end}T00:00:00Z`);
  return { label: entry.label, end: entry.end, ended: end < today, endText: fmtDate(entry.end) };
}

export function clustersOf(hosts) {
  const clusters = new Map();
  for (const host of hosts) {
    const key = `${host.vcenter}|${host.datacenter}|${host.cluster || `(${host.name})`}`;
    if (!clusters.has(key)) clusters.set(key, { name: host.cluster, datacenter: host.datacenter, vcenter: host.vcenter, hosts: [] });
    clusters.get(key).hosts.push(host);
  }
  return [...clusters.values()];
}

export function checkEnvironment(model, target, today) {
  const notes = [];
  const add = (level, title, detail) => notes.push({ level, title, detail });
  const proxmox = target === 'proxmox';

  const byVersion = new Map();
  for (const host of model.hosts) {
    const support = esxSupport(host, today);
    if (!support) continue;
    const entry = byVersion.get(support.label) ?? { ...support, count: 0 };
    entry.count++;
    byVersion.set(support.label, entry);
  }
  for (const s of byVersion.values()) {
    add(s.ended ? 'block' : 'note', `${s.label} auf ${s.count} Host${s.count === 1 ? '' : 's'}`,
      s.ended
        ? `Der allgemeine Support endete am ${s.endText} – keine regulären Sicherheitsupdates mehr.`
        : `Der allgemeine Support endet am ${s.endText}.`);
  }
  const old = model.hosts.filter((h) => h.esx && (h.esx.major < 6 || (h.esx.major === 6 && h.esx.minor < 5)));
  if (proxmox && old.length) {
    add('effort', 'Sehr alte ESXi-Version',
      `${old.length} Host(s) laufen mit einer Version vor 6.5 – der Proxmox-Import ist erst ab ESXi 6.5 getestet.`);
  }

  const small = model.hosts.filter((h) => h.coresPerCpu > 0 && h.coresPerCpu < 16);
  if (small.length) {
    const unused = small.reduce((sum, h) => sum + h.sockets * (16 - h.coresPerCpu), 0);
    add('note', 'Broadcom berechnet mindestens 16 Kerne pro CPU',
      `${small.length} Host(s) haben weniger als 16 Kerne pro CPU. Bezahlt werden trotzdem 16 – das sind ${unused} Kerne mehr, als vorhanden sind.`);
  }

  if (proxmox) {
    const twoNode = clustersOf(model.hosts).filter((c) => c.name && c.hosts.length === 2);
    if (twoNode.length) {
      add('note', 'Cluster mit zwei Hosts',
        `${twoNode.map((c) => c.name).join(', ')}: Ein Proxmox-Cluster aus zwei Hosts braucht für sichere Mehrheitsentscheidungen eine dritte Stimme (QDevice auf einem kleinen Zusatzgerät).`);
    }
  }

  const vsan = model.datastores.filter((d) => /vsan/i.test(d.type));
  if (vsan.length) {
    add('effort', 'vSAN entfällt',
      proxmox
        ? 'Für gemeinsamen Speicher ohne SAN kommt in Proxmox Ceph in Frage – sinnvoll ab drei Hosts mit schnellem Netz (mind. 10 Gbit/s).'
        : 'Unter Hyper-V übernimmt Storage Spaces Direct diese Rolle; es setzt Windows Server Datacenter voraus.');
  }

  if (proxmox && model.sources.length) {
    add('note', 'Direkt vom ESXi-Host importieren',
      'Der Import über vCenter ist laut Proxmox deutlich langsamer als direkt vom ESXi-Host. Höchstens etwa vier Disks gleichzeitig importieren.');
  }

  const networks = new Set();
  for (const vm of model.vms) for (const nic of vm.nics) if (nic.network) networks.add(`${vm.vcenter}|${nic.network}`);
  if (networks.size) {
    add('note', `${networks.size} Netzwerk${networks.size === 1 ? '' : 'e'} in Benutzung`,
      'Jedes Portgruppen-Netz muss im Ziel als Brücke bzw. VLAN neu angelegt werden.');
  }

  return notes;
}
