import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { analyse, modelFromExports, readExports } from '../src/analyse.js';
import { defaultSettings, vmwareLicensedCores, windowsCoreLicenses } from '../src/costs.js';
import { classifyOs, eolStatus } from '../src/os.js';
import { bool, date, num, toTable, pick } from '../src/values.js';

const TODAY = new Date('2026-10-28T00:00:00Z');

function file(path) {
  const buf = readFileSync(new URL(path, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function example(settings = {}) {
  const { exports } = await readExports([{ name: 'beispiel.xlsx', buffer: file('./fixtures/beispiel.xlsx') }]);
  const model = modelFromExports(exports);
  return { model, result: analyse(model, { ...defaultSettings(), ...settings }, TODAY) };
}

const vm = (result, name) => result.vms.find((v) => v.name === name);
const ids = (v) => v.findings.map((f) => f.id);

test('Werte: Zahlen, Wahrheitswerte, Daten', () => {
  assert.equal(num('1.234,5'), 1234.5);
  assert.equal(num('4096'), 4096);
  assert.equal(num('2,5'), 2.5);
  assert.equal(num('1,234,567'), 1234567);
  assert.equal(num(''), null);
  assert.equal(bool('True'), true);
  assert.equal(bool('False'), false);
  assert.equal(bool('vielleicht'), null);
  assert.equal(date(46000).toISOString().slice(0, 10), '2025-12-09');
  assert.equal(date('2026/10/01 12:30:00').toISOString(), '2026-10-01T12:30:00.000Z');
  assert.equal(date('01.10.2026').toISOString().slice(0, 10), '2026-10-01');
  assert.equal(date('10/1/2026 1:05:00 PM').toISOString(), '2026-10-01T13:05:00.000Z');
});

test('Werte: Spaltenköpfe werden locker verglichen', () => {
  const table = toTable([[], ['VM', 'Total disk capacity MiB', '# CPU'], ['a', 10, 2], []]);
  assert.equal(table.rows.length, 1);
  assert.equal(pick(table.rows[0], 'total disk capacity mib'), 10);
  assert.equal(pick(table.rows[0], 'Fehlt', '# CPU'), 2);
});

test('Betriebssysteme und Supportende', () => {
  const w12 = classifyOs('Microsoft Windows Server 2012 (64-bit)', 'Microsoft Windows Server 2012 R2 Standard (64-bit)');
  assert.equal(w12.family, 'windows');
  assert.equal(w12.oldWindows, true);
  assert.equal(eolStatus(w12.eol, TODAY).state, 'ended');
  const w16 = classifyOs('Microsoft Windows Server 2016 or later (64-bit)', 'Microsoft Windows Server 2016 Standard (64-bit)');
  assert.equal(eolStatus(w16.eol, TODAY).state, 'soon');
  const vague = classifyOs('Microsoft Windows Server 2016 or later (64-bit)', '');
  assert.equal(vague.eol, null);
  assert.equal(classifyOs('VMware Photon OS (64-bit)', '').appliance, true);
  assert.equal(classifyOs('Ubuntu Linux (64-bit)', '').family, 'linux');
  assert.equal(classifyOs('', '').family, 'unknown');
});

test('Modell: Hosts, VMs, Disks und Snapshots werden verknüpft', async () => {
  const { model } = await example();
  assert.equal(model.vms.length, 40);
  assert.equal(model.hosts.length, 5);
  assert.equal(model.meta.rvtoolsVersion, '4.7.1.4');
  assert.equal(model.licenses[0].name, 'VMware vSphere 7 Enterprise Plus');
  assert.ok(!('key' in model.licenses[0]), 'Lizenzschlüssel dürfen nicht übernommen werden');
  const file01 = model.vms.find((v) => v.name === 'file01');
  assert.equal(file01.snapshots.length, 2);
  assert.equal(file01.snapshots[0].created.toISOString().slice(0, 10), '2025-09-15');
  const sql01 = model.vms.find((v) => v.name === 'sql01');
  assert.equal(sql01.disks.length, 2);
  assert.equal(model.hosts[0].coresPerCpu, 12);
  assert.equal(model.hosts[0].esx.major, 7);
});

test('Regeln: Stolpersteine im Beispiel für Proxmox', async () => {
  const { result } = await example();
  assert.deepEqual(result.counts, { ok: 22, effort: 11, block: 4, skip: 3 });
  assert.deepEqual(ids(vm(result, 'sql01')).slice(0, 2), ['rdm-physical', 'shared-disk']);
  assert.equal(vm(result, 'erp01').verdict, 'block');
  assert.ok(ids(vm(result, 'dmz-proxy')).includes('passthrough'));
  assert.ok(ids(vm(result, 'backup01')).includes('rdm-virtual'));
  assert.equal(vm(result, 'backup01').verdict, 'effort');
  assert.ok(ids(vm(result, 'dc02')).includes('vsan'));
  assert.ok(ids(vm(result, 'lic01')).includes('usb'));
  assert.ok(ids(vm(result, 'pki01')).includes('vtpm'));
  assert.ok(ids(vm(result, 'print01')).includes('old-windows'));
  assert.ok(ids(vm(result, 'app-alt')).includes('datastore-name'));
  assert.ok(ids(vm(result, 'client-test')).includes('cdrom'));
  assert.ok(ids(vm(result, 'verwaist01')).includes('connection'));
  assert.equal(vm(result, 'vcsa01').verdict, 'skip');
  assert.equal(vm(result, 'tpl-w2022').verdict, 'skip');
  assert.equal(vm(result, 'web01').verdict, 'ok');
  assert.equal(vm(result, 'dc01').verdict, 'ok');
  assert.equal(result.groups[0].level, 'block');
  assert.equal(result.groups.find((g) => g.id === 'snapshots').title, 'Snapshots vorhanden');
});

test('Regeln: Hyper-V bewertet USB und vSAN anders', async () => {
  const { result } = await example({ target: 'hyperv' });
  assert.equal(vm(result, 'lic01').verdict, 'block');
  assert.ok(!ids(vm(result, 'dc02')).includes('vsan'));
  assert.ok(ids(vm(result, 'dc01')).includes('bios'));
  assert.ok(!result.environment.some((n) => n.title === 'Cluster mit zwei Hosts'));
});

test('Umgebung: Supportende, 16-Kern-Regel, Zwei-Host-Cluster, vSAN', async () => {
  const { result } = await example();
  const titles = result.environment.map((n) => n.title);
  assert.ok(titles.includes('ESXi 7 auf 3 Hosts'));
  assert.equal(result.environment.find((n) => n.title === 'ESXi 7 auf 3 Hosts').level, 'block');
  assert.ok(titles.includes('ESXi 8 auf 2 Hosts'));
  assert.match(result.environment.find((n) => n.title.startsWith('Broadcom')).detail, /24 Kerne mehr/);
  assert.ok(titles.includes('Cluster mit zwei Hosts'));
  assert.ok(titles.includes('vSAN entfällt'));
  assert.ok(titles.includes('4 Netzwerke in Benutzung'));
});

test('Kosten: Kernregeln für Broadcom und Windows Server', () => {
  const hosts = [
    { sockets: 2, coresPerCpu: 12 },
    { sockets: 1, coresPerCpu: 32 },
    { sockets: 1, coresPerCpu: 4 },
  ];
  assert.equal(vmwareLicensedCores(hosts), 32 + 32 + 16);
  assert.equal(vmwareLicensedCores(hosts, 96), 96);
  assert.equal(windowsCoreLicenses(hosts), 24 + 32 + 16);
});

test('Kosten und Aufwand im Beispiel', async () => {
  const { result } = await example();
  const { costs, effort } = result;
  assert.equal(costs.licensedCores, 128);
  assert.equal(costs.physicalCores, 104);
  assert.equal(costs.sockets, 8);
  const [vmware, proxmox, hyperv] = costs.options;
  assert.equal(vmware.perYear, 128 * 135);
  assert.equal(vmware.total, 128 * 135 * 5);
  assert.equal(proxmox.perYear, 8 * 370);
  assert.equal(proxmox.total, effort.cost + 8 * 370 * 5);
  assert.equal(hyperv.once, effort.cost);
  assert.equal(effort.movedVms, 37);
  assert.equal(effort.projectHours, (3 + 0.5 * 5) * 8);
  assert.ok(effort.copyHours > 0);

  const { result: noWindows } = await example({ hypervHostsLicensed: 'no', includePoweredOff: false });
  assert.equal(noWindows.effort.movedVms, 35);
  assert.equal(noWindows.costs.options[2].once, noWindows.effort.cost + 104 * 74);
});

test('CSV-Export ohne vTPM-Spalte meldet die Lücke', async () => {
  const dir = new URL('./fixtures/csv/', import.meta.url);
  const files = readdirSync(dir).map((name) => ({ name, buffer: file(`./fixtures/csv/${name}`) }));
  const { exports, ignored } = await readExports([...files, { name: 'notiz.txt', buffer: new ArrayBuffer(0) }]);
  assert.deepEqual(ignored, ['notiz.txt']);
  const model = modelFromExports(exports);
  assert.equal(model.vms.length, 40);
  assert.ok(model.gaps.some((g) => g.column === 'vTPM'));
  assert.ok(model.gaps.some((g) => g.sheet === 'vSnapshot'));
  const result = analyse(model, defaultSettings(), TODAY);
  assert.ok(ids(vm(result, 'pki01')).includes('vtpm-likely'));
  assert.equal(vm(result, 'sql01').verdict, 'block');
});

test('Ohne vInfo gibt es eine verständliche Fehlermeldung', () => {
  assert.throws(() => modelFromExports([{ fileName: 'x', sheets: { vHost: [['Host']] } }]), /vInfo/);
});
