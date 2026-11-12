// Browser-Test der gebauten Seite mit Playwright (nicht Teil von "npm test").
// Aufruf: npm run build && node tests/browser.e2e.mjs [Ordner für Bildschirmfotos]

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const page_url = new URL('../dist/index.html', import.meta.url).href;
const fixture = fileURLToPath(new URL('./fixtures/beispiel.xlsx', import.meta.url));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
page.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });
page.on('pageerror', (err) => problems.push(err.message));
const requests = [];
page.on('request', (req) => { if (!req.url().startsWith('file:') && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) requests.push(req.url()); });

await page.goto(page_url);
if (shots) await page.screenshot({ path: `${shots}/1-start.png`, fullPage: true });

// Eigene Datei hochladen
await page.setInputFiles('#file-input', fixture);
await page.waitForSelector('#report:not([hidden]) .fleet');
const verdict = await page.textContent('#summary-out .verdict-line');
assert.match(verdict, /Von 40 VMs ziehen 37 um/);
assert.match(await page.textContent('#head-out'), /vcenter\.muster\.local/);
if (shots) await page.screenshot({ path: `${shots}/2-bericht.png`, fullPage: true });

// Aufräumen
const cleanup = await page.textContent('#cleanup-out');
assert.match(cleanup, /Konsolidierung nötig/);
assert.match(cleanup, /Snapshots älter als 3 Tage/);
assert.match(cleanup, /alt-crm\.vmdk/);
assert.match(cleanup, /Thick-Disks mit viel freiem Platz/);
assert.match(cleanup, /Gewinn \(geschätzt\)/);
assert.match(await page.textContent('#summary-out .facts'), /Zum Aufräumen/);
await page.click('#aufraeumen summary');
await page.fill('[data-setting="snapshotDays"]', '500');
assert.doesNotMatch(await page.textContent('#cleanup-out'), /Snapshots älter als/);
await page.fill('[data-setting="snapshotDays"]', '3');
const [cleanupDownload] = await Promise.all([page.waitForEvent('download'), page.click('#cleanup-csv')]);
const cleanupCsv = readFileSync(await cleanupDownload.path(), 'utf8');
assert.match(cleanupCsv, /^\uFEFFStufe;Fundstelle;Art;Name/);
assert.match(cleanupCsv, /Dringend;Konsolidierung nötig;VM;file01/);

// Filter und Detailzeile
await page.click('[data-filter="block"]');
assert.equal(await page.locator('#vm-out tbody tr').count(), 4);
await page.click('[data-vm]');
await page.waitForSelector('tr.detail');
assert.match(await page.textContent('tr.detail'), /Was tun/);

// Ziel umschalten
await page.click('[data-target="hyperv"]');
assert.equal(await page.getAttribute('[data-target="hyperv"]', 'aria-pressed'), 'true');
assert.match(await page.textContent('#groups-out'), /Hyper-V kann USB-Geräte|USB-Gerät durchgereicht/);

// Annahme ändern
await page.click('#kosten summary');
await page.fill('[data-setting="vmwarePricePerCore"]', '200');
assert.equal(await page.inputValue('[data-setting="vmwareProduct"]'), 'custom');
assert.match(await page.textContent('#costs-out'), /128.000/); // 128 Kerne × 200 € × 5 Jahre

// Namen ausblenden
await page.check('#anonymize');
const body = await page.textContent('#report');
for (const secret of ['sql01', 'esx01.muster.local', 'vcenter.muster.local', 'NFS+Archiv', 'Aussenstelle', 'SAN-02', 'file01', 'alt-crm', 'test-migration']) {
  assert.ok(!body.includes(secret), `Name sichtbar trotz Ausblenden: ${secret}`);
}

// CSV
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
const csv = readFileSync(await download.path(), 'utf8');
assert.match(csv, /^﻿VM;Status;Betriebssystem/);
assert.ok(!csv.includes('sql01'));
const [cleanupHidden] = await Promise.all([page.waitForEvent('download'), page.click('#cleanup-csv')]);
const cleanupHiddenCsv = readFileSync(await cleanupHidden.path(), 'utf8');
for (const secret of ['file01', 'SAN-02', 'NFS+Archiv', 'alt-crm']) assert.ok(!cleanupHiddenCsv.includes(secret), `Name in Aufräumliste: ${secret}`);

// Beispieldaten und Handy-Breite
await page.click('#again');
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#example');
await page.waitForSelector('#report:not([hidden]) .fleet');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
assert.ok(overflow <= 0, `Seite scrollt waagerecht um ${overflow}px`);
if (shots) await page.screenshot({ path: `${shots}/3-handy.png`, fullPage: true });

// Dunkles Farbschema
await page.emulateMedia({ colorScheme: 'dark' });
await page.setViewportSize({ width: 1360, height: 900 });
if (shots) await page.screenshot({ path: `${shots}/4-dunkel.png` });

assert.deepEqual(problems, [], `Fehler in der Konsole: ${problems.join(' | ')}`);
assert.deepEqual(requests, [], `Unerwartete Netzwerkzugriffe: ${requests.join(', ')}`);
await browser.close();
console.log('Browser-Test bestanden');
