// Oberfläche: Datei einlesen, Bericht zeigen, Annahmen anpassen, drucken und exportieren.

import { APP } from './config.js';
import { analyse, modelFromExports, readExports } from './analyse.js';
import { defaultSettings, PROXMOX_LEVELS, VMWARE_PRODUCTS } from './costs.js';
import { LEVELS, TARGETS } from './rules.js';
import { esxSupport } from './env.js';
import { fmtDateDe, fmtDec, fmtEuro, fmtHours, fmtNum, fmtSize, html, plural, raw } from './format.js';

const STORAGE_KEY = `${APP.slug}.einstellungen.v1`;
const VERDICTS = { ok: 'Ohne Stolpersteine', effort: 'Mehraufwand', block: 'Vorher klären', skip: 'Bleibt zurück' };
const VERDICT_ORDER = { block: 0, effort: 1, ok: 2, skip: 3 };
const LEVEL_ORDER = { block: 0, effort: 1, note: 2 };

const state = {
  model: null,
  source: '',
  settings: loadSettings(),
  anonymize: false,
  filter: 'all',
  query: '',
  open: new Set(),
  result: null,
  names: null,
};

const $ = (selector, root = document) => root.querySelector(selector);

/* ---------- Einstellungen ---------- */

function loadSettings() {
  const settings = defaultSettings();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const key of Object.keys(settings)) {
      if (stored[key] !== undefined && typeof stored[key] === typeof settings[key]) settings[key] = stored[key];
    }
  } catch {
    // Ohne Speicher (privates Fenster) gelten die Vorgaben
  }
  return settings;
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch {
    // nicht schlimm
  }
}

/* ---------- Namen ausblenden ---------- */

function buildNames(model) {
  const map = new Map();
  const add = (values, prefix, width) => {
    let i = 0;
    for (const value of values) {
      if (!value || map.has(value)) continue;
      i++;
      map.set(value, `${prefix}${String(i).padStart(width, '0')}`);
    }
  };
  add(model.vms.map((v) => v.name), 'VM-', 3);
  add(model.hosts.map((h) => h.name), 'Host-', 2);
  add([...model.hosts.map((h) => h.cluster), ...model.vms.map((v) => v.cluster)], 'Cluster-', 1);
  add([...model.datastores.map((d) => d.name), ...model.vms.flatMap((v) => [v.datastore, ...v.disks.map((d) => d.datastore)])], 'Datastore-', 2);
  add(model.vms.flatMap((v) => v.nics.map((n) => n.network)), 'Netz-', 2);
  add([...model.hosts.map((h) => h.datacenter), ...model.vms.map((v) => v.datacenter)], 'Standort-', 1);
  add([...model.sources.map((s) => s.name), ...model.vms.map((v) => v.vcenter)], 'vCenter-', 1);
  const keys = [...map.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = keys.length ? new RegExp(`(?<![\\w.-])(${keys.join('|')})(?![\\w-])`, 'g') : null;
  return { map, re };
}

const n = (value) => (state.anonymize && state.names ? state.names.map.get(value) ?? value : value);
const t = (text) => (state.anonymize && state.names?.re ? String(text).replace(state.names.re, (m) => state.names.map.get(m) ?? m) : text);

/* ---------- Bausteine ---------- */

const tag = (level, label) => html`<span class="tag ${level}">${label}</span>`;

function applySizes(root) {
  for (const el of root.querySelectorAll('[data-width]')) el.style.width = `${el.dataset.width}%`;
  for (const el of root.querySelectorAll('[data-grow]')) el.style.flexGrow = el.dataset.grow;
}

function setHtml(id, content) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = String(content);
  applySizes(el);
}

function numberField(key, label, { step = 1, min = 0, max, note } = {}) {
  return html`<label><span>${label}</span>
    <input type="number" inputmode="decimal" data-setting="${key}" value="${state.settings[key]}" step="${step}" min="${min}"${max !== undefined ? raw(` max="${max}"`) : ''}>
    ${note ? html`<span class="note">${note}</span>` : ''}</label>`;
}

function selectField(key, label, options) {
  return html`<label><span>${label}</span><select data-setting="${key}">${Object.entries(options).map(
    ([value, text]) => html`<option value="${value}"${state.settings[key] === value ? raw(' selected') : ''}>${text}</option>`,
  )}</select></label>`;
}

