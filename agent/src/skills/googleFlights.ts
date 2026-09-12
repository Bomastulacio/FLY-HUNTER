import { chromium } from 'playwright';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import type { ProviderResult } from '../agent/searchRuntime.js';
import { selectDiverseQuotes } from '../agent/quotePolicy.js';
import { challenged, parseCard, verifiedPassengerCount } from './quoteParser.js';

export function buildGoogleFlightsUrl(p: FlightSearchParams): string {
  const query = `Flights from ${p.origin} to ${p.destination} on ${p.departureDate} through ${p.returnDate} for ${p.passengers} adults`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&curr=USD&hl=es`;
}

export async function collectGoogleFlights(p: FlightSearchParams, options: { headless?: boolean } = {}): Promise<ProviderResult> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const response = await page.goto(buildGoogleFlightsUrl(p), { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (challenged(await page.locator('body').innerText(), response?.status())) return { status: 'blocked', options: [] };
    const cookies = page.getByRole('button', { name: /^(Aceptar todo|Accept all|Acepto)$/ }).first();
    if (await cookies.isVisible()) await cookies.click();
    await page.locator('li.pIav2d, ul.Rk10dc > li').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
    const body = await page.locator('body').innerText();
    if (challenged(body)) return { status: 'blocked', options: [] };
    const pagePassengerCount = verifiedPassengerCount(body);
    const results: ScrapedFlightOption[] = [];
    // Read the full loaded list; Aerolíneas Argentinas may appear beyond the first five cards.
    for (const card of await page.locator('li.pIav2d, ul.Rk10dc > li').all()) {
      const text = await card.innerText();
      const airlineNames = await card.locator('.sSHqwe, [data-airline-name], img[alt]').evaluateAll(elements =>
        elements.map(n => n instanceof HTMLImageElement ? n.alt : n.textContent || '')
          .filter(s => !!s.trim() && !/emisiones|CO2|equipaje|logo de vuelo/i.test(s)));
      const quote = parseCard('google_flights', { text, airlineNames, pagePassengerCount,
        bookingUrl: page.url(), collectedAt: new Date().toISOString() }, p);
      if (quote) results.push(quote);
    }
    return { status: results.length ? 'ok' : /no se encontraron vuelos|no hay vuelos/i.test(body) ? 'empty' : 'unverified', options: selectDiverseQuotes(results) };
  } catch { return { status: 'error', options: [] }; }
  finally { await browser.close(); }
}

// Paid lookups have one owner: Python's collector and persisted quota ledger.
export async function searchGoogleFlights(p: FlightSearchParams, options: { headless?: boolean } = {}) {
  return (await collectGoogleFlights(p, options)).options;
}
