import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';

chromium.use(stealthPlugin());

export function buildDespegarSearchUrl(params: FlightSearchParams): string {
  const origin = params.origin.toUpperCase();
  const dest = params.destination.toUpperCase();
  return `https://www.despegar.com.ar/vuelos/results/roundtrip/${origin}/${dest}/${params.departureDate}/${params.returnDate}/${params.passengers}/0/0`;
}

export async function searchDespegarFlights(
  params: FlightSearchParams,
  options: { headless?: boolean } = {}
): Promise<ScrapedFlightOption[]> {
  const isHeadless = options.headless ?? (process.env.HEADLESS !== 'false');
  const url = buildDespegarSearchUrl(params);

  console.log(`\n[Skill: Despegar] 🔍 Comparando tarifa en Despegar para ${params.passengers} personas...`);
  console.log(`  URL: ${url}`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'es-AR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50000 });

    // Esperar a que carguen los resultados o la lista de vuelos
    console.log(`[Skill: Despegar] Esperando cotización de vuelos...`);
    await page.waitForTimeout(4000);

    // Intentar buscar tarjetas de vuelo en Despegar
    const priceLocators = page.locator('span.amount, span.price-amount, .main-value, [class*="price"]').first();
    let bestPriceUSD = 0;
    let priceRaw = '';

    if (await priceLocators.isVisible({ timeout: 15000 })) {
      priceRaw = await priceLocators.innerText();
      // En Despegar AR suele estar en ARS o USD. Si está en ARS con números grandes:
      const numericVal = parseInt(priceRaw.replace(/[^\d]/g, ''), 10);
      if (numericVal > 0) {
        // Si el precio supera los 100.000, está en ARS. Convertimos con un tipo de cambio estimado (ej. Dólar tarjeta/MEP ~1350)
        if (numericVal > 100000) {
          bestPriceUSD = Math.round(numericVal / 1350);
        } else {
          bestPriceUSD = numericVal;
        }
      }
    }

    const results: ScrapedFlightOption[] = [];
    if (bestPriceUSD > 0) {
      results.push({
        source: 'despegar',
        airline: 'Varios / Despegar',
        route: `${params.origin} - ${params.destination}`,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        stops: 1,
        priceTotalUSD: bestPriceUSD,
        priceRawText: priceRaw || `US$ ${bestPriceUSD}`,
        bookingUrl: url,
        collectedAt: new Date().toISOString()
      });
      console.log(`[Skill: Despegar] ✅ Tarifa detectada: ~US$ ${bestPriceUSD} (${priceRaw})`);
    } else {
      console.log(`[Skill: Despegar] ℹ️ Link directo de comparación generado para ${params.passengers} personas.`);
    }

    return results;
  } catch (error) {
    console.log(`[Skill: Despegar] ⚠️ Nota: Despegar requirió verificación o demoró en responder. Link de reserva generado: ${url}`);
    return [];
  } finally {
    await browser.close();
  }
}
