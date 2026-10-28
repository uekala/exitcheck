// Kostenvergleich und Aufwandsschätzung. Alle Preise sind Eingaben mit Vorgabewerten,
// die im Bericht als Annahme ausgewiesen werden.

export const VMWARE_PRODUCTS = {
  vcf: { label: 'VMware Cloud Foundation (VCF)', price: 350 },
  vvf: { label: 'VMware vSphere Foundation (VVF)', price: 135 },
  vvs: { label: 'vSphere Standard', price: 50 },
  custom: { label: 'Eigener Preis', price: null },
};

export const PROXMOX_LEVELS = {
  community: { label: 'Community', price: 120 },
  basic: { label: 'Basic', price: 370 },
  standard: { label: 'Standard', price: 550 },
  premium: { label: 'Premium', price: 1100 },
};

export function defaultSettings() {
  return {
    target: 'proxmox',
    years: 5,
    vmwareProduct: 'vvf',
    vmwarePricePerCore: VMWARE_PRODUCTS.vvf.price,
    vmwareMinOrderCores: 0,
    proxmoxLevel: 'basic',
    proxmoxPricePerSocket: PROXMOX_LEVELS.basic.price,
    // Sind die Hosts schon mit Windows Server lizenziert (wegen Windows-VMs), kostet Hyper-V nichts extra
    hypervHostsLicensed: 'auto',
    // US-Listenpreis Windows Server 2025 Standard: 1.176 $ je 16 Kerne
    hypervPricePerCore: Math.round(1176 / 16),
    rate: 95,
    hoursLinux: 1,
    hoursWindows: 2,
    hoursOther: 2,
    hoursEffort: 1.5,
    hoursBlock: 6,
    includePoweredOff: true,
    projectDays: 3,
    daysPerHost: 0.5,
    throughputMBs: 150,
  };
}

/** Kerne, die Broadcom berechnet: mindestens 16 pro CPU, optional Mindestmenge pro Bestellung. */
export function vmwareLicensedCores(hosts, minOrder = 0) {
  const cores = hosts.reduce((sum, h) => sum + h.sockets * Math.max(16, h.coresPerCpu || 0), 0);
  return Math.max(cores, minOrder || 0);
}

/** Windows-Server-Kernlizenzen: mindestens 8 pro CPU und 16 pro Server. */
export function windowsCoreLicenses(hosts) {
  return hosts.reduce((sum, h) => sum + Math.max(16, h.sockets * Math.max(8, h.coresPerCpu || 0)), 0);
}

export function estimateEffort(vms, hosts, s) {
  let baseHours = 0;
  let effortHours = 0;
  let blockHours = 0;
  let movedVms = 0;
  let inUseMiB = 0;
  const families = { windows: 0, linux: 0, other: 0 };
  for (const vm of vms) {
    if (vm.skip) continue;
    if (vm.power === 'off' && !s.includePoweredOff) continue;
    movedVms++;
    inUseMiB += vm.inUseMiB || 0;
    const family = vm.os.family === 'windows' || vm.os.family === 'linux' ? vm.os.family : 'other';
    families[family]++;
    baseHours += family === 'windows' ? s.hoursWindows : family === 'linux' ? s.hoursLinux : s.hoursOther;
    effortHours += vm.findings.filter((f) => f.level === 'effort').length * s.hoursEffort;
    blockHours += vm.findings.filter((f) => f.level === 'block').length * s.hoursBlock;
  }
  const vmHours = baseHours + effortHours + blockHours;
  const projectHours = (s.projectDays + s.daysPerHost * hosts.length) * 8;
  const hours = vmHours + projectHours;
  const copyHours = s.throughputMBs > 0 ? (inUseMiB * 1.048576) / s.throughputMBs / 3600 : null;
  return {
    movedVms,
    families,
    baseHours,
    effortHours,
    blockHours,
    vmHours,
    projectHours,
    hours,
    days: hours / 8,
    cost: hours * s.rate,
    inUseMiB,
    copyHours,
  };
}

export function compareCosts(model, effort, s) {
  const hosts = model.hosts;
  const licensedCores = vmwareLicensedCores(hosts, s.vmwareMinOrderCores);
  const physicalCores = hosts.reduce((sum, h) => sum + (h.cores || h.sockets * h.coresPerCpu), 0);
  const sockets = hosts.reduce((sum, h) => sum + h.sockets, 0);
  const windowsVms = model.vms.filter((vm) => !vm.skip && vm.os.family === 'windows').length;
  const hostsLicensed = s.hypervHostsLicensed === 'auto' ? windowsVms > 0 : s.hypervHostsLicensed === 'yes';
  const windowsCores = windowsCoreLicenses(hosts);

  const vmwareYear = licensedCores * s.vmwarePricePerCore;
  const proxmoxYear = sockets * s.proxmoxPricePerSocket;
  const hypervOnce = hostsLicensed ? 0 : windowsCores * s.hypervPricePerCore;

  const options = [
    {
      id: 'vmware',
      label: 'VMware bleibt',
      perYear: vmwareYear,
      once: 0,
      total: vmwareYear * s.years,
      basis: `${licensedCores} Kerne × ${s.vmwarePricePerCore} € pro Jahr`,
    },
    {
      id: 'proxmox',
      label: 'Proxmox VE',
      perYear: proxmoxYear,
      once: effort.cost,
      total: effort.cost + proxmoxYear * s.years,
      basis: `${sockets} Sockel × ${s.proxmoxPricePerSocket} € pro Jahr + Umzug`,
    },
    {
      id: 'hyperv',
      label: 'Hyper-V',
      perYear: 0,
      once: effort.cost + hypervOnce,
      total: effort.cost + hypervOnce,
      basis: hostsLicensed
        ? 'Hosts sind schon mit Windows Server lizenziert – nur der Umzug'
        : `${windowsCores} Kernlizenzen Windows Server Standard × ${s.hypervPricePerCore} € einmalig + Umzug`,
    },
  ];
  for (const option of options) option.saving = options[0].total - option.total;
  return {
    licensedCores,
    physicalCores,
    sockets,
    windowsCores,
    windowsVms,
    hostsLicensed,
    options,
  };
}
