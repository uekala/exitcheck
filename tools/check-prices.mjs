// Meldet Preisannahmen, deren Stand älter als sechs Monate ist.
// Bricht den Build nicht ab: Preise ändern sich außerhalb des Projekts, der
// Hinweis soll an die Prüfung erinnern (siehe docs/preise.md).

import { PRICES, stalePrices } from '../src/prices.js';

const MAX_MONTHS = 6;
const stale = stalePrices(MAX_MONTHS);
const inCi = Boolean(process.env.GITHUB_ACTIONS);

for (const price of stale) {
  const message = `Preisannahme „${price.label}“ hat Stand ${price.asOf} und ist älter als ${MAX_MONTHS} Monate – bitte prüfen (docs/preise.md).`;
  console.log(inCi ? `::warning file=src/prices.js::${message}` : `Warnung: ${message}`);
}

console.log(`${Object.keys(PRICES).length} Preisannahmen geprüft, ${stale.length} älter als ${MAX_MONTHS} Monate.`);
