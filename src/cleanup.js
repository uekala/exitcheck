// Aufräum-Bericht: was Speicher belegt und vermutlich niemand mehr braucht.
// Exitcheck liest nur und löscht nie. Jede Fundstelle ist „zu prüfen“, nicht „kann weg“.
// Schwellen nach Broadcom „Best practices for using VMware snapshots“ (KB 318825):
// einen Snapshot höchstens 72 Stunden behalten, besser nur 2 bis 3 Snapshots je VM.

export const CLEANUP_LEVELS = {
  block: 'Dringend',
  effort: 'Aufräumen',
  note: 'Prüfen',
};

const DAY = 86400000;
const ORDER = { block: 0, effort: 1, note: 2 };

const ageDays = (from, ref) => Math.floor((ref - from) / DAY);
const sum = (values) => values.reduce((total, v) => total + (v ?? 0), 0);
const snapshotsWord = (count) => (count === 1 ? '1 Snapshot' : `${count} Snapshots`);
const gib = (mib) => `${Math.round(mib / 1024).toLocaleString('de-DE')} GiB`;
/** Summe, oder null, wenn kein Wert bekannt ist (z. B. Snapshot-Größen bei Proxmox). */
const knownSum = (values) => (values.every((v) => v === null || v === undefined) ? null : sum(values));

/** Verbundene ISO-Abbilder; Laufwerke von Host oder Client zählen nicht. */
function connectedIsos(vm) {
  return vm.cds.filter((c) => (c.connected || c.startsConnected) && !/host|passthrough|client/i.test(c.type));
}

/**
 * Prüft die Umgebung auf Aufräumbares.
 * settings: { snapshotDays, snapshotChain, datastoreFreePct, thinMinGiB }
 * Das Alter von Snapshots zählt ab dem Export, nicht ab heute.
 */
