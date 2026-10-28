// Stolpersteine pro VM. Jeder Befund hat eine Stufe:
//   block  – vor dem Umzug klären, so geht es nicht
//   effort – geht, macht aber Mehrarbeit
//   note   – beachten
// Grundlage sind vor allem die Hinweise im Proxmox-Wiki "Migrate to Proxmox VE".

import { eolStatus } from './os.js';

export const TARGETS = {
  proxmox: 'Proxmox VE',
  hyperv: 'Hyper-V',
};

export const LEVELS = {
  block: 'Vorher klären',
  effort: 'Mehraufwand',
  note: 'Hinweis',
};

const APPLIANCE_NAME = /\b(vcsa|vcenter|nsx(-?manager)?|vrops|vrli|vrealize|aria-?ops)\b/i;

function fmtDate(d) {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/** Warum eine VM gar nicht umzieht (Vorlage, Platzhalter, VMware-Appliance) – sonst null. */
export function skipReason(vm) {
  if (vm.srmPlaceholder) return 'SRM-Platzhalter – keine eigenständige VM';
  if (vm.os.appliance || (vm.os.family !== 'windows' && APPLIANCE_NAME.test(vm.name))) {
    return 'VMware-Appliance – entfällt mit dem Umzug';
  }
  if (vm.template) return 'Vorlage – im Ziel neu anlegen';
  return null;
}

/**
 * Prüft eine VM für ein Ziel.
 * ctx: { datastoreTypes: Map<name, type>, today: Date, vtpmKnown: bool, encryptionKnown: bool }
 */
export function checkVm(vm, target, ctx) {
  const findings = [];
  const add = (id, level, title, detail, fix) => findings.push({ id, level, title, detail, fix });
  const proxmox = target === 'proxmox';

  if (vm.encrypted === true) {
    add('encrypted', 'block', 'Verschlüsselte VM',
      'Verschlüsselte Datenträger lassen sich nicht übernehmen.',
      'Verschlüsselung (Speicherrichtlinie) vor dem Umzug entfernen und im Ziel neu einrichten.');
  }

  if (vm.ft) {
    add('ft', 'block', 'Fault Tolerance aktiv',
      `FT-Status „${vm.ft}“. Eine Entsprechung zu VMware Fault Tolerance gibt es im Ziel nicht.`,
      'FT abschalten und die Verfügbarkeit im Ziel über Hochverfügbarkeit (HA) oder Replikation planen.');
  }

  for (const disk of vm.disks) {
    if (!disk.raw) continue;
    if (/physical/i.test(disk.rawMode)) {
      add('rdm-physical', 'block', 'Raw Device Mapping (physisch)',
        `${disk.label || 'Eine Disk'} greift direkt auf eine LUN zu.`,
        'LUN im Ziel direkt anbinden (z. B. per iSCSI im Gast) oder die Daten auf eine virtuelle Disk umziehen.');
    } else {
      add('rdm-virtual', 'effort', 'Raw Device Mapping (virtuell)',
        `${disk.label || 'Eine Disk'} ist ein RDM im virtuellen Modus.`,
        'Vor dem Umzug per Storage vMotion in eine virtuelle Disk umwandeln.');
    }
  }

  const shared = vm.disks.filter((d) => /multiwriter/i.test(d.sharing) || /^(physical|virtual)sharing$/i.test(d.sharedBus));
  if (shared.length) {
    add('shared-disk', 'block', 'Gemeinsam genutzte Disk',
      'Mehrere VMs greifen gleichzeitig auf dieselbe Disk zu (z. B. Windows-Failovercluster oder Oracle RAC).',
      proxmox
        ? 'Clusteraufbau für Proxmox neu planen, z. B. mit gemeinsamem Speicher per iSCSI direkt im Gast.'
        : 'Clusteraufbau für Hyper-V neu planen, z. B. mit gemeinsam genutzten VHDX-Dateien (VHD Set).');
  }

  if (vm.snapshots.length) {
    const oldest = vm.snapshots.map((s) => s.created).filter(Boolean).sort((a, b) => a - b)[0];
    const age = oldest ? Math.floor((ctx.today - oldest) / 86400000) : null;
    add('snapshots', 'effort', vm.snapshots.length === 1 ? '1 Snapshot' : `${vm.snapshots.length} Snapshots`,
      `${age !== null ? `Ältester Snapshot ${age} Tage alt. ` : ''}Snapshots verlangsamen den Import deutlich.`,
      'Snapshots vor dem Umzug löschen (konsolidieren).');
  } else if (vm.consolidationNeeded) {
    add('consolidation', 'effort', 'Konsolidierung nötig',
      'vCenter meldet, dass die Disks konsolidiert werden müssen.',
      'Vor dem Umzug in vCenter konsolidieren.');
  }

  if (proxmox) {
    const stores = new Set([vm.datastore, ...vm.disks.map((d) => d.datastore)].filter(Boolean));
    const vsan = [...stores].filter((s) => /vsan/i.test(ctx.datastoreTypes.get(s) || ''));
    if (vsan.length) {
      add('vsan', 'effort', 'Disks auf vSAN',
        'Der Proxmox-Import kann Disks auf vSAN nicht lesen.',
        'Disks vorher per Storage vMotion auf einen VMFS- oder NFS-Datastore verschieben.');
    }
    const odd = [...stores].filter((s) => /[^\w .()-]/.test(s));
    if (odd.length) {
      add('datastore-name', 'note', 'Sonderzeichen im Datastore-Namen',
        `„${odd[0]}“ enthält Sonderzeichen – daran kann der Proxmox-Import scheitern.`,
        'Datastore vor dem Umzug umbenennen.');
    }
  }

  if (vm.vTpm === true) {
    add('vtpm', 'effort', 'Virtuelles TPM',
      'Der TPM-Inhalt wird nicht übernommen. Ist BitLocker o. Ä. aktiv, fragt das System danach den Wiederherstellungsschlüssel ab.',
      'Wiederherstellungsschlüssel sichern bzw. BitLocker vorher aussetzen und im Ziel ein neues TPM anlegen.');
  } else if (vm.vTpm === null && !ctx.vtpmKnown && /windows (11|server 2025)/i.test(vm.os.name)) {
    add('vtpm-likely', 'note', 'Vermutlich virtuelles TPM',
      `${vm.os.name} setzt meist ein TPM voraus; der Export sagt dazu nichts.`,
      'Prüfen, ob ein vTPM und BitLocker aktiv sind, und den Wiederherstellungsschlüssel bereithalten.');
  }

  if (vm.os.family === 'windows') {
    // Normale Vorarbeit für jedes Windows – steckt im Grundaufwand, darum nur ein Hinweis
    add('windows', 'note', 'Windows: Treiber umstellen',
      proxmox
        ? 'VMware Tools vorher entfernen und VirtIO-Treiber installieren. Die Boot-Disk startet ohne Vorarbeit nur als SATA. Feste IP-Adressen müssen neu gesetzt werden.'
        : 'VMware Tools vorher entfernen; die Disks werden nach VHDX umgewandelt. Feste IP-Adressen müssen neu gesetzt werden.',
      proxmox
        ? 'Treiber vorab installieren, nach dem Umzug auf VirtIO SCSI umstellen und Netzwerk prüfen.'
        : 'Nach dem Umzug Integrationsdienste und Netzwerk prüfen.');
    if (proxmox && vm.os.oldWindows) {
      add('old-windows', 'effort', 'Älteres Windows',
        'Aktuelle VirtIO-Treiber unterstützen diese Windows-Version nicht mehr.',
        'Eine ältere VirtIO-Treiberversion verwenden oder bei emulierten Geräten (SATA, e1000) bleiben.');
    }
  } else if (vm.os.family === 'linux') {
    add('linux', 'note', 'Linux: Netzwerk prüfen',
      proxmox
        ? 'Der Name der Netzwerkkarte ändert sich meist (z. B. ens192 → ens18). Ältere Systeme brauchen die VirtIO-Treiber im initramfs.'
        : 'Der Name der Netzwerkkarte ändert sich meist. Aktuelle Kernel bringen die Hyper-V-Treiber mit.',
      'Netzwerkkonfiguration nach dem Umzug anpassen.');
  }

  if (vm.firmware === 'efi') {
    const secure = vm.secureBoot === true;
    add('efi', 'note', proxmox ? 'UEFI-Start' : 'UEFI-Start (Generation 2)',
      proxmox
        ? `Im Ziel OVMF mit EFI-Disk verwenden; manche Linux-Systeme brauchen einen manuell angelegten Booteintrag.${secure ? ' Secure Boot ist aktiv.' : ''}`
        : `Wird eine VM der Generation 2.${secure && vm.os.family === 'linux' ? ' Für Linux mit Secure Boot die Vorlage „Microsoft UEFI Certificate Authority“ wählen.' : ''}`,
      proxmox
        ? 'OVMF mit EFI-Disk wählen; bei aktivem Secure Boot die vorinstallierten Schlüssel aktivieren.'
        : 'Als VM der Generation 2 anlegen und Secure-Boot-Vorlage passend wählen.');
  } else if (vm.firmware === 'bios' && !proxmox) {
    add('bios', 'note', 'BIOS-Start (Generation 1)',
      'Wird eine VM der Generation 1 – oder vorher auf UEFI umgestellt.',
      'Generation 1 genügt meist; für Generation 2 den Startmodus vorher umstellen.');
  }

  if (vm.usb.length) {
    add('usb', proxmox ? 'effort' : 'block', 'USB-Gerät durchgereicht',
      proxmox
        ? `${vm.usb.length} USB-Gerät(e), oft Lizenzdongles. Die Durchreichung bindet die VM an einen Host.`
        : `${vm.usb.length} USB-Gerät(e), oft Lizenzdongles. Hyper-V kann USB-Geräte nicht an VMs durchreichen.`,
      proxmox
        ? 'USB-Durchreichung neu einrichten oder einen USB-Server im Netz verwenden.'
        : 'Einen USB-Server im Netz (USB over IP) einplanen.');
  }

  if (vm.nics.some((n) => n.directPath || /sriov/i.test(n.adapter))) {
    add('passthrough', 'block', 'Durchgereichte Netzwerkkarte',
      'Die VM nutzt DirectPath I/O oder SR-IOV.',
      'Durchreichung im Ziel neu planen oder auf eine virtuelle Netzwerkkarte umstellen.');
  }

  const cds = vm.cds.filter((c) => c.connected || c.startsConnected);
  if (cds.length) {
    add('cdrom', 'note', 'CD/DVD verbunden',
      cds.some((c) => /host|passthrough|client/i.test(c.type))
        ? 'Ein Laufwerk des Hosts oder Clients ist verbunden.'
        : 'Ein ISO-Abbild ist eingelegt.',
      'Vor dem Umzug trennen.');
  }

  if (/high|hoch/i.test(vm.latency)) {
    add('latency', 'note', 'Latenzempfindlichkeit „hoch“',
      'Die VM ist auf feste CPU-Zuteilung angewiesen.',
      'Im Ziel CPU-Pinning bzw. Reservierungen einplanen.');
  }

  if (vm.connectionState && !/^connected$/i.test(vm.connectionState)) {
    add('connection', 'effort', 'VM nicht erreichbar',
      `Verbindungsstatus „${vm.connectionState}“.`,
      'Vorher in vCenter klären (verwaiste oder nicht zugreifbare VM).');
  }

  const eol = eolStatus(vm.os.eol, ctx.today);
  if (eol) {
    add('eol', 'note', eol.state === 'ended' ? 'Betriebssystem ohne Herstellersupport' : 'Supportende des Betriebssystems naht',
      `${eol.label}: Support ${eol.state === 'ended' ? 'endete' : 'endet'} am ${fmtDate(eol.end)}.`,
      'Den Umzug als Anlass für ein Upgrade nutzen oder die VM bewusst abgeschottet weiterbetreiben.');
  }

  if (vm.power === 'on' && vm.tools && /notinstalled|notrunning/i.test(vm.tools.status)) {
    add('tools', 'note', 'VMware Tools fehlen oder laufen nicht',
      'Gastsystem und IP-Adressen sind deshalb unsicher erkannt.',
      'Gastsystem von Hand prüfen.');
  }

  if (vm.power === 'off') {
    add('powered-off', 'note', 'Ausgeschaltet',
      'Die VM läuft nicht.',
      'Prüfen, ob sie noch gebraucht wird – sonst archivieren statt umziehen.');
  }

  return findings;
}

/** Ampel für eine VM aus ihren Befunden. */
export function verdict(findings) {
  if (findings.some((f) => f.level === 'block')) return 'block';
  if (findings.some((f) => f.level === 'effort')) return 'effort';
  return 'ok';
}
