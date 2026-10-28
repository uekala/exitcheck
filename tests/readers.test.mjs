import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

import { readXlsx, parseSheet, parseSharedStrings, columnIndex, decodeXml } from '../src/xlsx.js';
import { listZipEntries, readZipText } from '../src/zip.js';
import { parseCsv, decodeText, sheetNameFromFile } from '../src/csv.js';

const fixture = (name) => {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

/** Baut ein minimales ZIP mit gespeicherten und komprimierten Einträgen. */
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text, compress] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = compress ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(compress ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, dir, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

test('ZIP: gespeicherte und komprimierte Einträge', async () => {
  const zip = makeZip([['a.txt', 'hallo', false], ['b/c.xml', '<x>ä</x>'.repeat(50), true]]);
  const entries = listZipEntries(zip);
  assert.deepEqual([...entries.keys()], ['a.txt', 'b/c.xml']);
  assert.equal(await readZipText(zip, entries, 'a.txt'), 'hallo');
  assert.equal(await readZipText(zip, entries, 'b/c.xml'), '<x>ä</x>'.repeat(50));
  assert.equal(await readZipText(zip, entries, 'fehlt'), null);
});

test('ZIP: keine ZIP-Datei', () => {
  assert.throws(() => listZipEntries(new TextEncoder().encode('kein zip').buffer), /Keine gültige Excel-Datei/);
});

test('xlsx: Spaltenbuchstaben, Entities und Sonderfälle', () => {
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('Z9'), 25);
  assert.equal(columnIndex('AA10'), 26);
  assert.equal(decodeXml('a &amp; b &lt;c&gt; &#228; &#x00FC; _x000D_'), 'a & b <c> ä ü \r');
  const shared = parseSharedStrings('<sst><si><t>VM</t></si><si><r><t>Fett</t></r><r><t xml:space="preserve"> Teil</t></r></si><si/></sst>');
  assert.deepEqual(shared, ['VM', 'Fett Teil', '']);
  const rows = parseSheet(
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row>' +
      '<row r="3"><c r="B3" t="b"><v>1</v></c><c r="C3"><v>42.5</v></c><c r="D3" s="1"/></row></sheetData>',
    shared,
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0], 'VM');
  assert.equal(rows[0][1], undefined);
  assert.equal(rows[0][2], 'inline');
  assert.deepEqual(rows[1], []);
  assert.equal(rows[2][1], true);
  assert.equal(rows[2][2], 42.5);
  assert.equal(rows[2][3], undefined);
});

test('xlsx: Beispielexport wird vollständig gelesen', async () => {
  const sheets = await readXlsx(fixture('beispiel.xlsx'));
  assert.ok(sheets.vInfo && sheets.vHost && sheets.vDisk && sheets.vSnapshot);
  assert.equal(sheets.vInfo[0][0], 'VM');
  assert.equal(sheets.vInfo.length, 41);
  const header = sheets.vHost[0];
  const host = sheets.vHost[1];
  assert.equal(host[header.indexOf('# CPU')], 2);
  assert.equal(host[header.indexOf('Cores per CPU')], 12);
});

test('CSV: Trennzeichen, Anführungszeichen, Zeilenenden', () => {
  assert.deepEqual(parseCsv('a;b;c\r\n1;"x;y";\n"mit ""Zitat"""'), [
    ['a', 'b', 'c'],
    ['1', 'x;y', undefined],
    ['mit "Zitat"'],
  ]);
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('CSV: Zeichensätze', () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a');
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0xe4, 0x00])), 'aä');
  assert.equal(decodeText(new Uint8Array([0x47, 0x72, 0xfc, 0xdf])), 'Grüß');
});

test('CSV: Blattname aus Dateiname', () => {
  assert.equal(sheetNameFromFile('RVTools_tabvInfo.csv'), 'vInfo');
  assert.equal(sheetNameFromFile('C:\\export\\RVTools_tabvHost.csv'), 'vHost');
  assert.equal(sheetNameFromFile('vsnapshot.csv'), 'vSnapshot');
  assert.equal(sheetNameFromFile('irgendwas.csv'), null);
});
