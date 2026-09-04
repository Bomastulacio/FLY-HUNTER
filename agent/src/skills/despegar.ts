import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';

chromium.use(stealthPlugin());

export function buildDespegarSearchUrl(params: FlightSearchParams): string {
  const origin = (params.origin.length === 3 ? params.origin : 'EZE').toUpperCase();
  let dest = params.destination.toUpperCase();
  const COUNTRY_MAP: Record<string, string> = {
    'ESPAÑA': 'MAD', 'ESPANA': 'MAD', 'SPAIN': 'MAD',
    'FRANCIA': 'CDG', 'FRANCE': 'CDG',
    'ITALIA': 'FCO', 'ITALY': 'FCO',
    'REINO UNIDO': 'LHR', 'UK': 'LHR',
    'ALEMANIA': 'FRA', 'GERMANY': 'FRA',
    'PORTUGAL': 'LIS'
  };
  if (COUNTRY_MAP[dest]) {
    dest = COUNTRY_MAP[dest];
  } else if (dest.length !== 3) {
    dest = 'MAD';
  }
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=es-419,es'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'es-AR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'es-419,es;q=0.9,en;q=0.8'
    }
  });

  const page = await context.newPage();

  try {
    // 1. Calentamiento de sesión (Warm Session): pasar por la home para inicializar cookies anti-bot legítimas
    try {
      console.log(`[Skill: Despegar] 🛡️ Calentando sesión anti-bot...`);
      await page.goto('https://www.despegar.com.ar/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
    } catch {
      // Si la portada tarda, continuamos hacia la búsqueda directamente
    }

    // 2. Navegación con referer simulando navegación natural
    console.log(`[Skill: Despegar] Navegando a resultados de vuelos...`);
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 50000, 
      referer: 'https://www.despegar.com.ar/' 
    });

    // Esperar a que carguen los resultados o la lista de vuelos con un breve jitter
    console.log(`[Skill: Despegar] Esperando cotización de vuelos...`);
    await page.waitForSelector('span.amount, span.price-amount, .main-value, [class*="price-info"], [class*="flights-cluster"], .cluster-content', { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(3000 + Math.floor(Math.random() * 2000));

    // Intentar extraer el nombre de la aerolínea
    let detectedAirline = 'Varios / Despegar';
    try {
      const airlineLocator = page.locator('.airline-name, [class*="airline"], span:has-text("Aerolíneas"), span:has-text("Iberia"), span:has-text("Air Europa"), span:has-text("LATAM")').first();
      if (await airlineLocator.isVisible({ timeout: 4000 })) {
        const aText = await airlineLocator.innerText();
        if (aText && aText.trim().length > 0) {
          detectedAirline = aText.trim();
        }
      }
    } catch {
      // Usar aerolínea por defecto si no es visible
    }

    // Intentar buscar tarjetas de vuelo en Despegar
    const priceLocators = page.locator('span.amount, span.price-amount, .main-value, [class*="amount"]:not([class*="old"]), [class*="price"], .landing-inline-price').first();
    let bestPriceUSD = 0;
    let priceRaw = '';

    if (await priceLocators.isVisible({ timeout: 15000 })) {
      priceRaw = await priceLocators.innerText();
      // Limpieza de texto: "US$ 2.135" -> "2135"
      const numericVal = parseInt(priceRaw.replace(/[^\d]/g, ''), 10);
      if (numericVal > 0) {
        // Si el precio supera los 100.000, está expresado en ARS. Convertir al dólar tarjeta/financiero (~1350)
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
        airline: detectedAirline,
        route: `${params.origin} - ${params.destination}`,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        stops: 0,
        priceTotalUSD: bestPriceUSD,
        priceRawText: priceRaw || `US$ ${bestPriceUSD}`,
        bookingUrl: url,
        collectedAt: new Date().toISOString()
      });
      console.log(`[Skill: Despegar] ✅ Tarifa detectada: ~US$ ${bestPriceUSD} (${priceRaw}) en ${detectedAirline}`);
    } else {
      console.log(`[Skill: Despegar] ℹ️ Selector inmediato no detectado en página. Generado link de reserva oficial: ${url}`);
    }

    return results;
  } catch (error) {
    console.log(`[Skill: Despegar] ⚠️ Despegar requirió verificación o demoró en responder. Link de reserva generado: ${url}`);
    return [];
  } finally {
    await browser.close();
  }
}
