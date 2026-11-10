import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { defaultSettings, PROXMOX_LEVELS, VMWARE_PRODUCTS } from '../src/costs.js';
import { ageInMonths, asOfLabel, PRICES, priceSources, stalePrices } from '../src/prices.js';

test('jede Preisannahme hat Wert, Währung, Stand und Quelle', () => {
  for (const [id, price] of Object.entries(PRICES)) {
    assert.ok(price.label, `${id}: label`);
    assert.ok(Number.isFinite(price.value) && price.value > 0, `${id}: value`);
    assert.ok(['EUR', 'USD', null].includes(price.currency), `${id}: currency`);
    assert.match(price.asOf, /^20\d\d-(0[1-9]|1[0-2])$/, `${id}: asOf`);
    assert.ok(['official', 'reported', 'survey'].includes(price.kind), `${id}: kind`);
    assert.ok(price.source?.title, `${id}: source.title`);
    assert.match(price.source.url, /^https:\/\/[^\s]+$/, `${id}: source.url`);
    if (price.kind !== 'official') assert.ok(price.note, `${id}: nicht offizielle Angaben brauchen eine Erklärung`);
  }
});

test('Kostenmodell übernimmt die Werte aus der Preistabelle', () => {
  assert.equal(VMWARE_PRODUCTS.vcf.price, PRICES.vmwareVcf.value);
  assert.equal(VMWARE_PRODUCTS.vvf.price, PRICES.vmwareVvf.value);
  assert.equal(VMWARE_PRODUCTS.vvs.price, PRICES.vmwareVvs.value);
  assert.deepEqual(
    Object.values(PROXMOX_LEVELS).map((level) => level.price),
    [PRICES.proxmoxCommunity, PRICES.proxmoxBasic, PRICES.proxmoxStandard, PRICES.proxmoxPremium].map((p) => p.value),
  );
  const s = defaultSettings();
  assert.equal(s.vmwarePricePerCore, PRICES.vmwareVvf.value);
  assert.equal(s.proxmoxPricePerSocket, PRICES.proxmoxBasic.value);
  assert.equal(s.hypervPricePerCore, Math.round(PRICES.windowsServerStandard.value / 16));
  assert.equal(s.rate, PRICES.hourlyRate.value);
  // Die gemeldete Mindestmenge ist nicht bestätigt und wird nicht automatisch eingerechnet.
  assert.equal(s.vmwareMinOrderCores, 0);
});

test('bisherige Vorgabewerte bleiben unverändert', () => {
  const s = defaultSettings();
  assert.deepEqual(
    [s.vmwarePricePerCore, s.proxmoxPricePerSocket, s.hypervPricePerCore, s.rate],
    [135, 370, 74, 95],
  );
});

test('Stand wird lesbar und das Alter in Monaten berechnet', () => {
  assert.equal(asOfLabel('2026-10'), 'Oktober 2026');
  assert.equal(asOfLabel('2027-01'), 'Januar 2027');
  const today = new Date('2027-05-15T12:00:00Z');
  assert.equal(ageInMonths('2026-11', today), 6);
  assert.equal(ageInMonths('2026-10', today), 7);
});

test('veraltete Preise werden erkannt', () => {
  assert.deepEqual(stalePrices(6, new Date('2026-11-10T12:00:00Z')), []);
  const later = stalePrices(6, new Date('2027-05-15T12:00:00Z')).map((p) => p.id);
  assert.ok(later.includes('proxmoxBasic'));
  assert.ok(later.includes('hourlyRate'));
  assert.ok(!later.includes('vmwareVcf'));
});

test('Quellen erscheinen je Adresse nur einmal', () => {
  const sources = priceSources();
  const urls = sources.map((s) => s.url);
  assert.equal(new Set(urls).size, urls.length);
  const proxmox = sources.find((s) => s.url.includes('proxmox.com'));
  assert.equal(proxmox.labels.length, 4);
  assert.equal(proxmox.asOf, '2026-10');
});

test('die Oberfläche nennt keine Preise an der Preistabelle vorbei', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  for (const literal of ['1.176', '1176', 'VCF 350', 'Stand Oktober 2026', '72 Kerne', 'proxmox.com/proxmox-ve/pricing']) {
    assert.ok(!app.includes(literal), `app.js enthält fest eingetragenes „${literal}“`);
  }
});