/* ---------- Bericht: Gerüst ---------- */

function renderReport() {
  const report = $('#report');
  report.innerHTML = String(html`<div class="wrap">
    <header class="report-head" id="head-out"></header>
    <div class="layout">
      <nav class="toc" aria-label="Abschnitte"><ol>
        <li><a href="#ueberblick">Überblick</a></li>
        <li><a href="#kosten">Kosten</a></li>
        <li><a href="#aufwand">Aufwand</a></li>
        <li><a href="#stolpersteine">Stolpersteine</a></li>
        <li><a href="#umgebung">Umgebung</a></li>
        <li><a href="#vms">Alle VMs</a></li>
        <li><a href="#grenzen">Grenzen der Prüfung</a></li>
      </ol></nav>
      <div>
        <section class="section summary" id="ueberblick"><h2 class="visually-hidden">Überblick</h2><div id="summary-out"></div></section>
        <section class="section" id="kosten">
          <h2>Kosten</h2>
          <div id="costs-out"></div>
          <details class="assumptions">
            <summary>Preise und Zeitraum anpassen</summary>
            <div class="form">
              ${numberField('years', 'Zeitraum in Jahren', { min: 1, max: 10 })}
              ${selectField('vmwareProduct', 'VMware-Produkt', Object.fromEntries(Object.entries(VMWARE_PRODUCTS).map(([k, v]) => [k, v.label])))}
              ${numberField('vmwarePricePerCore', 'VMware: € je Kern und Jahr')}
              ${numberField('vmwareMinOrderCores', 'VMware: Mindestmenge in Kernen', { note: 'Händler nannten 2025 teils 72 Kerne; Broadcom bestätigt das öffentlich nicht. 0 = keine.' })}
              ${selectField('proxmoxLevel', 'Proxmox-Supportstufe', Object.fromEntries(Object.entries(PROXMOX_LEVELS).map(([k, v]) => [k, `${v.label} (${v.price} €)`])))}
              ${numberField('proxmoxPricePerSocket', 'Proxmox: € je CPU-Sockel und Jahr')}
              ${selectField('hypervHostsLicensed', 'Hyper-V: Hosts schon mit Windows Server lizenziert?', { auto: 'Automatisch (ja, wenn Windows-VMs laufen)', yes: 'Ja', no: 'Nein' })}
              ${numberField('hypervPricePerCore', 'Hyper-V: € je Kernlizenz, einmalig')}
              <p class="note wide">Broadcom veröffentlicht keine Preisliste. Die Vorgaben sind berichtete US-Listenpreise (VCF 350, VVF 135, vSphere Standard 50 je Kern und Jahr) ohne Währungsumrechnung – tragen Sie Ihr Angebot ein. Proxmox: offizielle Preise je Sockel und Jahr, Stand Oktober 2026. Hyper-V: US-Listenpreis Windows Server 2025 Standard (1.176 $ je 16 Kerne).</p>
            </div>
          </details>
        </section>
        <section class="section" id="aufwand">
          <h2>Aufwand</h2>
          <div id="effort-out"></div>
          <details class="assumptions">
            <summary>Stundensatz und Zeiten anpassen</summary>
            <div class="form">
              ${numberField('rate', 'Stundensatz in €', { note: 'Vorgabe: Median IT-Infrastruktur laut Freelancer-Kompass 2026.' })}
              ${numberField('hoursWindows', 'Stunden je Windows-VM', { step: 0.25 })}
              ${numberField('hoursLinux', 'Stunden je Linux-VM', { step: 0.25 })}
              ${numberField('hoursOther', 'Stunden je sonstige VM', { step: 0.25 })}
              ${numberField('hoursEffort', 'Zusätzlich je Befund „Mehraufwand“', { step: 0.25 })}
              ${numberField('hoursBlock', 'Zusätzlich je Befund „Vorher klären“', { step: 0.5 })}
              ${numberField('projectDays', 'Projektgrundlage in Tagen', { step: 0.5, note: 'Planung, Aufbau der Zielumgebung, Tests, Übergabe.' })}
              ${numberField('daysPerHost', 'Zusätzlich je Host in Tagen', { step: 0.25 })}
              ${numberField('throughputMBs', 'Kopierdurchsatz in MB/s', { step: 10, note: 'Grundlage der reinen Kopierzeit.' })}
              <label class="check wide"><input type="checkbox" data-setting="includePoweredOff"${state.settings.includePoweredOff ? raw(' checked') : ''}> Ausgeschaltete VMs einrechnen</label>
            </div>
          </details>
        </section>
        <section class="section" id="stolpersteine">
          <h2>Stolpersteine</h2>
          <div id="groups-out"></div>
        </section>
        <section class="section" id="umgebung">
          <h2>Umgebung</h2>
          <div id="env-out"></div>
        </section>
        <section class="section" id="vms">
          <h2>Alle VMs</h2>
          <div class="filters" id="filters-out"></div>
          <div id="vm-out"></div>
        </section>
        <section class="section limits" id="grenzen">
          <h2>Grenzen der Prüfung</h2>
          <div id="limits-out"></div>
        </section>
      </div>
    </div>
  </div>`);
}

