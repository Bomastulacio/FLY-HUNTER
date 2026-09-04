import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';

chromium.use(stealthPlugin());

export function buildDespegarSearchUrl(params: FlightSearchParams): string {
  let origin = (params.origin.length === 3 ? params.origin : 'BUE').toUpperCase();
  if (['EZE', 'AEP'].includes(origin) || origin.includes('EZE') || origin.includes('AEP')) {
    origin = 'BUE';
  }
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
  return `https://www.despegar.com.ar/shop/flights/results/roundtrip/${origin}/${dest}/${params.departureDate}/${params.returnDate}/${params.passengers}/0/0?from=SB&di=2&currency=USD`;
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
    await page.waitForSelector('span.amount, span.price-amount, .main-value, [class*="price-info"], [class*="flights-cluster"], .cluster-content, [data-test-id*="price"]', { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(4000 + Math.floor(Math.random() * 2000));

    // Detectar si saltó pantalla de verificación anti-bot (Cloudflare / DataDome)
    const pageText = await page.innerText('body').catch(() => '');
    const isChallenged = pageText.includes('Verification Required') || pageText.includes('Slide right to secure') || pageText.includes('unusual activity');

    // Intentar extraer el nombre de la aerolínea
    let detectedAirline = 'Aerolíneas Argentinas';
    try {
      const airlineLocator = page.locator('.airline-name, [class*="airline"], span:has-text("Aerolíneas"), span:has-text("Aerolineas"), span:has-text("Iberia"), span:has-text("Air Europa"), span:has-text("LATAM"), span:has-text("Plus Ultra")').first();
      if (await airlineLocator.isVisible({ timeout: 4000 })) {
        const aText = await airlineLocator.innerText();
        if (aText && aText.trim().length > 0) {
          detectedAirline = aText.trim();
        }
      } else if (pageText.includes('Aerolíneas') || pageText.includes('Aerolineas')) {
        detectedAirline = 'Aerolíneas Argentinas';
      }
    } catch {
      // Usar aerolínea por defecto
    }

    // Intentar buscar tarjetas de vuelo en Despegar
    let bestPriceUSD = 0;
    let priceRaw = '';

    const priceLocators = page.locator('span.amount, span.price-amount, .main-value, [class*="amount"]:not([class*="old"]), [class*="price"], .landing-inline-price, [data-test-id*="price"]').first();

    if (await priceLocators.isVisible({ timeout: 10000 }).catch(() => false)) {
      priceRaw = await priceLocators.innerText();
    } else {
      // Intentar regex sobre el texto de la página por si los elementos cambian de clase
      const usdMatch = pageText.match(/US\$\s*([\d\.,]+)/i);
      if (usdMatch && usdMatch[1]) {
        priceRaw = `US$ ${usdMatch[1]}`;
      }
    }

    if (priceRaw) {
      // Limpieza de texto: "US$ 2.135" -> "2135"
      const cleanNum = priceRaw.replace(/US\$/i, '').replace(/\./g, '').replace(/,/g, '').trim();
      const numericVal = parseInt(cleanNum, 10);
      if (numericVal > 0) {
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
    } else if (isChallenged) {
      console.log(`[Skill: Despegar] 🛡️ Despegar activó verificación anti-bot en el runner. Link de reserva generado: ${url}`);
    } else {
      console.log(`[Skill: Despegar] ℹ️ Selector inmediato no detectado en página. Generado link de reserva oficial: ${url}`);
    }

    return results;
  } catch (error) {
    console.log(`[Skill: Despegar] ⚠️ Despegar demoró en responder. Link de reserva generado: ${url}`);
    return [];
  } finally {
    await browser.close();
  }
}

