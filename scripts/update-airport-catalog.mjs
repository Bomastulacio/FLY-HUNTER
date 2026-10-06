// Explicit maintenance command, never called by a search, page view or cron.
// OurAirports public-domain snapshot: geography, NOT route availability.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

function csv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.filter(r => r.length === headers.length).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
// Use the original maintainer, not a route or fare provider.
const url = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const response = await fetch(url);
if (!response.ok) throw new Error(`Airport download failed: ${response.status}`);
const text = await response.text();
const airports = {};
for (const a of csv(text)) {
  if (!/^[A-Z]{3}$/.test(a.iata_code) || a.type === 'closed') continue;
  if (airports[a.iata_code]) throw new Error(`Duplicate airport code: ${a.iata_code}`);
  // Compact tuples avoid shipping unused coordinates/names to every web client.
  airports[a.iata_code] = [a.iso_country, a.municipality, a.scheduled_service === 'yes' ? 1 : 0];
}
if (Object.keys(airports).length < 3000 || !airports.AEP || !airports.EZE) throw new Error('Incomplete airport snapshot');
const path = new URL('../shared/radar-geography.json', import.meta.url);
const catalog = JSON.parse(await readFile(path, 'utf8'));
catalog.version = 2;
catalog.airportSource = { url, license: 'Public Domain', retrievedAt: new Date().toISOString(),
  sha256: createHash('sha256').update(text).digest('hex'), scope: 'Geography only; no route feasibility guarantees' };
catalog.airports = Object.fromEntries(Object.entries(airports).sort(([a], [b]) => a.localeCompare(b)));
catalog.airportFields = ['country', 'city', 'scheduled'];
const locales = ['es', 'en'];
catalog.countryAliases = {};
for (const country of [...new Set(Object.values(airports).map(a => a[0]))].sort()) {
  catalog.countryAliases[country] = [country, ...locales.map(locale => new Intl.DisplayNames([locale], { type: 'region' }).of(country))];
}
await writeFile(path, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Updated ${Object.keys(airports).length} airports from OurAirports (${catalog.airportSource.sha256}).`);
