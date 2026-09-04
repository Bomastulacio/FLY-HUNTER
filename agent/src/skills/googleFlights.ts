import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';

// Activar evasión de detección de bots
chromium.use(stealthPlugin());

export async function searchGoogleFlights(
  params: FlightSearchParams,
  options: { headless?: boolean } = {}
): Promise<ScrapedFlightOption[]> {
  const isHeadless = options.headless ?? (process.env.HEADLESS !== 'false');
  console.log(`\n[Skill: Google Flights] 🔍 Iniciando búsqueda para ${params.passengers} personas...`);
  console.log(`  Ruta: ${params.origin} ✈️ ${params.destination}`);
  console.log(`  Fechas: ${params.departureDate} al ${params.returnDate}`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=es-419,es']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'es-419',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // Google Flights URL construida con consulta en lenguaje natural que fija automáticamente los N pasajeros
    const encodedQuery = encodeURIComponent(
      `Flights to ${params.destination} from ${params.origin} on ${params.departureDate} through ${params.returnDate} for ${params.passengers} adults`
    );
    const searchUrl = `https://www.google.com/travel/flights?q=${encodedQuery}&curr=USD&hl=es`;

    console.log(`[Skill: Google Flights] Navegando a la búsqueda configurada...`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Manejar popup de cookies de Google si aparece
    try {
      const cookieBtn = page.locator('button:has-text("Aceptar todo"), button:has-text("Accept all"), button:has-text("Acepto")').first();
      if (await cookieBtn.isVisible({ timeout: 3000 })) {
        await cookieBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // Sin modal de cookies
    }

    // Esperar a que cargue la lista de resultados de vuelos
    console.log(`[Skill: Google Flights] Esperando resultados de tarifas...`);
    await page.waitForSelector('li.pIav2d, [role="listitem"], ul.Rk10dc > li', { timeout: 25000 });
    await page.waitForTimeout(2000);

    // Extraer las opciones de vuelo
    const flightCards = await page.locator('li.pIav2d, [role="listitem"]').all();
    const results: ScrapedFlightOption[] = [];

    console.log(`[Skill: Google Flights] Procesando tarjetas de vuelo encontradas (${flightCards.length})...`);

    for (const card of flightCards) {
      const cardText = await card.innerText();
      if (!cardText || (!cardText.includes('US$') && !cardText.includes('$'))) continue;

      // Extraer precio en USD (soporta "$ 1.873" y "1.873 US$")
      const priceMatch = cardText.match(/(?:US\$|\$)\s*([\d,.]+)/) || cardText.match(/([\d,.]+)\s*(?:US\$|\$)/);
      if (!priceMatch) continue;

      const rawPrice = (priceMatch[1] || priceMatch[2]).replace(/,/g, '').replace(/\./g, '');
      const priceUSD = parseInt(rawPrice, 10);
      if (isNaN(priceUSD) || priceUSD < 100) continue;

      // Extraer escalas
      let stops = 0;
      if (cardText.includes('1 escala') || cardText.includes('1 stop')) stops = 1;
      else if (cardText.includes('2 escalas') || cardText.includes('2 stops')) stops = 2;
      else if (cardText.includes('Directo') || cardText.includes('Sin escalas') || cardText.includes('Nonstop')) stops = 0;

      // Filtrar por máximo de escalas solicitadas
      if (params.maxStops !== undefined && stops > params.maxStops) {
        continue;
      }

      // Extraer aerolínea de las líneas del card
      const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
      let airline = 'Aerolínea';
      for (const line of lines) {
        if (
          !line.includes('$') &&
          !line.includes(':') &&
          !line.includes('min') &&
          !line.includes('escala') &&
          !line.includes('Directo') &&
          !line.includes('emisiones') &&
          !line.includes('kg CO2') &&
          line.length > 2 && line.length < 40
        ) {
          airline = line;
          break;
        }
      }

      // Filtrar aerolíneas excluidas si aplica (ej. LEVEL)
      if (params.excludedAirlines && params.excludedAirlines.some(ex => airline.toLowerCase().includes(ex.toLowerCase()))) {
        console.log(`[Skill: Google Flights] ⏩ Omitiendo opción de aerolínea excluida: ${airline}`);
        continue;
      }

      // Extraer duración
      const durationMatch = cardText.match(/(\d+\s*h(?:\s*\d+\s*m(?:in)?)?)/i);
      const durationText = durationMatch ? durationMatch[1] : undefined;

      results.push({
        source: 'google_flights',
        airline,
        route: `${params.origin} - ${params.destination}`,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        stops,
        durationText,
        priceTotalUSD: priceUSD,
        priceRawText: priceMatch[0],
        bookingUrl: page.url(),
        collectedAt: new Date().toISOString()
      });

      // Obtener hasta 5 mejores opciones
      if (results.length >= 5) break;
    }

    if (results.length > 0) {
      console.log(`[Skill: Google Flights] ✅ Se extrajeron ${results.length} opciones válidas vía Playwright.`);
      return results;
    }


    // Fallback a SerpApi si Playwright no detectó tarjetas
    if (process.env.SERPAPI_KEY) {
      console.log(`[Skill: Google Flights] 🛡️ Playwright no detectó opciones. Activando fallback de respaldo con SerpApi...`);
      return await fetchSerpApiFallback(params);
    }

    return [];
  } catch (error) {
    console.error(`[Skill: Google Flights] ❌ Error durante el scraping de Playwright:`, error);
    if (process.env.SERPAPI_KEY) {
      console.log(`[Skill: Google Flights] 🛡️ Activando fallback de respaldo con SerpApi...`);
      return await fetchSerpApiFallback(params);
    }
    return [];
  } finally {
    await browser.close();
  }
}

async function fetchSerpApiFallback(params: FlightSearchParams): Promise<ScrapedFlightOption[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];
  try {
    const queryUrl = new URL('https://serpapi.com/search.json');
    queryUrl.searchParams.set('engine', 'google_flights');
    queryUrl.searchParams.set('departure_id', params.origin);
    queryUrl.searchParams.set('arrival_id', params.destination);
    queryUrl.searchParams.set('outbound_date', params.departureDate);
    queryUrl.searchParams.set('return_date', params.returnDate);
    queryUrl.searchParams.set('adults', String(params.passengers));
    queryUrl.searchParams.set('currency', 'USD');
    queryUrl.searchParams.set('type', '1');
    queryUrl.searchParams.set('api_key', apiKey);

    const res = await fetch(queryUrl.toString());
    if (!res.ok) return [];
    const data = await res.json() as any;
    const raw = [...(data.best_flights || []), ...(data.other_flights || [])];
    const results: ScrapedFlightOption[] = [];

    for (const item of raw.slice(0, 5)) {
      const firstLeg = item.flights?.[0];
      const airline = firstLeg?.airline || 'Varios';
      const stops = (item.layovers?.length) ?? Math.max(0, (item.flights?.length || 1) - 1);
      const priceUSD = Number(item.price || 0);

      if (priceUSD > 0) {
        results.push({
          source: 'google_flights',
          airline,
          route: `${params.origin} - ${params.destination}`,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          stops,
          durationText: `${item.total_duration || 0} min`,
          priceTotalUSD: priceUSD,
          priceRawText: `US$ ${priceUSD}`,
          bookingUrl: data.search_metadata?.google_flights_url || `https://www.google.com/travel/flights`,
          collectedAt: new Date().toISOString()
        });
      }
    }
    console.log(`[Skill: Google Flights] 🛡️ SerpApi devolvió ${results.length} opciones válidas de respaldo.`);
    return results;
  } catch (err) {
    console.warn(`[Skill: Google Flights] Falló llamada de fallback a SerpApi:`, err);
    return [];
  }
}