/* ---------- Bericht: Inhalte ---------- */

function update() {
  state.result = analyse(state.model, state.settings, new Date());
  for (const button of document.querySelectorAll('[data-target]')) {
    button.setAttribute('aria-pressed', String(button.dataset.target === state.settings.target));
  }
  renderHead();
  renderSummary();
  renderCosts();
  renderEffort();
  renderGroups();
  renderEnvironment();
  renderFilters();
  renderVms();
  renderLimits();
}

function renderHead() {
  const m = state.model;
  const vcenters = m.sources.map((s) => n(s.name)).filter(Boolean);
  const parts = [];
  if (m.meta.exportedAt) parts.push(`Export vom ${fmtDateDe(m.meta.exportedAt)}`);
  if (m.meta.rvtoolsVersion) parts.push(`RVTools ${m.meta.rvtoolsVersion}`);
  parts.push(`${plural(m.vms.length, 'VM', 'VMs')} auf ${plural(m.hosts.length, 'Host', 'Hosts')}`);
  setHtml('head-out', html`<h1>Umzugscheck ${vcenters.length ? `für ${vcenters.join(', ')}` : ''}</h1>
    <p class="meta">${state.anonymize ? 'Export' : state.source}: ${parts.join(', ')}. Ziel: ${TARGETS[state.settings.target]}.</p>`);
}

function renderSummary() {
  const { counts, costs, effort, vms } = state.result;
  const total = vms.length;
  const moved = total - counts.skip;
  const s = state.settings;
  const target = costs.options.find((o) => o.id === s.target);
  const vmware = costs.options[0];
  const sentences = [];
  sentences.push(html`Von ${plural(total, 'VM', 'VMs')} ziehen <strong>${fmtNum(moved)}</strong> um: ${fmtNum(counts.ok)} ohne Stolpersteine, ${fmtNum(counts.effort)} mit Mehraufwand, bei ${fmtNum(counts.block)} ist vorher etwas zu klären.`);
  if (counts.skip) sentences.push(html` ${fmtNum(counts.skip)} bleiben zurück (Vorlagen, Platzhalter, VMware-Appliances).`);
  let costLine = '';
  if (state.model.hosts.length) {
    const diff = vmware.total - target.total;
    costLine = html`Über ${plural(s.years, 'Jahr', 'Jahre')} kostet VMware rund <strong>${fmtEuro(vmware.total)}</strong>, ${TARGETS[s.target]} samt Umzug rund <strong>${fmtEuro(target.total)}</strong> – ${diff >= 0 ? html`${fmtEuro(diff)} weniger` : html`${fmtEuro(-diff)} mehr`}.`;
  }
  const segments = ['ok', 'effort', 'block', 'skip'].filter((v) => counts[v]);
  setHtml('summary-out', html`
    <p class="verdict-line">${sentences}</p>
    <div class="fleet" role="img" aria-label="${segments.map((v) => `${VERDICTS[v]}: ${counts[v]}`).join(', ')}">
      ${segments.map((v) => html`<span class="${v}" data-grow="${counts[v]}" title="${VERDICTS[v]}: ${counts[v]}"></span>`)}
    </div>
    <ul class="legend">${['ok', 'effort', 'block', 'skip'].map((v) => html`<li><span class="swatch ${v}"></span>${VERDICTS[v]}: ${fmtNum(counts[v])}</li>`)}</ul>
    ${costLine ? html`<p class="verdict-line">${costLine}</p>` : ''}
    <dl class="facts">
      <div><dt>Hosts</dt><dd>${fmtNum(state.model.hosts.length)} mit ${fmtNum(costs.sockets)} Sockeln</dd></div>
      <div><dt>Physische Kerne</dt><dd>${fmtNum(costs.physicalCores)}</dd></div>
      <div><dt>Belegter Speicher</dt><dd>${fmtSize(effort.inUseMiB)}</dd></div>
      <div><dt>Geschätzter Aufwand</dt><dd>${fmtDec(effort.days)} Personentage</dd></div>
    </dl>`);
}

