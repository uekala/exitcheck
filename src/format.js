// Formatierung für die Anzeige (deutsche Schreibweise) und sicheres HTML.

const numberFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const decimalFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const fmtNum = (n) => numberFmt.format(n ?? 0);
export const fmtDec = (n) => decimalFmt.format(n ?? 0);
export const fmtEuro = (n) => euroFmt.format(Math.round(n ?? 0));

export function fmtSize(mib) {
  const gib = (mib ?? 0) / 1024;
  if (gib >= 1024) return `${decimalFmt.format(gib / 1024)} TiB`;
  return `${numberFmt.format(gib)} GiB`;
}

export function fmtHours(hours) {
  if (hours == null) return '–';
  if (hours < 1) return `${numberFmt.format(hours * 60)} Minuten`;
  return `${decimalFmt.format(hours)} Stunden`;
}

export function fmtDateDe(d) {
  if (!d) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function plural(n, one, many) {
  return `${fmtNum(n)} ${n === 1 ? one : many}`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class Raw {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

/** Bereits sicheres HTML, das nicht erneut maskiert wird. */
export const raw = (text) => new Raw(text);

/** Template-Tag: maskiert alle eingesetzten Werte außer raw(...) und Listen davon. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    const parts = Array.isArray(value) ? value : [value];
    for (const part of parts) {
      if (part === false || part === null || part === undefined) continue;
      out += part instanceof Raw ? part.text : esc(part);
    }
    out += strings[i + 1];
  });
  return raw(out);
}
