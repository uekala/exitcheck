// Baut aus den RVTools-Blättern ein einheitliches Modell der Umgebung.

import { bool, datastoreOfPath, date, hasColumn, num, pick, str, toTable } from './values.js';
import { classifyOs } from './os.js';

/** Fügt Blätter mehrerer Exporte (z. B. je vCenter einer) zusammen. */
export function mergeSheets(exports) {
  const tables = {};
  for (const { sheets } of exports) {
    for (const [name, rows] of Object.entries(sheets)) {
      const table = toTable(rows);
      if (!tables[name]) {
        tables[name] = table;
      } else {
        tables[name].rows.push(...table.rows);
        table.keys.forEach((k) => tables[name].keys.add(k));
      }
    }
  }
  return tables;
}

const EMPTY = { headers: [], keys: new Set(), rows: [] };

function vmKeys(row) {
  const vcenter = str(pick(row, 'VI SDK Server'));
  const name = str(pick(row, 'VM', 'Name', 'VM Name'));
  const id = str(pick(row, 'VM ID'));
  const uuid = str(pick(row, 'VM UUID', 'SMBIOS UUID'));
  const keys = [];
  if (id) keys.push(`id|${vcenter}|${id}`);
  if (uuid) keys.push(`uuid|${vcenter}|${uuid}`);
  if (name) keys.push(`name|${vcenter}|${name}`, `name||${name}`);
  return keys;
}

function powerState(value) {
  const s = str(value).toLowerCase();
  if (s.includes('on')) return 'on';
  if (s.includes('suspend')) return 'suspended';
  if (s.includes('off')) return 'off';
  return 'unknown';
}

