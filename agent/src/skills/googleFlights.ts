import { chromium, type Page } from 'playwright';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import type { ProviderResult } from '../agent/searchRuntime.js';
import { selectDiverseQuotes } from '../agent/quotePolicy.js';
import { challenged, verifiedPassengerCount, escapeRegex } from './quoteParser.js';
import { parseGoogleResult } from './googleQuote.js';

const IATA_REGEX = /^[A-Z]{3}$/;
// Google serves both Spanish translations. Match the same cheapest view, never Recommended.
const CHEAPEST_NAME = /Los más bajos|Más económicos/i;

export function buildGoogleFlightsUrl(p: FlightSearchParams): string {
  const origin = (p.origin || '').trim().toUpperCase();
  const destination = (p.destination || '').trim().toUpperCase();
  const query = `Flights from ${origin} to ${destination} on ${p.departureDate} through ${p.returnDate} for ${p.passengers} adults`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&curr=USD&hl=es`;
}

export async function collectGoogleFlights(p: FlightSearchParams, options: { headless?: boolean } = {}): Promise<ProviderResult> {
  const originCode = (p.origin || '').trim().toUpperCase();
  const destCode = (p.destination || '').trim().toUpperCase();
  if (!IATA_REGEX.test(originCode) || !IATA_REGEX.test(destCode)) {
    return { status: 'error', options: [], reason: 'invalid_iata_code' };
  }

  const browser = await chromium.launch({ headless: options.headless ?? true });
  let page: Page | undefined;
  let stage = 'navigation';
  try {
    const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    const response = await page.goto(buildGoogleFlightsUrl(p), { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (challenged(await page.locator('body').innerText(), response?.status())) return { status: 'blocked', options: [] };
    const cookies = page.getByRole('button', { name: /^(Aceptar todo|Accept all|Acepto)$/ }).first();
    if (await cookies.isVisible()) await cookies.click();
    stage = 'cheapest_tab';
    const cheapest = page.getByRole('tab', { name: CHEAPEST_NAME });
    await cheapest.waitFor({ state: 'visible', timeout: 25000 });
    stage = 'initial_results_loading';
    await page.locator('[role="progressbar"]:visible').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    // The Best view exposes exact ISO dates in its price-tracking control.
    // Cheapest omits that control: validate first and check inputs stay unchanged.
    stage = 'date_controls';
    const depDateEsc = escapeRegex(p.departureDate);
    const retDateEsc = escapeRegex(p.returnDate);
    const dates = page.getByRole('switch', { name: new RegExp(`salida el ${depDateEsc} y vuelta el ${retDateEsc}`) });
    if (!await dates.count()) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (challenged(body)) return { status: 'blocked', options: [] };
      return { status: 'unverified', options: [], reason: 'exact_dates_not_verified' };
    }
    const departureInput = page.getByRole('textbox', { name: 'Salida', exact: true });
    const returnInput = page.getByRole('textbox', { name: 'Vuelta', exact: true });
    const departureValue = await departureInput.inputValue();
    const returnValue = await returnInput.inputValue();
    stage = 'cheapest_selection';
    if (await cheapest.getAttribute('aria-selected') !== 'true') await cheapest.click();
    const panel = page.getByRole('tabpanel', { name: CHEAPEST_NAME });
    await panel.waitFor({ state: 'visible', timeout: 25000 });
    // A selected tab may still contain provisional fares while Google is loading.
    stage = 'cheapest_results_loading';
    await panel.locator('[role="progressbar"]:visible').first().waitFor({ state: 'hidden', timeout: 25000 });
    const body = await page.locator('body').innerText();
    if (challenged(body)) return { status: 'blocked', options: [] };
    stage = 'query_verification';
    const pagePassengerCount = verifiedPassengerCount(await panel.innerText());
    const origin = page.getByRole('combobox', { name: new RegExp(`Desde dónde.*\\b${escapeRegex(originCode)}\\b`) });
    const destination = page.getByRole('combobox', { name: new RegExp(`dónde quieres ir.*\\b${escapeRegex(destCode)}\\b`) });
    if (await cheapest.getAttribute('aria-selected') !== 'true' || pagePassengerCount !== p.passengers
      || !await origin.count() || !await destination.count()
      || await departureInput.inputValue() !== departureValue || await returnInput.inputValue() !== returnValue) {
      return { status: 'unverified', options: [], reason: 'search_controls_mismatch' };
    }
    stage = 'result_rows';
    const results: ScrapedFlightOption[] = [];
    // Read the full loaded list; Aerolíneas Argentinas may appear beyond the first five cards.
    for (const card of await panel.locator('li.pIav2d, ul.Rk10dc > li').all()) {
      if (!await card.isVisible()) continue;
      const links = card.getByRole('link', { name: /^A partir de .*Seleccionar vuelo$/ });
      if (await links.count() !== 1) continue;
      const label = await links.getAttribute('aria-label') || '';
      const visiblePrices = await card.locator('[role="text"][aria-label$="dólares estadounidenses"]:visible').allInnerTexts();
      const quote = parseGoogleResult({ label, visiblePrices, passengers: pagePassengerCount,
        bookingUrl: page.url(), collectedAt: new Date().toISOString() }, p);
      if (quote) results.push(quote);
    }
    return { status: results.length ? 'ok' : /no se encontraron vuelos|no hay vuelos/i.test(body) ? 'empty' : 'unverified', options: selectDiverseQuotes(results), reason: results.length ? undefined : 'no_verified_rows' };
  } catch (error) {
    // Challenges can arrive after DOMContentLoaded while waiting for result controls.
    // Preserve the blocked status so the runtime applies its durable source cooldown.
    const body = await page?.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (body && challenged(body)) return { status: 'blocked', options: [] };
    return { status: 'error', options: [], reason: error instanceof Error && error.name === 'TimeoutError' ? 'page_timeout' : 'extraction_error', stage };
  }
  finally { await browser.close(); }
}

// Paid lookups have one owner: Python's collector and persisted quota ledger.
export async function searchGoogleFlights(p: FlightSearchParams, options: { headless?: boolean } = {}) {
  return (await collectGoogleFlights(p, options)).options;
}