function renderCosts() {
  const { costs, effort } = state.result;
  const s = state.settings;
  if (!state.model.hosts.length) {
    setHtml('costs-out', html`<p>Ohne das Blatt vHost fehlen Sockel und Kerne – der Kostenvergleich lässt sich nicht rechnen.</p>`);
    return;
  }
  const max = Math.max(...costs.options.map((o) => o.total), 1);
  const lines = [];
  lines.push(`Broadcom berechnet ${fmtNum(costs.licensedCores)} Kerne, vorhanden sind ${fmtNum(costs.physicalCores)} – jede CPU zählt mit mindestens 16 Kernen${s.vmwareMinOrderCores ? `, Mindestmenge ${fmtNum(s.vmwareMinOrderCores)}` : ''}.`);
  if (s.hypervHostsLicensed === 'auto') {
    lines.push(costs.hostsLicensed
      ? `Annahme für Hyper-V: Weil ${plural(costs.windowsVms, 'Windows-VM läuft', 'Windows-VMs laufen')}, sind die Hosts vermutlich schon mit Windows Server lizenziert. Dann kostet Hyper-V keine zusätzliche Lizenz.`
      : 'Annahme für Hyper-V: Ohne Windows-VMs sind die Hosts vermutlich nicht mit Windows Server lizenziert; eingerechnet ist Windows Server Standard für alle Hosts.');
  }
  lines.push(`Umzug: ${fmtEuro(effort.cost)} laut Aufwandsschätzung, für Proxmox VE und Hyper-V gleich angesetzt.`);
  setHtml('costs-out', html`
    <p class="intro">Summe über ${plural(s.years, 'Jahr', 'Jahre')}, inklusive einmaliger Kosten für den Umzug.</p>
    <div class="compare">${costs.options.map((o) => html`
      <div class="option is-${o.id}${o.id === s.target ? ' is-target' : ''}">
        <span class="name">${o.label}</span>
        <div class="bar"><span data-width="${Math.max(1, (o.total / max) * 100).toFixed(1)}"></span></div>
        <div class="figures">
          <span><strong>${fmtEuro(o.total)}</strong> gesamt</span>
          <span>${fmtEuro(o.perYear)} pro Jahr</span>
          <span>${fmtEuro(o.once)} einmalig</span>
        </div>
        <div class="figures small">${o.basis}</div>
      </div>`)}
    </div>
    ${lines.map((line) => html`<p class="small">${line}</p>`)}
    <p class="small">Nicht enthalten: Hardware, Backup-Software, Schulung und laufender Betrieb. Windows-Lizenzen für die Windows-VMs braucht jede Variante, sie sind deshalb nicht eingerechnet.</p>`);
}

function renderEffort() {
  const { effort } = state.result;
  const s = state.settings;
  const rows = [
    ['Projektgrundlage (Planung, Aufbau, Tests)', effort.projectHours],
    [`Umzug der VMs (${fmtNum(effort.families.windows)} Windows, ${fmtNum(effort.families.linux)} Linux, ${fmtNum(effort.families.other)} sonstige)`, effort.baseHours],
    ['Zuschlag für Befunde „Mehraufwand“', effort.effortHours],
    ['Zuschlag für Befunde „Vorher klären“', effort.blockHours],
  ];
  setHtml('effort-out', html`
    <p class="verdict-line">Rund <strong>${fmtDec(effort.days)} Personentage</strong> (${fmtNum(effort.hours)} Stunden), bei ${fmtEuro(s.rate)} je Stunde also <strong>${fmtEuro(effort.cost)}</strong>.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Posten</th><th class="num">Stunden</th></tr></thead>
      <tbody>${rows.map(([label, hours]) => html`<tr><td>${label}</td><td class="num">${fmtDec(hours)}</td></tr>`)}</tbody>
    </table></div>
    <p class="small">${plural(effort.movedVms, 'VM', 'VMs')} mit zusammen ${fmtSize(effort.inUseMiB)} belegtem Speicher. Reine Kopierzeit bei ${fmtNum(s.throughputMBs)} MB/s: ${fmtHours(effort.copyHours)}, verteilt auf die Wartungsfenster. Jede VM ist während ihres Umzugs ausgeschaltet.</p>`);
}

