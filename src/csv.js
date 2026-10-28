// Liest CSV-Exporte von RVTools (eine Datei pro Blatt, z. B. RVTools_tabvInfo.csv).

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Ungültiges UTF-8 deutet auf Windows-1252 hin (ältere Exporte)
  if (utf8.includes('�')) return new TextDecoder('windows-1252').decode(bytes);
  return utf8.replace(/^﻿/, '');
}

function detectDelimiter(firstLine) {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

export function parseCsv(text) {
  const firstLineEnd = text.search(/\r?\n/);
  const delimiter = detectDelimiter(firstLineEnd < 0 ? text : text.slice(0, firstLineEnd));
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((v) => (v === '' ? undefined : v)));
}

const SHEET_NAMES = [
  'vInfo', 'vCPU', 'vMemory', 'vDisk', 'vPartition', 'vNetwork', 'vCD', 'vUSB', 'vSnapshot',
  'vTools', 'vSource', 'vRP', 'vCluster', 'vHost', 'vHBA', 'vNIC', 'vSwitch', 'vPort',
  'dvSwitch', 'dvPort', 'vSC_VMK', 'vDatastore', 'vMultiPath', 'vLicense', 'vFileInfo',
  'vHealth', 'vMetaData', 'vFloppy',
];

/** Ermittelt aus dem Dateinamen, welches RVTools-Blatt eine CSV-Datei enthält. */
export function sheetNameFromFile(fileName) {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '');
  const tab = base.match(/tab(\w+)$/i);
  const candidate = (tab ? tab[1] : base).toLowerCase();
  return SHEET_NAMES.find((name) => name.toLowerCase() === candidate)
    ?? SHEET_NAMES.find((name) => base.toLowerCase().endsWith(name.toLowerCase()))
    ?? null;
}
