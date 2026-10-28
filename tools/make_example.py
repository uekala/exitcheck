"""Erzeugt einen erfundenen RVTools-Export (Muster GmbH) für Tests und die Beispielansicht.

Aufruf: python3 tools/make_example.py
Ergebnis: tests/fixtures/beispiel.xlsx und tests/fixtures/csv/*.csv
"""

from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures"
VCENTER = "vcenter.muster.local"
EXPORTED = datetime(2026, 10, 20, 9, 30)

rng = random.Random(42)

HOSTS = [
    # Name, Cluster, Sockel, Kerne pro CPU, RAM GiB, ESXi
    ("esx01.muster.local", "Produktion", 2, 12, 512, "VMware ESXi 7.0.3 build-21424296"),
    ("esx02.muster.local", "Produktion", 2, 12, 512, "VMware ESXi 7.0.3 build-21424296"),
    ("esx03.muster.local", "Produktion", 2, 12, 512, "VMware ESXi 7.0.3 build-21424296"),
    ("esx11.muster.local", "Aussenstelle", 1, 16, 256, "VMware ESXi 8.0.2 build-22380479"),
    ("esx12.muster.local", "Aussenstelle", 1, 16, 256, "VMware ESXi 8.0.2 build-22380479"),
]

DATASTORES = [
    ("SAN-01", "VMFS", 20 * 1024 * 1024),
    ("SAN-02", "VMFS", 20 * 1024 * 1024),
    ("vsanDatastore", "vsan", 12 * 1024 * 1024),
    ("NFS+Archiv", "NFS", 8 * 1024 * 1024),
]

OS = {
    "w2016": ("Microsoft Windows Server 2016 or later (64-bit)", "Microsoft Windows Server 2016 Standard (64-bit)"),
    "w2019": ("Microsoft Windows Server 2016 or later (64-bit)", "Microsoft Windows Server 2019 Standard (64-bit)"),
    "w2022": ("Microsoft Windows Server 2022 (64-bit)", "Microsoft Windows Server 2022 Datacenter (64-bit)"),
    "w2025": ("Microsoft Windows Server 2025 (64-bit)", "Microsoft Windows Server 2025 Datacenter (64-bit)"),
    "w2012": ("Microsoft Windows Server 2012 (64-bit)", "Microsoft Windows Server 2012 R2 Standard (64-bit)"),
    "w10": ("Microsoft Windows 10 (64-bit)", "Microsoft Windows 10 Enterprise (64-bit)"),
    "ubuntu": ("Ubuntu Linux (64-bit)", "Ubuntu 22.04.4 LTS"),
    "debian11": ("Debian GNU/Linux 11 (64-bit)", "Debian GNU/Linux 11 (bullseye)"),
    "centos7": ("CentOS 7 (64-bit)", "CentOS Linux 7 (Core)"),
    "photon": ("VMware Photon OS (64-bit)", "VMware Photon OS 3.0"),
}

# Name, OS, CPUs, RAM GiB, Disk GiB, Cluster, Datastore, Besonderheiten
VMS = [
    ("vcsa01", "photon", 4, 19, 600, "Produktion", "SAN-01", {"appliance": True}),
    ("dc01", "w2022", 2, 8, 100, "Produktion", "SAN-01", {}),
    ("dc02", "w2022", 2, 8, 100, "Aussenstelle", "vsanDatastore", {}),
    ("file01", "w2019", 4, 16, 2048, "Produktion", "SAN-02", {"snapshots": [400, 3]}),
    ("sql01", "w2019", 8, 64, 800, "Produktion", "SAN-01", {"shared": True, "rdm": "physicalMode"}),
    ("sql02", "w2019", 8, 64, 800, "Produktion", "SAN-02", {"shared": True, "rdm": "physicalMode"}),
    ("erp01", "w2016", 8, 48, 600, "Produktion", "SAN-01", {"ft": True}),
    ("lic01", "w2016", 2, 4, 60, "Produktion", "SAN-02", {"usb": 1}),
    ("rdsh01", "w2022", 8, 64, 200, "Produktion", "SAN-01", {}),
    ("rdsh02", "w2022", 8, 64, 200, "Produktion", "SAN-02", {}),
    ("print01", "w2012", 2, 4, 80, "Produktion", "SAN-01", {}),
    ("app-alt", "w2012", 2, 8, 120, "Produktion", "NFS+Archiv", {"power": "poweredOff"}),
    ("web01", "ubuntu", 2, 4, 40, "Produktion", "SAN-01", {}),
    ("web02", "ubuntu", 2, 4, 40, "Produktion", "SAN-02", {}),
    ("mail01", "debian11", 4, 8, 300, "Produktion", "SAN-01", {"snapshots": [12]}),
    ("monitor01", "centos7", 2, 4, 80, "Produktion", "SAN-02", {}),
    ("git01", "ubuntu", 4, 8, 250, "Produktion", "SAN-01", {"efi": True, "secure": True}),
    ("backup01", "w2022", 4, 16, 100, "Produktion", "SAN-02", {"rdm": "virtualMode"}),
    ("pki01", "w2025", 2, 8, 80, "Produktion", "SAN-01", {"efi": True, "secure": True, "vtpm": True}),
    ("dmz-proxy", "debian11", 2, 2, 20, "Produktion", "SAN-02", {"sriov": True}),
    ("client-test", "w10", 2, 8, 80, "Produktion", "SAN-01", {"cdrom": True, "efi": True}),
    ("tpl-w2022", "w2022", 2, 4, 60, "Produktion", "SAN-01", {"template": True, "power": "poweredOff"}),
    ("tpl-ubuntu", "ubuntu", 2, 2, 20, "Produktion", "SAN-02", {"template": True, "power": "poweredOff"}),
    ("srv-as01", "w2019", 4, 16, 200, "Aussenstelle", "vsanDatastore", {}),
    ("srv-as02", "ubuntu", 2, 4, 60, "Aussenstelle", "vsanDatastore", {}),
    ("verwaist01", "w2016", 2, 4, 60, "Produktion", "SAN-02", {"orphaned": True, "power": "poweredOff"}),
]