export function checkCleanup(model, settings, today = new Date()) {
  const ref = model.meta?.exportedAt ?? today;
  const maxDays = settings.snapshotDays ?? 3;
  const maxChain = settings.snapshotChain ?? 3;
  const minFree = settings.datastoreFreePct ?? 10;
  const minGainMiB = (settings.thinMinGiB ?? 10) * 1024;
  const pve = model.kind === 'proxmox';

  const vms = model.vms.filter((vm) => !vm.srmPlaceholder);
  const off = vms.filter((vm) => vm.power === 'off' && !vm.template);
  const templates = vms.filter((vm) => vm.template);
  const parked = new Set([...off, ...templates]);
  const items = [];
  const add = (item) => {
    if (item.entries.length) items.push({ ...item, sizeMiB: sum(item.entries.map((e) => e.sizeMiB)) });
  };

  add({
    id: 'consolidation',
    level: 'block',
    title: 'Konsolidierung nötig',
    why: 'vCenter meldet übrig gebliebene Snapshot-Dateien, auf denen die VM weiterläuft. Sie wachsen mit jeder Änderung.',
    fix: 'In vCenter „Snapshots → Konsolidieren“ ausführen, am besten außerhalb der Arbeitszeit.',
    entries: vms.filter((vm) => vm.consolidationNeeded).map((vm) => ({ kind: 'vm', name: vm.name, detail: '', sizeMiB: null })),
  });

  add({
    id: 'datastore-full',
    level: 'block',
    title: pve ? 'Speicher fast voll' : 'Datastore fast voll',
    why: `Weniger als ${minFree} % frei. Wachsende Snapshots können den Datastore füllen; dann halten die VMs darauf an.`,
    fix: 'Zuerst hier aufräumen (Snapshots, verwaiste Dateien), danach Speicher erweitern oder VMs verschieben.',
    entries: model.datastores
      .filter((d) => d.capacityMiB > 0 && ((d.capacityMiB - d.inUseMiB) / d.capacityMiB) * 100 < minFree)
      .map((d) => {
        const free = Math.max(0, d.capacityMiB - d.inUseMiB);
        return { kind: 'datastore', name: d.name, detail: `${Math.floor((free / d.capacityMiB) * 100)} % frei`, sizeMiB: free };
      }),
    sizeLabel: 'frei',
  });

  const oldSnapshots = [];
  for (const vm of vms) {
    const old = vm.snapshots.filter((s) => s.created && ageDays(s.created, ref) > maxDays);
    if (!old.length) continue;
    const oldest = Math.max(...old.map((s) => ageDays(s.created, ref)));
    oldSnapshots.push({
      kind: 'vm',
      name: vm.name,
      detail: `${snapshotsWord(old.length)}, ältester ${oldest} Tage`,
      sizeMiB: knownSum(old.map((s) => s.sizeMiB)),
      parked: parked.has(vm),
    });
  }
  add({
    id: 'old-snapshots',
    level: 'effort',
    title: `Snapshots älter als ${maxDays} Tage`,
    why: pve
      ? 'Snapshots wachsen mit jeder Änderung und bremsen die VM. Die Größe liefert die Proxmox-API nicht. Als Richtwert gilt die Broadcom-Empfehlung für VMware: höchstens 72 Stunden.'
      : 'Broadcom empfiehlt, einen Snapshot höchstens 72 Stunden zu behalten. Snapshot-Dateien wachsen mit jeder Änderung und bremsen die VM.',
    fix: pve
      ? 'Mit den Verantwortlichen klären und unter „Snapshots“ der VM löschen.'
      : 'Mit den Verantwortlichen klären und löschen. Beim Löschen schreibt vSphere den Inhalt in die Disk zurück; das dauert bei großen Snapshots.',
    entries: oldSnapshots.sort((a, b) => b.sizeMiB - a.sizeMiB),
  });

  add({
    id: 'snapshot-chain',
    level: 'effort',
    title: `Mehr als ${maxChain} Snapshots je VM`,
    why: 'Broadcom empfiehlt höchstens 2 bis 3 Snapshots je VM. Jede weitere Ebene macht Lesen und Schreiben langsamer.',
    fix: 'Nicht mehr gebrauchte Zwischenstände löschen.',
    entries: vms
      .filter((vm) => vm.snapshots.length > maxChain)
      .map((vm) => ({ kind: 'vm', name: vm.name, detail: snapshotsWord(vm.snapshots.length), sizeMiB: null })),
  });

  add({
    id: 'zombie-files',
    level: 'effort',
    title: 'Möglicherweise verwaiste Dateien',
    why: 'RVTools hat Dateien gefunden, die zu keiner registrierten VM gehören. Ihre Größe steht nicht im Export.',
    fix: 'Im Datastore-Browser prüfen, ob eine VM, Backup- oder Replikationssoftware die Datei noch nutzt. Erst dann löschen.',
    entries: (model.health ?? [])
      .filter((h) => /zombie/i.test(h.message) || /zombie/i.test(h.type))
      .map((h) => ({ kind: 'file', name: h.name, detail: h.datastore, sizeMiB: null })),
  });

  // Thick-Disks: belegen ihre volle Größe. Der Gewinn ist der freie Platz im Gast, anteilig auf die Thick-Disks gerechnet.
  const thick = [];
  for (const vm of vms) {
    const disks = (vm.disks ?? []).filter((d) => !d.raw);
    const thickDisks = disks.filter((d) => d.thin === false);
    const partitions = vm.partitions ?? [];
    if (!thickDisks.length || !partitions.length) continue;
    const thickMiB = sum(thickDisks.map((d) => d.capacityMiB));
    const freeMiB = sum(partitions.map((p) => p.freeMiB));
    const share = thickMiB / Math.max(1, sum(disks.map((d) => d.capacityMiB)));
    const gain = Math.min(thickMiB, freeMiB * share);
    if (gain < minGainMiB) continue;
    thick.push({
      kind: 'vm',
      name: vm.name,
      detail: `${thickDisks.length === 1 ? '1 Thick-Disk' : `${thickDisks.length} Thick-Disks`} mit ${gib(thickMiB)}, im Gast ${gib(freeMiB)} frei`,
      sizeMiB: gain,
      parked: parked.has(vm),
    });
  }
  add({
    id: 'thick-disks',
    level: 'effort',
    title: 'Thick-Disks mit viel freiem Platz',
    why: 'Thick-Disks belegen im Datastore ihre volle Größe, auch wenn im Gast viel frei ist. Der Gewinn ist geschätzt aus dem freien Platz der Partitionen. Arbeitet das Speichersystem selbst mit Thin Provisioning, wird vor allem im Datastore Platz frei, nicht unbedingt im Array.',
    fix: 'Per Storage vMotion mit dem Disk-Format „Thin Provision“ verschieben. Danach den Füllstand der Datastores überwachen, weil Thin-Disks bis zur vollen Größe wachsen können.',
    entries: thick.sort((a, b) => b.sizeMiB - a.sizeMiB),
    sizeLabel: 'gewinn',
  });

  add({
    id: 'powered-off',
    level: 'note',
    title: 'Ausgeschaltete VMs',
    why: 'Sie belegen Speicher, auch wenn sie nicht laufen. Seit wann sie aus sind, steht nicht im Export.',
    fix: 'Verantwortliche fragen; nicht mehr gebrauchte VMs sichern, archivieren und dann löschen.',
    entries: off
      .map((vm) => ({ kind: 'vm', name: vm.name, detail: vm.os.name || '', sizeMiB: vm.inUseMiB }))
      .sort((a, b) => b.sizeMiB - a.sizeMiB),
  });

  add({
    id: 'templates',
    level: 'note',
    title: 'Vorlagen',
    why: 'Alte Vorlagen belegen Speicher und enthalten oft ungepatchte Systeme.',
    fix: 'Nicht mehr genutzte Vorlagen löschen, genutzte aktualisieren.',
    entries: templates
      .map((vm) => ({ kind: 'vm', name: vm.name, detail: vm.os.name || '', sizeMiB: vm.inUseMiB }))
      .sort((a, b) => b.sizeMiB - a.sizeMiB),
  });

  add({
    id: 'empty-datastore',
    level: 'note',
    title: pve ? 'Speicher ohne VMs' : 'Datastores ohne VMs',
    why: 'Laut Export ist dort keine VM registriert. Belegt ist er trotzdem, etwa durch ISO-Dateien, Vorlagen-Reste oder verwaiste Dateien.',
    fix: 'Inhalt im Datastore-Browser prüfen; wird er nicht mehr gebraucht, aushängen und den Speicher zurückgeben.',
    entries: model.datastores
      .filter((d) => d.vmCount === 0 && d.capacityMiB > 0)
      .map((d) => ({ kind: 'datastore', name: d.name, detail: `${gib(d.capacityMiB)} groß`, sizeMiB: d.inUseMiB })),
  });

  add({
    id: 'iso',
    level: 'note',
    title: 'Eingelegte ISO-Abbilder',
    why: pve
      ? 'Ein eingelegtes Abbild hält die ISO-Datei fest. Liegt sie auf lokalem Speicher, verhindert sie die Migration auf einen anderen Knoten.'
      : 'Ein eingelegtes Abbild hält die ISO-Datei fest. Liegt sie auf lokalem Speicher, verhindert sie vMotion.',
    fix: 'Abbild auswerfen, wenn es nicht gebraucht wird.',
    entries: vms
      .filter((vm) => connectedIsos(vm).length)
      .map((vm) => ({ kind: 'vm', name: vm.name, detail: '', sizeMiB: null })),
  });

  items.sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  // Belegter Speicher je Art; Snapshots ausgeschalteter VMs und Vorlagen stecken schon in deren Größe
  const snapshotsMiB = sum(oldSnapshots.map((e) => e.sizeMiB));
  const offMiB = sum(off.map((vm) => vm.inUseMiB));
  const templateMiB = sum(templates.map((vm) => vm.inUseMiB));
  const thinMiB = sum(thick.map((e) => e.sizeMiB));
  const active = (list) => sum(list.filter((e) => !e.parked).map((e) => e.sizeMiB));
  const totals = {
    snapshotsMiB,
    offMiB,
    templateMiB,
    thinMiB,
    totalMiB: active(oldSnapshots) + active(thick) + offMiB + templateMiB,
    parts: [
      { label: 'alte Snapshots', mib: snapshotsMiB },
      { label: 'ausgeschaltete VMs', mib: offMiB },
      { label: 'Vorlagen', mib: templateMiB },
      { label: 'Thick-Disks (Gewinn geschätzt)', mib: thinMiB },
    ],
    zombieFiles: items.find((i) => i.id === 'zombie-files')?.entries.length ?? 0,
    findings: sum(items.map((i) => i.entries.length)),
    healthKnown: Array.isArray(model.health) && !model.gaps?.some((g) => g.sheet === 'vHealth'),
    reference: ref,
  };
  return { items, totals };
}