function vmList(entries, limit = 18) {
  const names = entries.map(({ vm }) => n(vm.name));
  if (names.length <= limit) return html`<p class="names">${names.join(', ')}</p>`;
  return html`<p class="names">${names.slice(0, limit).join(', ')}</p>
    <details><summary>Alle ${fmtNum(names.length)} anzeigen</summary><p class="names">${names.join(', ')}</p></details>`;
}

function renderGroups() {
  const { groups } = state.result;
  if (!groups.length) {
    setHtml('groups-out', html`<p>Keine Stolpersteine gefunden.</p>`);
    return;
  }
  setHtml('groups-out', html`
    <p class="intro">Für ${TARGETS[state.settings.target]}, sortiert nach Schwere. ${LEVELS.block}: so geht es nicht. ${LEVELS.effort}: geht, kostet aber Zeit. ${LEVELS.note}: beachten.</p>
    <div class="groups">${groups.map((g) => html`
      <article class="group">
        <div class="group-head">${tag(g.level, LEVELS[g.level])}<h3>${g.title}</h3><span class="count">${plural(g.vms.length, 'VM', 'VMs')}</span></div>
        <p class="fix">${t(g.fix)}</p>
        ${vmList(g.vms)}
      </article>`)}
    </div>`);
}

function renderEnvironment() {
  const { environment } = state.result;
  const m = state.model;
  const today = new Date();
  const hostRows = m.hosts.map((h) => {
    const support = esxSupport(h, today);
    return html`<tr>
      <td>${n(h.name)}</td><td>${n(h.cluster) || '–'}</td><td>${h.cpuModel || '–'}</td>
      <td class="num">${fmtNum(h.sockets)} × ${fmtNum(h.coresPerCpu)}</td>
      <td class="num">${fmtSize(h.memMiB)}</td><td>${h.esx ? `${h.esx.major}.${h.esx.minor}.${h.esx.patch}` : h.esxVersion || '–'}</td>
      <td>${support ? html`${support.ended ? tag('block', `beendet ${support.endText}`) : support.endText}` : '–'}</td>
    </tr>`;
  });
  const dsRows = m.datastores.map((d) => html`<tr>
    <td>${n(d.name)}</td><td>${d.type || '–'}</td><td class="num">${fmtSize(d.capacityMiB)}</td><td class="num">${fmtSize(d.inUseMiB)}</td></tr>`);
  setHtml('env-out', html`
    ${environment.length ? html`<ul class="env-list">${environment.map((e) => html`<li>${tag(e.level, LEVELS[e.level])}<strong>${t(e.title)}</strong><span class="detail">${t(e.detail)}</span></li>`)}</ul>` : ''}
    ${hostRows.length ? html`<h3 class="subhead">Hosts</h3><div class="table-wrap"><table>
      <thead><tr><th>Host</th><th>Cluster</th><th>CPU</th><th class="num">Sockel × Kerne</th><th class="num">RAM</th><th>ESXi</th><th>Allgemeiner Support bis</th></tr></thead>
      <tbody>${hostRows}</tbody></table></div>` : ''}
    ${dsRows.length ? html`<h3 class="subhead">Datastores</h3><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Typ</th><th class="num">Größe</th><th class="num">Belegt</th></tr></thead>
      <tbody>${dsRows}</tbody></table></div>` : ''}
    ${m.licenses.length ? html`<h3 class="subhead">Vorhandene VMware-Lizenzen</h3><div class="table-wrap"><table>
      <thead><tr><th>Lizenz</th><th>Einheit</th><th class="num">Gesamt</th><th class="num">Genutzt</th><th>Ablauf</th></tr></thead>
      <tbody>${m.licenses.map((l) => html`<tr><td>${l.name}</td><td>${l.costUnit || '–'}</td><td class="num">${l.total ?? '–'}</td><td class="num">${l.used ?? '–'}</td><td>${l.expiration || '–'}</td></tr>`)}</tbody>
      </table></div><p class="small">Lizenzschlüssel werden nicht angezeigt.</p>` : ''}`);
}

