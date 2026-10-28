// Hilfsfunktionen, um Zellwerte aus RVTools einheitlich zu lesen.

/** Vergleichsschlüssel für Spaltenköpfe: nur Kleinbuchstaben und Ziffern. */
export function looseKey(header) {
  return String(header ?? '')
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Wandelt Zeilen (erste Zeile = Kopf) in Objekte mit lockeren Schlüsseln um. */
export function toTable(rows) {
  const headerIndex = rows.findIndex((r) => r && r.some((v) => v !== undefined && v !== null));
  if (headerIndex < 0) return { headers: [], keys: new Set(), rows: [] };
  const headers = rows[headerIndex].map((h) => (h == null ? '' : String(h)));
  const keys = headers.map(looseKey);
  const objects = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row || !row.some((v) => v !== undefined && v !== null && v !== '')) continue;
    const obj = {};
    keys.forEach((key, i) => {
      if (key && obj[key] === undefined && row[i] !== undefined) obj[key] = row[i];
    });
    objects.push(obj);
  }
  return { headers, keys: new Set(keys.filter(Boolean)), rows: objects };
}

/** Erster vorhandener Wert unter einem der Spaltennamen. */
export function pick(row, ...aliases) {
  for (const alias of aliases) {
    const value = row[looseKey(alias)];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function hasColumn(table, ...aliases) {
  return aliases.some((alias) => table.keys.has(looseKey(alias)));
}

export function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = str(value).toLowerCase();
  if (['true', 'yes', 'ja', 'wahr', '1', 'enabled', 'on'].includes(s)) return true;
  if (['false', 'no', 'nein', 'falsch', '0', 'disabled', 'off'].includes(s)) return false;
  return null;
}

export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = str(value).replace(/\s/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,(?=\d{3}\b)/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Datum aus Excel-Seriennummer oder Text (RVTools schreibt beides). */
export function date(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86400000));
  }
  const s = str(value);
  if (!s) return null;
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = iso;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  }
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (de) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = de;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (us) {
    let [, m, d, y, hh = '0', mm = '0', ss = '0', ampm] = us;
    let hour = +hh;
    if (ampm) hour = (hour % 12) + (ampm.toUpperCase() === 'PM' ? 12 : 0);
    return new Date(Date.UTC(+y, +m - 1, +d, hour, +mm, +ss));
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Datastore-Name aus einem Pfad wie "[DS01] ordner/vm.vmx". */
export function datastoreOfPath(path) {
  const match = str(path).match(/^\[([^\]]+)\]/);
  return match ? match[1] : '';
}