for i in range(1, 15):
    os_key = rng.choice(["w2019", "w2022", "ubuntu", "debian11", "w2016"])
    VMS.append((f"app{i:02d}", os_key, rng.choice([2, 4, 4, 8]), rng.choice([4, 8, 16]),
                rng.choice([60, 100, 200]), rng.choice(["Produktion", "Produktion", "Aussenstelle"]),
                rng.choice(["SAN-01", "SAN-02"]), {"efi": os_key in ("w2022",)}))

NETWORKS = ["VLAN10-Server", "VLAN20-Clients", "VLAN30-DMZ", "VLAN40-Backup"]


def host_for(cluster: str, n: int) -> str:
    members = [h[0] for h in HOSTS if h[1] == cluster]
    return members[n % len(members)]


def sheet(wb: Workbook, name: str, header: list[str], rows: list[list]) -> None:
    ws = wb.create_sheet(name)
    ws.append(header)
    for row in rows:
        ws.append(row)


def build() -> dict[str, tuple[list[str], list[list]]]:
    data: dict[str, tuple[list[str], list[list]]] = {}

    info_h = [
        "VM", "Powerstate", "Template", "SRM Placeholder", "Config status", "DNS Name",
        "Connection state", "Guest state", "Heartbeat", "Consolidation Needed", "CPUs", "Memory",
        "NICs", "Disks", "Total disk capacity MiB", "Latency Sensitivity", "Primary IP Address",
        "Network #1", "FT State", "FT Role", "Provisioned MiB", "In Use MiB", "Firmware",
        "EFI Secure boot", "HW version", "Path", "Annotation", "Datacenter", "Cluster", "Host",
        "OS according to the configuration file", "OS according to the VMware Tools", "vTPM",
        "VM ID", "VM UUID", "VI SDK Server",
    ]
    rows_info, rows_disk, rows_snap, rows_tools, rows_usb, rows_cd, rows_net = [], [], [], [], [], [], []
    for n, (name, os_key, cpus, ram, disk, cluster, ds, extra) in enumerate(VMS):
        power = extra.get("power", "poweredOn")
        template = extra.get("template", False)
        vm_id = f"vm-{1001 + n}"
        uuid = f"5003{n:04d}-aaaa-bbbb-cccc-{n:012d}"
        conf_os, tools_os = OS[os_key]
        running = power == "poweredOn"
        disk_mib = disk * 1024
        in_use = int(disk_mib * rng.uniform(0.35, 0.8)) if not template else int(disk_mib * 0.3)
        network = NETWORKS[2] if name.startswith("dmz") else NETWORKS[1] if name.startswith("client") else NETWORKS[0]
        rows_info.append([
            name, power, template, False, "green", f"{name}.muster.local" if running else "",
            "orphaned" if extra.get("orphaned") else "connected", "running" if running else "notRunning",
            "green" if running else "gray", False, cpus, ram * 1024, 1 + (1 if name.startswith("backup") else 0),
            2 if extra.get("rdm") else 1, disk_mib, "normal", f"10.0.{10 + n // 50}.{10 + n}" if running else "",
            network, "running" if extra.get("ft") else "notConfigured", "1" if extra.get("ft") else "",
            disk_mib + ram * 1024, in_use, "efi" if extra.get("efi") else "bios", bool(extra.get("secure")),
            "vmx-19" if os_key != "w2012" else "vmx-13", f"[{ds}] {name}/{name}.vmx", "", "RZ-Zentrale" if cluster == "Produktion" else "Aussenstelle",
            cluster, host_for(cluster, n), conf_os, tools_os if running else "", bool(extra.get("vtpm")),
            vm_id, uuid, VCENTER,
        ])
        ident = [vm_id, uuid, VCENTER]
        rows_disk.append([name, power, template, "Hard disk 1", disk_mib, False, "persistent",
                          "sharingNone", True, "SCSI controller 0", "noSharing", "", "", f"[{ds}] {name}/{name}.vmdk", *ident])
        if extra.get("rdm"):
            shared = extra.get("shared", False)
            rows_disk.append([name, power, template, "Hard disk 2", 500 * 1024, True,
                              "independent_persistent", "sharingMultiWriter" if shared else "sharingNone", False,
                              "SCSI controller 1", "physicalSharing" if shared else "noSharing",
                              "naa.600508b1001c" + f"{n:04d}", extra["rdm"], f"[{ds}] {name}/{name}_1.vmdk", *ident])
        for age in extra.get("snapshots", []):
            rows_snap.append([name, power, f"vor Update {age}", "", EXPORTED - timedelta(days=age),
                              f"[{ds}] {name}/{name}-Snapshot1.vmsn", 12, 20480 if age > 100 else 2048, False,
                              "poweredOn", *ident])
        tools_status = "toolsOk" if running else "toolsNotRunning"
        if os_key == "centos7":
            tools_status = "toolsOld"
        rows_tools.append([name, power, template, "vmx-19", tools_status, "12352", "12352", False, "manual", *ident])
        for _ in range(extra.get("usb", 0)):
            rows_usb.append([name, power, template, "USB 1", "USB device", True, "other", "full", True, True, 0, 1, *ident])
        rows_cd.append([name, power, template, "CD/DVD drive 1", bool(extra.get("cdrom")), bool(extra.get("cdrom")),
                        "ISO image" if extra.get("cdrom") else "Client Device", *ident])
        adapter = "Sriov" if extra.get("sriov") else ("E1000e" if os_key == "w2012" else "Vmxnet3")
        rows_net.append([name, power, template, "Network adapter 1", adapter, network, "dvSwitch-Prod", running, True,
                         f"00:50:56:a1:{n // 256:02x}:{n % 256:02x}", "assigned", f"10.0.10.{10 + n}" if running else "", "",
                         bool(extra.get("sriov")), *ident])
        if name.startswith("backup"):
            rows_net.append([name, power, template, "Network adapter 2", "Vmxnet3", NETWORKS[3], "dvSwitch-Prod", True, True,
                             f"00:50:56:a2:{n // 256:02x}:{n % 256:02x}", "assigned", "10.0.40.10", "", False, *ident])

    data["vInfo"] = (info_h, rows_info)
    data["vDisk"] = (["VM", "Powerstate", "Template", "Disk", "Capacity MiB", "Raw", "Disk Mode", "Sharing mode", "Thin",
                      "Controller", "Shared Bus", "Raw LUN ID", "Raw Comp. Mode", "Path", "VM ID", "VM UUID", "VI SDK Server"], rows_disk)
    data["vSnapshot"] = (["VM", "Powerstate", "Name", "Description", "Date / time", "Filename", "Size MiB (vmsn)",
                          "Size MiB (total)", "Quiesced", "State", "VM ID", "VM UUID", "VI SDK Server"], rows_snap)
    data["vTools"] = (["VM", "Powerstate", "Template", "VM Version", "Tools", "Tools Version", "Required Version",
                       "Upgradeable", "Upgrade Policy", "VM ID", "VM UUID", "VI SDK Server"], rows_tools)
    data["vUSB"] = (["VM", "Powerstate", "Template", "Device Node", "Device Type", "Connected", "Family", "Speed",
                     "EHCI enabled", "Auto connect", "Bus number", "Unit number", "VM ID", "VM UUID", "VI SDK Server"], rows_usb)
    data["vCD"] = (["VM", "Powerstate", "Template", "Device Node", "Connected", "Starts Connected", "Device Type",
                    "VM ID", "VM UUID", "VI SDK Server"], rows_cd)
    data["vNetwork"] = (["VM", "Powerstate", "Template", "NIC label", "Adapter", "Network", "Switch", "Connected",
                         "Starts Connected", "Mac Address", "Type", "IPv4 Address", "IPv6 Address", "Direct Path IO",
                         "VM ID", "VM UUID", "VI SDK Server"], rows_net)

    rows_host = []
    for name, cluster, sockets, per_cpu, ram, esx in HOSTS:
        vm_count = sum(1 for v in rows_info if v[29] == name)
        rows_host.append([name, "RZ-Zentrale" if cluster == "Produktion" else "Aussenstelle", cluster, "green", False,
                          "Intel(R) Xeon(R) Gold 6226 CPU @ 2.70GHz" if per_cpu == 12 else "AMD EPYC 9124 16-Core Processor",
                          2700, True, True, sockets, per_cpu, sockets * per_cpu, rng.randint(15, 45), ram * 1024,
                          rng.randint(40, 70), 4, 2, vm_count, vm_count, esx, "Dell Inc.", "PowerEdge R650", VCENTER])
    data["vHost"] = (["Host", "Datacenter", "Cluster", "Config status", "in Maintenance Mode", "CPU Model", "Speed",
                      "HT Available", "HT Active", "# CPU", "Cores per CPU", "# Cores", "CPU usage %", "# Memory",
                      "Memory usage %", "# NICs", "# HBAs", "# VMs total", "# VMs", "ESX Version", "Vendor", "Model",
                      "VI SDK Server"], rows_host)

    rows_ds = []
    for name, kind, cap in DATASTORES:
        used = int(cap * rng.uniform(0.4, 0.75))
        rows_ds.append([name, "green", True, kind, 0, 0, cap, used, used, cap - used, round((cap - used) / cap * 100),
                        2 if kind == "vsan" else 3, "", "Aussenstelle" if kind == "vsan" else "Produktion", VCENTER])
    data["vDatastore"] = (["Name", "Config status", "Accessible", "Type", "# VMs total", "# VMs", "Capacity MiB",
                           "Provisioned MiB", "In Use MiB", "Free MiB", "Free %", "# Hosts", "Hosts", "Cluster name",
                           "VI SDK Server"], rows_ds)
    data["vCluster"] = (["Name", "Config status", "NumHosts", "HA enabled", "DRS enabled", "VI SDK Server"],
                        [["Produktion", "green", 3, True, True, VCENTER], ["Aussenstelle", "green", 2, True, False, VCENTER]])
    data["vLicense"] = (["Name", "Key", "Labels", "Cost Unit", "Total", "Used", "Expiration Date", "Features", "VI SDK Server"],
                        [["VMware vSphere 7 Enterprise Plus", "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", "", "cpuPackage", 8, 8, "Never", "", VCENTER],
                         ["VMware vCenter Server 7 Standard", "FFFFF-GGGGG-HHHHH-JJJJJ-KKKKK", "", "server", 1, 1, "Never", "", VCENTER]])
    data["vSource"] = (["Name", "OS type", "API type", "API version", "Version", "Build", "Fullname", "VI SDK Server"],
                       [[VCENTER, "linux-x64", "VirtualCenter", "7.0.3.0", "7.0.3", "24322831",
                         "VMware vCenter Server 7.0.3 build-24322831", VCENTER]])
    data["vMetaData"] = (["RVTools major version", "RVTools version", "xlsx creation datetime", "Server"],
                         [[4, "4.7.1.4", EXPORTED, VCENTER]])
    return data


def main() -> None:
    data = build()
    wb = Workbook()
    wb.remove(wb.active)
    for name, (header, rows) in data.items():
        sheet(wb, name, header, rows)
    OUT.mkdir(parents=True, exist_ok=True)
    wb.save(OUT / "beispiel.xlsx")

    # CSV-Variante ohne vTPM-Spalte und nur mit einigen Blättern, wie bei älteren Exporten
    csv_dir = OUT / "csv"
    csv_dir.mkdir(exist_ok=True)
    for name in ("vInfo", "vHost", "vDisk"):
        header, rows = data[name]
        keep = [i for i, h in enumerate(header) if h != "vTPM"]
        with open(csv_dir / f"RVTools_tab{name}.csv", "w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.writer(fh)
            writer.writerow([header[i] for i in keep])
            for row in rows:
                writer.writerow([row[i] for i in keep])
    print("geschrieben:", OUT / "beispiel.xlsx", csv_dir)


if __name__ == "__main__":
    main()
