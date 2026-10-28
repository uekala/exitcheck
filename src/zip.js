// Liest ZIP-Archive (xlsx-Dateien sind ZIP-Archive) ohne fremde Bibliotheken.
// Entpackt wird mit DecompressionStream, das moderne Browser und Node mitbringen.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class ZipError extends Error {}

function findEndOfCentralDirectory(view) {
  const minimum = 22;
  const maxComment = 0xffff;
  const start = Math.max(0, view.byteLength - minimum - maxComment);
  for (let i = view.byteLength - minimum; i >= start; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new ZipError('Keine gültige Excel-Datei (ZIP-Verzeichnis fehlt).');
}

export function listZipEntries(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff) {
    throw new ZipError('ZIP64-Archive werden nicht unterstützt.');
  }
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let pos = dirOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new ZipError('Beschädigtes ZIP-Verzeichnis.');
    }
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, pos + 46, nameLength));
    entries.set(name, { name, method, compressedSize, size, localOffset });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntry(buffer, entry) {
  const view = new DataView(buffer);
  const pos = entry.localOffset;
  if (view.getUint32(pos, true) !== SIG_LOCAL) {
    throw new ZipError(`Eintrag ${entry.name} ist beschädigt.`);
  }
  const nameLength = view.getUint16(pos + 26, true);
  const extraLength = view.getUint16(pos + 28, true);
  const start = pos + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, start, entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (entry.method === 8) return inflateRaw(data);
  throw new ZipError(`Kompressionsverfahren ${entry.method} wird nicht unterstützt.`);
}

export async function readZipText(buffer, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  return new TextDecoder('utf-8').decode(await readZipEntry(buffer, entry));
}
