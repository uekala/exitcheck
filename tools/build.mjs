// Baut eine einzige HTML-Datei (dist/index.html), die ohne Server und ohne Internet läuft.
// Die ES-Module aus src/ werden in festgelegter Reihenfolge zu einem Skript zusammengesetzt;
// die Content-Security-Policy erlaubt genau dieses Skript und dieses Stylesheet (per Hash).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP } from '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const base64 = (path) => readFileSync(join(root, path)).toString('base64');

const MODULES = [
  'config', 'values', 'os', 'zip', 'xlsx', 'csv', 'rvtools', 'rules', 'env', 'costs', 'analyse', 'format', 'app',
];

function bundle() {
  const parts = ['"use strict";'];
  for (const name of MODULES) {
    let code = read(`src/${name}.js`);
    const exported = [];
    code = code.replace(/^import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)\.js';\s*$/gm, (_, names, from) => {
      if (!MODULES.includes(from)) throw new Error(`Unbekanntes Modul ${from} in ${name}`);
      const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
      return `const { ${list.join(', ')} } = __mod_${from.replace(/-/g, '_')};`;
    });
    if (/^\s*import\s/m.test(code)) throw new Error(`Nicht unterstützter Import in ${name}`);
    code = code.replace(/^export\s+(async\s+function|function|const|let|class)\s+([\w$]+)/gm, (_, kind, id) => {
      exported.push(id);
      return `${kind} ${id}`;
    });
    if (/^export\s/m.test(code)) throw new Error(`Nicht unterstützter Export in ${name}`);
    parts.push(`const __mod_${name} = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();`);
  }
  return parts.join('\n');
}

function sha256(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

export function build() {
  const fonts = {
    FONT_BARLOW_400: 'assets/fonts/barlow-latin-400-normal.woff2',
    FONT_BARLOW_600: 'assets/fonts/barlow-latin-600-normal.woff2',
    FONT_BARLOW_SC_600: 'assets/fonts/barlow-semi-condensed-latin-600-normal.woff2',
    FONT_BARLOW_SC_700: 'assets/fonts/barlow-semi-condensed-latin-700-normal.woff2',
  };
  let style = read('src/styles.css');
  for (const [key, path] of Object.entries(fonts)) {
    style = style.replace(`{{${key}}}`, `data:font/woff2;base64,${base64(path)}`);
  }
  // Schließende Tags dürfen im eingebetteten Skript nicht vorkommen
  const script = bundle().replace(/<\/(script)/gi, '<\\/$1');
  const csp = [
    "default-src 'none'",
    `script-src ${sha256(script)}`,
    `style-src ${sha256(style)}`,
    'font-src data:',
    'img-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');

  const replacements = {
    CSP: csp,
    APP_NAME: APP.name,
    SLUG: APP.slug,
    VERSION: APP.version,
    REPO_URL: APP.repo,
    EXAMPLE: base64('tests/fixtures/beispiel.xlsx'),
  };
  let page = read('src/index.html');
  for (const [key, value] of Object.entries(replacements)) page = page.split(`{{${key}}}`).join(value);
  // Stil und Skript zuletzt einsetzen, damit deren Inhalt nicht ersetzt wird
  page = page.replace('{{STYLE}}', () => style).replace('{{SCRIPT}}', () => script);
  if (/\{\{[A-Z_0-9]+\}\}/.test(page)) throw new Error('Platzhalter nicht ersetzt');

  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/index.html'), page);
  return { bytes: Buffer.byteLength(page), csp };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { bytes } = build();
  console.log(`dist/index.html geschrieben (${Math.round(bytes / 1024)} KB)`);
}