function parseEsxVersion(text) {
  const m = str(text).match(/ESXi?\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  return m ? { major: +m[1], minor: +m[2], patch: m[3] ? +m[3] : 0 } : null;
}

function buildVm(row, index) {
  const configOs = str(pick(row, 'OS according to the configuration file', 'OS', 'Guest OS'));
  const toolsOs = str(pick(row, 'OS according to the VMware Tools', 'OS according to VMware Tools'));
  const path = str(pick(row, 'Path'));
  const ft = str(pick(row, 'FT State'));
  const firmware = str(pick(row, 'Firmware')).toLowerCase();
  return {
    index,
    keys: vmKeys(row),
    name: str(pick(row, 'VM', 'Name', 'VM Name')) || `VM ${index + 1}`,
    power: powerState(pick(row, 'Powerstate', 'Power State')),
    template: bool(pick(row, 'Template')) === true,
    srmPlaceholder: bool(pick(row, 'SRM Placeholder')) === true,
    connectionState: str(pick(row, 'Connection state')),
    consolidationNeeded: bool(pick(row, 'Consolidation Needed')) === true,
    cpus: num(pick(row, 'CPUs', 'Num CPU')) ?? 0,
    memMiB: num(pick(row, 'Memory', 'Memory MiB', 'Memory MB')) ?? 0,
    provisionedMiB: num(pick(row, 'Provisioned MiB', 'Provisioned MB')) ?? 0,
    inUseMiB: num(pick(row, 'In Use MiB', 'In Use MB')) ?? 0,
    diskCapacityMiB: num(pick(row, 'Total disk capacity MiB', 'Total disk capacity MB')) ?? 0,
    nicCount: num(pick(row, 'NICs')) ?? 0,
    ft: ft && !/notconfigured|not configured/i.test(ft) ? ft : '',
    latency: str(pick(row, 'Latency Sensitivity')),
    firmware: firmware.includes('efi') ? 'efi' : firmware ? 'bios' : '',
    secureBoot: bool(pick(row, 'EFI Secure boot', 'Secure Boot')),
    vTpm: bool(pick(row, 'vTPM', 'Has vTPM', 'TPM')),
    encrypted: bool(pick(row, 'VM Encryption', 'Encryption', 'Encrypted')),
    hwVersion: str(pick(row, 'HW version', 'HW Version')),
    os: classifyOs(configOs, toolsOs),
    path,
    datastore: datastoreOfPath(path),
    datacenter: str(pick(row, 'Datacenter')),
    cluster: str(pick(row, 'Cluster')),
    host: str(pick(row, 'Host')),
    vcenter: str(pick(row, 'VI SDK Server')),
    primaryIp: str(pick(row, 'Primary IP Address')),
    disks: [],
    snapshots: [],
    usb: [],
    cds: [],
    nics: [],
    tools: null,
  };
}

function attach(vms, table, attachRow) {
  const index = new Map();
  for (const vm of vms) for (const key of vm.keys) if (!index.has(key)) index.set(key, vm);
  for (const row of table.rows) {
    const vm = vmKeys(row).map((k) => index.get(k)).find(Boolean);
    if (vm) attachRow(vm, row);
  }
}

function buildHost(row) {
  const sockets = num(pick(row, '# CPU', 'CPU Sockets', 'Sockets')) ?? 0;
  const totalCores = num(pick(row, '# Cores', 'Num CPU Cores', 'Total Cores')) ?? 0;
  const perCpu = num(pick(row, 'Cores per CPU', '# Cores per CPU'))
    ?? (sockets ? Math.round(totalCores / sockets) : 0);
  const esxVersion = str(pick(row, 'ESX Version', 'Version'));
  return {
    name: str(pick(row, 'Host', 'Name')),
    cluster: str(pick(row, 'Cluster')),
    datacenter: str(pick(row, 'Datacenter')),
    vcenter: str(pick(row, 'VI SDK Server')),
    sockets,
    coresPerCpu: perCpu,
    cores: totalCores || sockets * perCpu,
    memMiB: num(pick(row, '# Memory', 'Memory')) ?? 0,
    cpuModel: str(pick(row, 'CPU Model')),
    vendor: str(pick(row, 'Vendor')),
    model: str(pick(row, 'Model')),
    esxVersion,
    esx: parseEsxVersion(esxVersion),
    vmCount: num(pick(row, '# VMs', '# VMs total')) ?? null,
  };
}

/** Prüft, welche für die Analyse wichtigen Blätter und Spalten fehlen. */
function findGaps(tables) {
  const gaps = [];
  const need = [
    ['vInfo', null, 'Ohne das Blatt vInfo ist keine Auswertung möglich.'],
    ['vHost', null, 'Ohne vHost fehlen Kerne und Sockel – der Kostenvergleich ist dann nicht möglich.'],
    ['vDisk', null, 'Raw Device Mappings und gemeinsam genutzte Disks können nicht erkannt werden.'],
    ['vSnapshot', null, 'Snapshots können nicht erkannt werden.'],
    ['vUSB', null, 'Durchgereichte USB-Geräte (z. B. Lizenzdongles) können nicht erkannt werden.'],
    ['vDatastore', null, 'vSAN-Datastores können nicht erkannt werden.'],
    ['vNetwork', null, 'Netzwerke und durchgereichte Netzwerkkarten können nicht erkannt werden.'],
    ['vInfo', ['vTPM', 'Has vTPM', 'TPM'], 'Der Export enthält keine vTPM-Angabe – bei Windows 11 und Server 2025 prüfen, ob ein vTPM und BitLocker im Einsatz sind.'],
    ['vInfo', ['VM Encryption', 'Encryption', 'Encrypted'], 'Der Export enthält keine Angabe zur VM-Verschlüsselung – verschlüsselte VMs bitte von Hand prüfen.'],
  ];
  for (const [sheet, columns, message] of need) {
    const table = tables[sheet];
    if (!table) {
      if (!columns) gaps.push({ sheet, message });
      continue;
    }
    if (columns && !hasColumn(table, ...columns)) gaps.push({ sheet, column: columns[0], message });
  }
  return gaps;
}

export function buildModel(tables) {
  const t = (name) => tables[name] ?? EMPTY;
  const vms = t('vInfo').rows.map(buildVm);

  attach(vms, t('vDisk'), (vm, row) => {
    const diskPath = str(pick(row, 'Disk Path', 'Path'));
    vm.disks.push({
      label: str(pick(row, 'Disk', 'Label')),
      capacityMiB: num(pick(row, 'Capacity MiB', 'Capacity MB')) ?? 0,
      raw: bool(pick(row, 'Raw')) === true,
      rawMode: str(pick(row, 'Raw Comp. Mode', 'Raw Comp Mode', 'Compatibility Mode')),
      mode: str(pick(row, 'Disk Mode')),
      sharing: str(pick(row, 'Sharing mode', 'Sharing', 'Disk Sharing')),
      sharedBus: str(pick(row, 'Shared Bus', 'Bus Sharing')),
      controller: str(pick(row, 'Controller')),
      datastore: datastoreOfPath(diskPath),
      path: diskPath,
    });
  });
  attach(vms, t('vSnapshot'), (vm, row) => {
    vm.snapshots.push({
      name: str(pick(row, 'Name', 'Snapshot')),
      created: date(pick(row, 'Date / time', 'Date / Time', 'Created')),
      sizeMiB: num(pick(row, 'Size MiB (total)', 'Size MiB (vmsn)', 'Size MiB', 'Size MB')) ?? 0,
    });
  });
  attach(vms, t('vUSB'), (vm, row) => {
    const type = str(pick(row, 'Device Type', 'Device', 'Family'));
    if (/controller/i.test(type)) return;
    vm.usb.push({ type, connected: bool(pick(row, 'Connected')) });
  });
  attach(vms, t('vCD'), (vm, row) => {
    vm.cds.push({
      connected: bool(pick(row, 'Connected')) === true,
      startsConnected: bool(pick(row, 'Starts Connected')) === true,
      type: str(pick(row, 'Device Type')),
    });
  });
  attach(vms, t('vNetwork'), (vm, row) => {
    vm.nics.push({
      adapter: str(pick(row, 'Adapter')),
      network: str(pick(row, 'Network', 'Port Group')),
      switch: str(pick(row, 'Switch')),
      directPath: bool(pick(row, 'Direct Path IO', 'DirectPath IO')) === true,
      connected: bool(pick(row, 'Connected')),
    });
  });
  attach(vms, t('vTools'), (vm, row) => {
    vm.tools = {
      status: str(pick(row, 'Tools', 'Tools Status')),
      version: str(pick(row, 'Tools Version')),
    };
  });

  const hosts = t('vHost').rows.map(buildHost).filter((h) => h.name);
  const datastores = t('vDatastore').rows.map((row) => ({
    name: str(pick(row, 'Name')),
    type: str(pick(row, 'Type')),
    capacityMiB: num(pick(row, 'Capacity MiB', 'Capacity MB')) ?? 0,
    inUseMiB: num(pick(row, 'In Use MiB', 'In Use MB')) ?? 0,
    vcenter: str(pick(row, 'VI SDK Server')),
  })).filter((d) => d.name);
  const licenses = t('vLicense').rows.map((row) => ({
    // Lizenzschlüssel werden bewusst nicht übernommen
    name: str(pick(row, 'Name')),
    costUnit: str(pick(row, 'Cost Unit')),
    total: num(pick(row, 'Total')),
    used: num(pick(row, 'Used')),
    expiration: str(pick(row, 'Expiration Date')),
  })).filter((l) => l.name);

  const metaRow = t('vMetaData').rows[0] ?? {};
  const sources = t('vSource').rows.map((row) => ({
    name: str(pick(row, 'Name', 'VI SDK Server')),
    version: str(pick(row, 'Fullname', 'Full Name', 'Version')),
  })).filter((s) => s.name || s.version);

  return {
    vms,
    hosts,
    datastores,
    licenses,
    sources,
    meta: {
      rvtoolsVersion: str(pick(metaRow, 'RVTools version', 'RVTools major version')),
      exportedAt: date(pick(metaRow, 'xlsx creation datetime', 'Creation datetime')),
    },
    gaps: findGaps(tables),
  };
}
