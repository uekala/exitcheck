// Verbindet Einlesen, Modell, Regeln und Kosten.

import { readXlsx } from './xlsx.js';
import { decodeText, parseCsv, sheetNameFromFile } from './csv.js';
import { buildModel, mergeSheets } from './rvtools.js';
import { checkVm, skipReason, verdict } from './rules.js';
import { checkEnvironment } from './env.js';
import { compareCosts, estimateEffort } from './costs.js';

// Titel, die je VM variieren, bekommen in der Übersicht einen festen Namen
const GROUP_TITLES = {
  snapshots: 'Snapshots vorhanden',
  eol: 'Betriebssystem ohne oder bald ohne Support',
};

/** files: [{ name, buffer }] → Liste von Exporten mit ihren Blättern. */
export async function readExports(files) {
  const exports = [];
  const csvSheets = {};
  const ignored = [];
  for (const file of files) {
    if (/\.xlsx$/i.test(file.name)) {
      exports.push({ fileName: file.name, sheets: await readXlsx(file.buffer) });
    } else if (/\.csv$/i.test(file.name)) {
      const sheet = sheetNameFromFile(file.name);
      if (!sheet) {
        ignored.push(file.name);
        continue;
      }
      const rows = parseCsv(decodeText(new Uint8Array(file.buffer)));
      if (csvSheets[sheet]) csvSheets[sheet].push(...rows.slice(1));
      else csvSheets[sheet] = rows;
    } else {
      ignored.push(file.name);
    }
  }
  if (Object.keys(csvSheets).length) exports.push({ fileName: 'CSV-Dateien', sheets: csvSheets });
  return { exports, ignored };
}

export function modelFromExports(exports) {
  const tables = mergeSheets(exports);
  if (!tables.vInfo || !tables.vInfo.rows.length) {
    throw new Error('Im Export fehlt das Blatt vInfo – ist das ein RVTools-Export?');
  }
  return buildModel(tables);
}

export function analyse(model, settings, today = new Date()) {
  const ctx = {
    today,
    datastoreTypes: new Map(model.datastores.map((d) => [d.name, d.type])),
    vtpmKnown: !model.gaps.some((g) => g.column === 'vTPM'),
    encryptionKnown: !model.gaps.some((g) => g.column === 'VM Encryption'),
  };
  const vms = model.vms.map((vm) => {
    const skip = skipReason(vm);
    const findings = skip ? [] : checkVm(vm, settings.target, ctx);
    return { ...vm, skip, findings, verdict: skip ? 'skip' : verdict(findings) };
  });
  const counts = { ok: 0, effort: 0, block: 0, skip: 0 };
  for (const vm of vms) counts[vm.verdict]++;

  const effort = estimateEffort(vms, model.hosts, settings);
  const costs = compareCosts({ ...model, vms }, effort, settings);
  const environment = checkEnvironment(model, settings.target, today);

  // Befunde nach Art gruppiert, schwerste zuerst
  const byRule = new Map();
  for (const vm of vms) {
    for (const f of vm.findings) {
      const title = GROUP_TITLES[f.id] ?? f.title;
      if (!byRule.has(f.id)) byRule.set(f.id, { id: f.id, level: f.level, title, fix: f.fix, vms: [] });
      byRule.get(f.id).vms.push({ vm, finding: f });
    }
  }
  const order = { block: 0, effort: 1, note: 2 };
  const groups = [...byRule.values()].sort((a, b) => order[a.level] - order[b.level] || b.vms.length - a.vms.length);

  return { vms, counts, effort, costs, environment, groups };
}
