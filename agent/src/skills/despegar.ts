import { chromium } from 'playwright';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import type { ProviderResult } from '../agent/searchRuntime.js';
import { logEvent } from '../agent/searchRuntime.js';
import { selectDiverseQuotes } from '../agent/quotePolicy.js';
import { challenged, parseCard, verifiedPassengerCount } from './quoteParser.js';

export function buildDespegarSearchUrl(p: FlightSearchParams): string {
  if (![p.origin, p.destination].every(code => /^[A-Z]{3}$/.test(code))) throw new Error('Se requieren aeropuertos IATA explícitos');
  return `https://www.despegar.com.ar/shop/flights/results/roundtrip/${p.origin}/${p.destination}/${p.departureDate}/${p.returnDate}/${p.passengers}/0/0?from=SB&di=2&currency=USD`;
}

export async function collectDespegar(p: FlightSearchParams, options: { headless?: boolean } = {}): Promise<ProviderResult> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext({ locale: 'es-AR', viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    // A challenge on the home page ends the attempt, before another navigation.
    const home = await page.goto('https://www.despegar.com.ar/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (challenged(await page.locator('body').innerText(), home?.status())) return { status: 'blocked', options: [] };
    const response = await page.goto(buildDespegarSearchUrl(p), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const selector = 'flights-cluster, flights-cluster-component, .flights-cluster, .cluster-container, .cluster-content';
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    const body = await page.locator('body').innerText();
    if (challenged(body, response?.status())) return { status: 'blocked', options: [] };
    const results: ScrapedFlightOption[] = [];
    const passengerCount = verifiedPassengerCount(body);
    for (const card of await page.locator(selector).all()) {
      if (!await card.isVisible()) continue;
      const snapshot = await card.evaluate(element => {
        const clone = element.cloneNode(true) as HTMLElement;
        // Responsive alternatives and collapsed itineraries are not observed quotes.
        // Inspect computed styles on the live nodes before reading the detached clone.
        const originalNodes = [...element.querySelectorAll('*')];
        const clonedNodes = [...clone.querySelectorAll('*')];
        originalNodes.forEach((node, index) => {
          const style = getComputedStyle(node);
          if (node.matches('s, del, [class*="old-price"], [class*="original-price"], [class*="strik"], script, style')
            || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
            || style.textDecorationLine.includes('line-through')) clonedNodes[index].remove();
        });
        const airlineNames = [...clone.querySelectorAll('.airline-name, [class*="airline-name"], img[alt]')]
          .map(n => n instanceof HTMLImageElement ? n.alt : n.textContent || '')
          .filter(s => /aerom[eé]xico|aerol[ií]neas argentinas|iberia|air europa|latam|plus ultra|level|lufthansa|air france|klm|british|turkish|avianca|copa|ita air|american air|delta|united|arajet|jetsmart|flybondi|gol\b|azul|emirates|qatar|etihad|ethiopian|air canada|swiss|tap\b/i.test(s));
        // Trust labelled carrier fields for airlines beyond the image-logo fallback list.
        clone.querySelectorAll('.airline-name, [class*="airline-name"]').forEach(n => {
          if (n.textContent?.trim()) airlineNames.push(n.textContent.trim());
        });
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) parts.push(node.textContent || '');
        return { text: parts.join(' '), airlineNames };
      });
      const quote = parseCard('despegar', { ...snapshot, pagePassengerCount: passengerCount,
        bookingUrl: page.url(), collectedAt: new Date().toISOString() }, p);
      if (quote) results.push(quote);
    }
    const unique = [...new Map(results.map(q => [JSON.stringify([q.airline, q.priceTotalUSD, q.stops, q.paymentCondition]), q])).values()];
    return { status: unique.length ? 'ok' : /no encontramos vuelos|no hay vuelos disponibles/i.test(body) ? 'empty' : 'unverified', options: selectDiverseQuotes(unique) };
  } catch (error) {
    logEvent('provider.error', { provider: 'despegar', reason: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown' });
    return { status: 'error', options: [] };
  }
  finally { await browser.close(); }
}

export async function searchDespegarFlights(p: FlightSearchParams, options: { headless?: boolean } = {}) {
  return (await collectDespegar(p, options)).options;
}
