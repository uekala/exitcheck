// Liest die Tabellenblätter einer xlsx-Datei als Zeilen mit Zellwerten.
// Bewusst klein gehalten: keine Formeln, keine Formatierung, nur Werte.

import { listZipEntries, readZipText } from './zip.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text) {
  return text
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, code) => {
      if (code[0] === '#') {
        const value = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return String.fromCodePoint(value);
      }
      return ENTITIES[code];
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

function textOf(fragment) {
  // Verbindet alle <t>-Teile, lässt phonetische Hilfen (<rPh>) weg
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let result = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(withoutPhonetic))) result += m[1] ? decodeXml(m[1]) : '';
  return result;
}

export function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m;
  while ((m = re.exec(xml))) strings.push(m[1] ? textOf(m[1]) : '');
  return strings;
}

export function columnIndex(ref) {
  let index = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

function cellValue(attrs, inner, shared) {
  const type = attribute(attrs, 't');
  if (type === 'inlineStr') return textOf(inner);
  const v = inner.match(/<v>([\s\S]*?)<\/v>/);
  if (!v) return null;
  const raw = decodeXml(v[1]);
  switch (type) {
    case 's':
      return shared[Number(raw)] ?? '';
    case 'b':
      return raw === '1';
    case 'str':
    case 'e':
      return raw;
    default: {
      const num = Number(raw);
      return Number.isNaN(num) ? raw : num;
    }
  }
}

export function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch;
  let nextRow = 0;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowNumber = attribute(rowMatch[1], 'r');
    const rowIndex = rowNumber ? Number(rowNumber) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells = [];
    if (rowMatch[2]) {
      let cellMatch;
      let nextCol = 0;
      cellRe.lastIndex = 0;
      while ((cellMatch = cellRe.exec(rowMatch[2]))) {
        const ref = attribute(cellMatch[1], 'r');
        const col = ref ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        const value = cellMatch[2] ? cellValue(cellMatch[1], cellMatch[2], shared) : null;
        if (value !== null && value !== '') cells[col] = value;
      }
    }
    rows[rowIndex] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function resolveTarget(target) {
  const clean = target.replace(/^\//, '');
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

/** Liefert { Blattname: Zeilen[][] } für alle Blätter der Arbeitsmappe. */
export async function readXlsx(buffer) {
  const entries = listZipEntries(buffer);
  const workbook = await readZipText(buffer, entries, 'xl/workbook.xml');
  if (!workbook) throw new Error('Keine Excel-Arbeitsmappe gefunden.');
  const rels = (await readZipText(buffer, entries, 'xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(m[0], 'Id');
    const target = attribute(m[0], 'Target');
    if (id && target) targets.set(id, resolveTarget(target));
  }
  const shared = parseSharedStrings(await readZipText(buffer, entries, 'xl/sharedStrings.xml'));
  const sheets = {};
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attribute(m[0], 'name');
    const id = attribute(m[0], 'r:id');
    const path = targets.get(id);
    if (!name || !path) continue;
    const xml = await readZipText(buffer, entries, path);
    if (xml) sheets[name] = parseSheet(xml, shared);
  }
  return sheets;
}