function renderFilters() {
  const { counts, vms } = state.result;
  const chips = [['all', 'Alle', vms.length], ...['block', 'effort', 'ok', 'skip'].map((v) => [v, VERDICTS[v], counts[v]])];
  setHtml('filters-out', html`${chips.map(([value, label, count]) => html`<button type="button" class="chip" data-filter="${value}" aria-pressed="${state.filter === value}">${label} (${fmtNum(count)})</button>`)}
    <label class="visually-hidden" for="vm-search">VM suchen</label>
    <input type="search" id="vm-search" placeholder="VM oder System suchen" value="${state.query}">`);
}

function filteredVms() {
  const q = state.query.trim().toLowerCase();
  return state.result.vms
    .filter((vm) => state.filter === 'all' || vm.verdict === state.filter)
    .filter((vm) => !q || n(vm.name).toLowerCase().includes(q) || vm.os.name.toLowerCase().includes(q))
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.name.localeCompare(b.name, 'de'));
}

function findingDetails(vm) {
  if (vm.skip) return html`<p>${vm.skip}.</p>`;
  if (!vm.findings.length) return html`<p>Keine Befunde.</p>`;
  const sorted = [...vm.findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return html`<ul class="finding-list">${sorted.map((f) => html`<li>${tag(f.level, LEVELS[f.level])}
    <div class="text"><p><strong>${f.title}.</strong> ${t(f.detail)}</p><p class="fix">Was tun: ${t(f.fix)}</p></div></li>`)}</ul>`;
}

function renderVms() {
  const vms = filteredVms();
  if (!vms.length) {
    setHtml('vm-out', html`<p>Keine VM passt zu Filter und Suche.</p>`);
    return;
  }
  const rows = vms.map((vm) => {
    const serious = vm.findings.filter((f) => f.level !== 'note');
    const notes = vm.findings.length - serious.length;
    const open = state.open.has(vm.index);
    return html`<tr>
      <td>${tag(vm.verdict, VERDICTS[vm.verdict])}</td>
      <td><button type="button" class="vm-name" data-vm="${vm.index}" aria-expanded="${open}">${n(vm.name)}</button></td>
      <td class="os">${vm.os.name}</td>
      <td class="num">${fmtNum(vm.cpus)}</td>
      <td class="num">${fmtSize(vm.memMiB)}</td>
      <td class="num">${fmtSize(vm.inUseMiB)}</td>
      <td>${n(vm.cluster) || '–'}</td>
      <td><div class="vm-tags">${serious.map((f) => tag(f.level, f.title))}${notes ? html`<span class="small">${plural(notes, 'Hinweis', 'Hinweise')}</span>` : ''}${vm.skip ? html`<span class="small">${vm.skip}</span>` : ''}</div></td>
    </tr>${open ? html`<tr class="detail"><td></td><td colspan="7">${findingDetails(vm)}</td></tr>` : ''}`;
  });
  setHtml('vm-out', html`<div class="table-wrap"><table>
    <thead><tr><th>Status</th><th>VM</th><th>Betriebssystem</th><th class="num">vCPU</th><th class="num">RAM</th><th class="num">Belegt</th><th>Cluster</th><th>Befunde</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`);
}

function renderLimits() {
  const { gaps } = state.model;
  setHtml('limits-out', html`
    ${gaps.length ? html`<h3 class="subhead">Was in diesem Export fehlt</h3><ul>${gaps.map((g) => html`<li>${g.column ? `${g.sheet}, Spalte ${g.column}` : `Blatt ${g.sheet}`}: ${g.message}</li>`)}</ul>` : ''}
    <h3 class="subhead">Was die Prüfung grundsätzlich nicht sieht</h3>
    <ul>
      <li>Anwendungen und ihre Abhängigkeiten, Lizenzen innerhalb der VMs (z. B. an Hardware gebundene Software) und das Backup-Konzept.</li>
      <li>Ziele, die über Bereiche, Geräte-IDs oder Skripte festgelegt sind, sowie Verschlüsselung im Gast (BitLocker ohne vTPM).</li>
      <li>Ob Hardware, Speicher und Netz für das Ziel taugen. Die Kosten gehen davon aus, dass die vorhandenen Hosts weiterlaufen.</li>
    </ul>
    <h3 class="subhead">Grundlagen</h3>
    <ul>
      <li><a href="https://pve.proxmox.com/wiki/Migrate_to_Proxmox_VE" rel="noopener">Proxmox-Wiki: Migrate to Proxmox VE</a> – Grenzen des ESXi-Imports und Vorbereitung der Gäste.</li>
      <li><a href="https://www.proxmox.com/proxmox-ve/pricing" rel="noopener">Proxmox VE: Preise</a> – Subskription je CPU-Sockel und Jahr.</li>
      <li><a href="https://knowledge.broadcom.com/external/article/459135/end-of-general-support-for-vsphere-80.html" rel="noopener">Broadcom: Ende des allgemeinen Supports für vSphere 8</a> – 11.10.2027.</li>
      <li>Broadcom lizenziert je Kern mit mindestens 16 Kernen pro CPU. Supportende von Betriebssystemen laut Lebenszyklus der Hersteller.</li>
    </ul>
    <p><a href="${APP.repo}/blob/main/docs/anleitung.md" rel="noopener">Anleitung</a>: Export erstellen, Annahmen anpassen, Ergebnis weitergeben. Fehlt etwas oder wirken Zahlen falsch, freue ich mich über ein <a href="${APP.repo}/issues" rel="noopener">Issue</a> – bitte nur mit Spaltenüberschriften, ohne Daten aus der Umgebung.</p>
    ${APP.contact.text ? html`<p><a href="${APP.contact.url}" rel="noopener">${APP.contact.text}</a></p>` : ''}`);
}

/* ---------- CSV ---------- */

function csvCell(value) {
  const s = String(value ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const header = ['VM', 'Status', 'Betriebssystem', 'Zustand', 'vCPU', 'RAM GiB', 'Belegt GiB', 'Cluster', 'Host', 'Befunde', 'Was tun'];
  const lines = [header];
  for (const vm of [...state.result.vms].sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict])) {
    const findings = [...vm.findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    lines.push([
      n(vm.name), VERDICTS[vm.verdict], vm.os.name, { on: 'an', off: 'aus', suspended: 'angehalten' }[vm.power] ?? '',
      vm.cpus, Math.round(vm.memMiB / 1024), Math.round(vm.inUseMiB / 1024), n(vm.cluster), n(vm.host),
      vm.skip || findings.map((f) => `${LEVELS[f.level]}: ${f.title}`).join(' | '),
      findings.filter((f) => f.level !== 'note').map((f) => t(f.fix)).join(' | '),
    ]);
  }
  const text = `﻿${lines.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${APP.slug}-${state.settings.target}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Laden ---------- */

function setStatus(text, error = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('is-error', error);
}

async function load(files, label) {
  setStatus(`Lese ${files.length === 1 ? files[0].name : `${files.length} Dateien`} …`);
  try {
    const { exports, ignored } = await readExports(files);
    const model = modelFromExports(exports);
    state.model = model;
    state.source = label;
    state.names = buildNames(model);
    state.open.clear();
    state.filter = 'all';
    state.query = '';
    setStatus(ignored.length ? `Nicht verwendet: ${ignored.join(', ')}` : '');
    showReport();
  } catch (err) {
    console.error(err);
    setStatus(`Die Datei ließ sich nicht auswerten: ${err.message}`, true);
  }
}

async function loadFileList(fileList) {
  const files = [];
  for (const file of fileList) files.push({ name: file.name, buffer: await file.arrayBuffer() });
  if (!files.length) return;
  await load(files, files.length === 1 ? files[0].name : `${files.length} Dateien`);
}

function loadExample() {
  const b64 = $('#example-data').textContent.trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  load([{ name: 'beispiel.xlsx', buffer: bytes.buffer }], 'Beispieldaten (erfundene Muster GmbH)');
}

function showReport() {
  $('#start').hidden = true;
  $('#report').hidden = false;
  $('#toolbar').hidden = false;
  renderReport();
  update();
  window.scrollTo(0, 0);
}

function showStart() {
  state.model = null;
  state.result = null;
  $('#report').hidden = true;
  $('#report').innerHTML = '';
  $('#toolbar').hidden = true;
  $('#start').hidden = false;
  $('#file-input').value = '';
}

/* ---------- Ereignisse ---------- */

function readSetting(el) {
  const key = el.dataset.setting;
  if (el.type === 'checkbox') return [key, el.checked];
  if (el.type === 'number') {
    const value = Number(el.value);
    return [key, Number.isFinite(value) && value >= 0 ? value : null];
  }
  return [key, el.value];
}

function onSettingChange(event) {
  const el = event.target.closest('[data-setting]');
  if (!el) return;
  const [key, value] = readSetting(el);
  if (value === null) return;
  state.settings[key] = key === 'years' ? Math.min(10, Math.max(1, Math.round(value))) : value;
  if (key === 'vmwareProduct' && VMWARE_PRODUCTS[value].price !== null) {
    state.settings.vmwarePricePerCore = VMWARE_PRODUCTS[value].price;
    $('[data-setting="vmwarePricePerCore"]').value = VMWARE_PRODUCTS[value].price;
  }
  if (key === 'proxmoxLevel') {
    state.settings.proxmoxPricePerSocket = PROXMOX_LEVELS[value].price;
    $('[data-setting="proxmoxPricePerSocket"]').value = PROXMOX_LEVELS[value].price;
  }
  if (key === 'vmwarePricePerCore' && state.settings.vmwareProduct !== 'custom' && value !== VMWARE_PRODUCTS[state.settings.vmwareProduct].price) {
    state.settings.vmwareProduct = 'custom';
    $('[data-setting="vmwareProduct"]').value = 'custom';
  }
  saveSettings();
  update();
}

function init() {
  const drop = $('#drop');
  const input = $('#file-input');
  $('#choose').addEventListener('click', () => input.click());
  input.addEventListener('change', () => loadFileList(input.files));
  $('#example').addEventListener('click', loadExample);

  document.addEventListener('dragover', (e) => {
    if (!$('#start').hidden) {
      e.preventDefault();
      drop.classList.add('is-over');
    }
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) drop.classList.remove('is-over');
  });
  document.addEventListener('drop', (e) => {
    if ($('#start').hidden) return;
    e.preventDefault();
    drop.classList.remove('is-over');
    loadFileList(e.dataTransfer.files);
  });

  for (const button of document.querySelectorAll('[data-target]')) {
    button.addEventListener('click', () => {
      state.settings.target = button.dataset.target;
      saveSettings();
      update();
    });
  }
  $('#anonymize').addEventListener('change', (e) => {
    state.anonymize = e.target.checked;
    update();
  });
  $('#print').addEventListener('click', () => window.print());
  $('#csv').addEventListener('click', exportCsv);
  $('#again').addEventListener('click', showStart);
  $('#home').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.model) showStart();
  });

  const report = $('#report');
  report.addEventListener('change', onSettingChange);
  report.addEventListener('input', (e) => {
    if (e.target.matches('input[type="number"]')) onSettingChange(e);
    if (e.target.id === 'vm-search') {
      state.query = e.target.value;
      renderVms();
    }
  });
  report.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      state.filter = chip.dataset.filter;
      renderFilters();
      renderVms();
      return;
    }
    const vmButton = e.target.closest('[data-vm]');
    if (vmButton) {
      const index = Number(vmButton.dataset.vm);
      if (state.open.has(index)) state.open.delete(index);
      else state.open.add(index);
      renderVms();
      document.querySelector(`[data-vm="${index}"]`)?.focus();
    }
  });

  // Beim Drucken alle aufklappbaren Teile zeigen
  const reopened = [];
  window.addEventListener('beforeprint', () => {
    for (const d of document.querySelectorAll('details:not([open])')) {
      d.open = true;
      reopened.push(d);
    }
  });
  window.addEventListener('afterprint', () => {
    while (reopened.length) reopened.pop().open = false;
  });
}

init();
