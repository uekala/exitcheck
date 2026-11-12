import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { analyse, modelFromExports, readExports } from '../src/analyse.js';
import { checkCleanup, CLEANUP_LEVELS } from '../src/cleanup.js';
import { defaultSettings } from '../src/costs.js';

const TODAY = new Date('2026-10-28T00:00:00Z');
const GiB = 1024;

function file(path) {
  const buf = readFileSync(new URL(path, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function example(settings = {}) {
  const { exports } = await readExports([{ name: 'beispiel.xlsx', buffer: file('./fixtures/beispiel.xlsx') }]);
  const model = modelFromExports(exports);
  return { model, cleanup: analyse(model, { ...defaultSettings(), ...settings }, TODAY).cleanup };
}

const item = (cleanup, id) => cleanup.items.find((i) => i.id === id);
const names = (cleanup, id) => item(cleanup, id)?.entries.map((e) => e.name) ?? [];

function vm(name, extra = {}) {
  return {
    name,
    power: 'on',
    template: false,
    srmPlaceholder: false,
    consolidationNeeded: false,
    inUseMiB: 10 * GiB,
    os: { name: 'Ubuntu Linux' },
    snapshots: [],
    cds: [],
    ...extra,
  };
}

const daysBefore = (ref, days) => new Date(ref.getTime() - days * 86400000);

test('Aufräumen: Fundstellen im Beispiel, schwerste zuerst', async () => {
  const { model, cleanup } = await example();
  assert.equal(model.health.length, 3);
  assert.deepEqual(cleanup.items.map((i) => i.id), [
    'consolidation', 'datastore-full', 'old-snapshots', 'snapshot-chain', 'zombie-files', 'thick-disks', 'powered-off', 'templates',
    'empty-datastore', 'iso',
  ]);
  assert.deepEqual(names(cleanup, 'thick-disks'), ['file01', 'erp01']);
  assert.match(item(cleanup, 'thick-disks').entries[0].detail, /^1 Thick-Disk mit 2\.048 GiB, im Gast [\d.]+ GiB frei$/);
  assert.deepEqual(names(cleanup, 'empty-datastore'), ['SAN-ALT']);
  assert.equal(item(cleanup, 'empty-datastore').entries[0].sizeMiB, 600 * GiB);
  assert.deepEqual(names(cleanup, 'consolidation'), ['file01']);
  assert.deepEqual(names(cleanup, 'datastore-full'), ['NFS+Archiv']);
  assert.equal(item(cleanup, 'datastore-full').entries[0].detail, '7 % frei');
  assert.deepEqual(names(cleanup, 'old-snapshots'), ['file01', 'mail01']);
  assert.equal(item(cleanup, 'old-snapshots').entries[1].detail, '3 Snapshots, ältester 12 Tage');
  assert.deepEqual(names(cleanup, 'snapshot-chain'), ['mail01']);
  assert.deepEqual(names(cleanup, 'zombie-files'), ['[SAN-02] alt-crm/alt-crm.vmdk', '[SAN-01] test-migration/test-migration_1.vmdk']);
  assert.equal(item(cleanup, 'zombie-files').entries[0].detail, 'SAN-02');
  assert.deepEqual(names(cleanup, 'powered-off'), ['app-alt', 'verwaist01']);
  assert.deepEqual(names(cleanup, 'templates'), ['tpl-w2022', 'tpl-ubuntu']);
  assert.deepEqual(names(cleanup, 'iso'), ['client-test']);
  for (const i of cleanup.items) assert.ok(CLEANUP_LEVELS[i.level], `Stufe ${i.level} ohne Bezeichnung`);
});

test('Aufräumen: Alter zählt ab dem Export, Speicher je Art', async () => {
  const { cleanup } = await example();
  const t = cleanup.totals;
  assert.equal(t.reference.toISOString(), '2026-10-20T09:30:00.000Z');
  // file01: 400 Tage (20 GiB); mail01: 12, 9 und 5 Tage (je 2 GiB); 3 und 2 Tage sind nicht alt
  assert.equal(t.snapshotsMiB, 26 * GiB);
  assert.equal(t.templateMiB, 24 * GiB);
  assert.equal(t.totalMiB, t.snapshotsMiB + t.offMiB + t.templateMiB + t.thinMiB);
  assert.deepEqual(t.parts.map((p) => p.label), ['alte Snapshots', 'ausgeschaltete VMs', 'Vorlagen', 'Thick-Disks (Gewinn geschätzt)']);
  assert.equal(t.zombieFiles, 2);
  assert.equal(t.findings, 15);
  assert.equal(t.healthKnown, true);
});

test('Aufräumen: Schwellen lassen sich ändern', async () => {
  const { cleanup: strict } = await example({ snapshotDays: 0, snapshotChain: 1, datastoreFreePct: 50 });
  assert.equal(strict.totals.snapshotsMiB, (20 + 2 + 4 * 2) * GiB);
  assert.deepEqual(names(strict, 'snapshot-chain'), ['file01', 'mail01']);
  assert.ok(names(strict, 'datastore-full').length > 1);

  const { cleanup: loose } = await example({ snapshotDays: 500, snapshotChain: 10, datastoreFreePct: 5 });
  assert.equal(item(loose, 'old-snapshots'), undefined);
  assert.equal(item(loose, 'snapshot-chain'), undefined);
  assert.equal(item(loose, 'datastore-full'), undefined);
  assert.equal(loose.totals.snapshotsMiB, 0);
});

test('Aufräumen: Vorlagen und ausgeschaltete VMs werden nicht doppelt gezählt', () => {
  const ref = new Date('2026-11-01T00:00:00Z');
  const model = {
    meta: { exportedAt: ref },
    gaps: [],
    datastores: [{ name: 'leer', capacityMiB: 0, inUseMiB: 0 }],
    health: [
      { name: '[DS1] a/a.vmdk', message: 'Possibly a Zombie vmdk file! Please check.', type: '', datastore: 'DS1' },
      { name: '[DS1] b/b.vmdk', message: 'Datei prüfen', type: 'Zombie', datastore: 'DS1' },
      { name: 'esx1', message: 'No NTP servers configured.', type: 'NTP', datastore: '' },
    ],
    vms: [
      vm('tpl', { template: true, power: 'off', inUseMiB: 30 * GiB, snapshots: [{ created: daysBefore(ref, 40), sizeMiB: 5 * GiB }] }),
      vm('aus', { power: 'off', inUseMiB: 20 * GiB, snapshots: [{ created: daysBefore(ref, 10), sizeMiB: 4 * GiB }] }),
      vm('an', { snapshots: [{ created: daysBefore(ref, 10), sizeMiB: 3 * GiB }, { created: null, sizeMiB: 1 * GiB }] }),
      vm('srm', { srmPlaceholder: true, power: 'off', consolidationNeeded: true }),
      vm('cd-host', { cds: [{ connected: true, startsConnected: true, type: 'Host Device' }] }),
      vm('cd-iso', { cds: [{ connected: false, startsConnected: true, type: 'ISO image' }] }),
    ],
  };
  const { items, totals } = checkCleanup(model, { snapshotDays: 3, snapshotChain: 3, datastoreFreePct: 10 }, new Date('2030-01-01'));
  assert.equal(totals.snapshotsMiB, 12 * GiB, 'Snapshot ohne Datum zählt nicht als alt');
  assert.equal(totals.offMiB, 20 * GiB, 'SRM-Platzhalter und Vorlagen zählen nicht als ausgeschaltet');
  assert.equal(totals.templateMiB, 30 * GiB);
  assert.equal(totals.totalMiB, (3 + 20 + 30) * GiB, 'Snapshots von Vorlagen und ausgeschalteten VMs stecken schon in deren Größe');
  assert.equal(items.find((i) => i.id === 'consolidation'), undefined);
  assert.equal(items.find((i) => i.id === 'datastore-full'), undefined, 'Datastore ohne Größe wird übersprungen');
  assert.deepEqual(items.find((i) => i.id === 'iso').entries.map((e) => e.name), ['cd-iso']);
  assert.equal(items.find((i) => i.id === 'zombie-files').entries.length, 2);
});

test('Aufräumen: Thick-Disks nur mit bekanntem freiem Platz, anteilig und ab Mindestgewinn', () => {
  const ref = new Date('2026-11-01T00:00:00Z');
  const disk = (capacityGiB, thin, raw = false) => ({ capacityMiB: capacityGiB * GiB, thin, raw });
  const part = (freeGiB) => ({ capacityMiB: 0, freeMiB: freeGiB * GiB });
  const model = {
    meta: { exportedAt: ref },
    gaps: [],
    datastores: [{ name: 'ds', capacityMiB: 100 * GiB, inUseMiB: 10 * GiB, vmCount: 3 }],
    vms: [
      // Halb Thick, halb Thin: vom freien Platz zählt die Hälfte
      vm('gemischt', { disks: [disk(100, false), disk(100, true)], partitions: [part(80), part(40)] }),
      // Ohne Partitionen (keine VMware Tools) lässt sich nichts schätzen
      vm('ohne-tools', { disks: [disk(500, false)], partitions: [] }),
      // Unter dem Mindestgewinn von 10 GiB
      vm('klein', { disks: [disk(40, false)], partitions: [part(8)] }),
      // RDMs zählen nicht
      vm('rdm', { disks: [disk(500, false, true)], partitions: [part(400)] }),
      // Thin ist schon gut
      vm('thin', { disks: [disk(500, true)], partitions: [part(400)] }),
      // Mehr frei als die Disk groß ist (mehrere Partitionen gezählt): höchstens die Disk-Größe
      vm('voll', { disks: [disk(50, false)], partitions: [part(60)] }),
    ],
  };
  const { items, totals } = checkCleanup(model, {}, ref);
  const thick = items.find((i) => i.id === 'thick-disks');
  assert.deepEqual(thick.entries.map((e) => [e.name, e.sizeMiB / GiB]), [['gemischt', 60], ['voll', 50]]);
  assert.equal(totals.thinMiB, 110 * GiB);
  assert.equal(items.find((i) => i.id === 'empty-datastore'), undefined);
  const { items: strict } = checkCleanup(model, { thinMinGiB: 5 }, ref);
  assert.ok(strict.find((i) => i.id === 'thick-disks').entries.some((e) => e.name === 'klein'));
});

test('Aufräumen: ohne Exportdatum zählt heute, ohne vHealth keine verwaisten Dateien', async () => {
  const today = new Date('2026-11-10T00:00:00Z');
  const model = {
    meta: {},
    gaps: [{ sheet: 'vHealth' }],
    datastores: [],
    vms: [vm('a', { snapshots: [{ created: daysBefore(today, 4), sizeMiB: GiB }] })],
  };
  const { items, totals } = checkCleanup(model, {}, today);
  assert.equal(totals.reference, today);
  assert.equal(totals.snapshotsMiB, GiB, 'Vorgabe: älter als 3 Tage');
  assert.equal(totals.healthKnown, false);
  assert.equal(totals.zombieFiles, 0);
  assert.deepEqual(items.map((i) => i.id), ['old-snapshots']);

  const empty = checkCleanup({ meta: {}, gaps: [], datastores: [], health: [], vms: [] }, {}, today);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totals.totalMiB, 0);
});

test('Aufräumen: CSV-Export ohne vHealth meldet die Lücke', async () => {
  const dir = new URL('./fixtures/csv/', import.meta.url);
  const files = readdirSync(dir).map((name) => ({ name, buffer: file(`./fixtures/csv/${name}`) }));
  const { exports } = await readExports(files);
  const model = modelFromExports(exports);
  assert.ok(model.gaps.some((g) => g.sheet === 'vHealth'));
  assert.ok(model.gaps.some((g) => g.sheet === 'vCD'));
  const { cleanup } = { cleanup: analyse(model, defaultSettings(), TODAY).cleanup };
  assert.equal(cleanup.totals.healthKnown, false);
  assert.deepEqual(names(cleanup, 'consolidation'), ['file01']);
});
