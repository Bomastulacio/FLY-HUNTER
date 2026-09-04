import 'dotenv/config';
import { searchGoogleFlights } from './skills/googleFlights.js';
import { searchDespegarFlights, buildDespegarSearchUrl } from './skills/despegar.js';
import { evaluateDealWithGemini } from './agent/geminiEvaluator.js';
import { saveFlightDeal, getActiveSearchAlerts } from './db/supabase.js';
import type { FlightSearchParams, ScrapedFlightOption } from './types/flight.js';

async function main() {
  const args = process.argv.slice(2);
  console.log(`=======================================================`);
  console.log(`🚀 FLIGHT HUNTER - AGENT IN THE LOOP (TypeScript)`);
  console.log(`=======================================================`);

  // Consultar si existen alertas activas configuradas en Supabase
  const activeAlerts = await getActiveSearchAlerts();
  let searchParams: FlightSearchParams;

  // Mapeo exhaustivo de países comunes a códigos IATA principales
  const COUNTRY_TO_IATA: Record<string, string> = {
    'ESPAÑA': 'MAD',
    'ESPANA': 'MAD',
    'SPAIN': 'MAD',
    'FRANCIA': 'CDG',
    'FRANCE': 'CDG',
    'ITALIA': 'FCO',
    'ITALY': 'FCO',
    'REINO UNIDO': 'LHR',
    'UK': 'LHR',
    'ALEMANIA': 'FRA',
    'GERMANY': 'FRA',
    'PORTUGAL': 'LIS',
    'ESTADOS UNIDOS': 'MIA',
    'EEUU': 'MIA',
    'USA': 'MIA',
    'BRASIL': 'GIG',
    'BRAZIL': 'GIG',
  };

  const resolveIata = (codeOrName?: string, fallback = 'MAD'): string => {
    if (!codeOrName) return fallback;
    const clean = codeOrName.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(clean)) return clean;
    if (COUNTRY_TO_IATA[clean]) return COUNTRY_TO_IATA[clean];
    // Buscar si contiene nombre de país
    for (const [country, iata] of Object.entries(COUNTRY_TO_IATA)) {
      if (clean.includes(country)) return iata;
    }
    return fallback;
  };

  if (activeAlerts && activeAlerts.length > 0) {
    const alert = activeAlerts[0];
    console.log(`[Alertas] 🔔 Utilizando alerta de usuario: ${alert.origen} -> ${alert.destino} (${alert.pasajeros || 1} pax)`);
    
    // Fechas dinámicas relativas si la alerta no define fecha
    const today = new Date();
    const future60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const future75 = new Date(today.getTime() + 75 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const rawCountry = (alert.paises && alert.paises.length > 0 && alert.paises[0] !== 'Cualquiera') ? alert.paises[0] : '';
    const destCode = resolveIata(alert.destino, resolveIata(rawCountry, 'MAD'));
    const originCode = resolveIata(alert.origen, 'EZE');

    searchParams = {
      origin: originCode,
      destination: destCode,
      departureDate: alert.fecha_ida_min || future60,
      returnDate: alert.fecha_vuelta_min || future75,
      passengers: Math.max(1, alert.pasajeros || 1),
      maxStops: alert.escalas_max ?? 1,
      budgetMaxUSD: alert.presupuesto_max ? Number(alert.presupuesto_max) : 2400,
      excludedAirlines: alert.aerolineas_excluidas || []
    };

  } else {
    // Parámetros por defecto con fechas relativas (+60 y +75 días)
    const today = new Date();
    const future60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const future75 = new Date(today.getTime() + 75 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    console.log(`[Alertas] ℹ️ Sin alertas activas en BD. Usando parámetros de contingencia (+60 días).`);

    searchParams = {
      origin: 'EZE',
      destination: 'BCN',
      departureDate: future60,
      returnDate: future75,
      passengers: 2,
      maxStops: 1,
      budgetMaxUSD: 2400,
      excludedAirlines: ['LEVEL']
    };
  }

  if (args.includes('--test-despegar')) {
    console.log(`\nModo de prueba: Solo Despegar`);
    const despegarResults = await searchDespegarFlights(searchParams, { headless: false });
    console.log(`Resultados Despegar:`, despegarResults);
    return;
  }

  // 1. Skill Google Flights (Playwright)
  console.log(`\n[Paso 1/3] Ejecutando Skill Google Flights (${searchParams.passengers} pasajeros)...`);
  const googleResults = await searchGoogleFlights(searchParams, { 
    headless: args.includes('--headless') || process.env.HEADLESS === 'true' 
  });

  const bestGoogleOption = googleResults.length > 0 ? googleResults[0] : undefined;

  if (bestGoogleOption) {
    console.log(`\n🏆 Mejor tarifa Google Flights:`);
    console.log(`   - Aerolínea: ${bestGoogleOption.airline}`);
    console.log(`   - Precio total (${searchParams.passengers} pax): US$ ${bestGoogleOption.priceTotalUSD}`);
    console.log(`   - Escalas: ${bestGoogleOption.stops}`);
    console.log(`   - Duración: ${bestGoogleOption.durationText || 'N/A'}`);
    console.log(`   - Link: ${bestGoogleOption.bookingUrl}`);
  } else {
    console.log(`\n⚠️ No se encontraron opciones en Google Flights para los filtros solicitados.`);
  }

  // 2. Skill Despegar (Playwright con evasión anti-bot)
  console.log(`\n[Paso 2/3] Ejecutando Skill Despegar para ${searchParams.passengers} personas...`);
  let bestDespegarOption: ScrapedFlightOption | undefined = undefined;
  try {
    const despegarResults = await searchDespegarFlights(searchParams, {
      headless: args.includes('--headless') || process.env.HEADLESS === 'true'
    });
    if (despegarResults.length > 0) {
      bestDespegarOption = despegarResults[0];
      console.log(`\n🏆 Mejor tarifa Despegar:`);
      console.log(`   - Aerolínea: ${bestDespegarOption.airline}`);
      console.log(`   - Precio total (${searchParams.passengers} pax): US$ ${bestDespegarOption.priceTotalUSD}`);
      console.log(`   - Link: ${bestDespegarOption.bookingUrl}`);
    }
  } catch (err) {
    console.warn(`[Skill: Despegar] ⚠️ Despegar no devolvió resultados en esta pasada. Generando link de consulta.`);
  }

  // 3. Evaluación y comparación de opciones con Agente Gemini
  console.log(`\n[Paso 3/3] Evaluando y comparando opciones con Gemini...`);
  const evaluation = await evaluateDealWithGemini(searchParams, bestGoogleOption, bestDespegarOption);

  console.log(`\n📋 RESUMEN DEL AGENTE:`);
  console.log(`   - Estado de Aprobación: ${evaluation.approvalStatus.toUpperCase()}`);
  console.log(`   - Oportunidad de Oro: ${evaluation.isGoldenOpportunity ? 'SÍ 🔥' : 'NO'}`);
  console.log(`   - Mejor Opción: ${evaluation.bestOption?.toUpperCase()}`);
  console.log(`   - Veredicto: ${evaluation.reason}`);
  console.log(`   - Notificación: "${evaluation.summaryForNotification}"`);

  // 4. Determinar la opción ganadora a persistir en Supabase
  let winningDeal: ScrapedFlightOption | undefined = undefined;
  if (bestGoogleOption && bestDespegarOption) {
    winningDeal = (bestDespegarOption.priceTotalUSD < bestGoogleOption.priceTotalUSD)
      ? bestDespegarOption
      : bestGoogleOption;
  } else {
    winningDeal = bestGoogleOption || bestDespegarOption;
  }

  if (winningDeal && evaluation.approvalStatus === 'aprobado') {
    console.log(`\n[Persistencia] Guardando opción ganadora (${winningDeal.source} - US$ ${winningDeal.priceTotalUSD}) en Supabase...`);
    await saveFlightDeal(winningDeal, evaluation);
  } else if (!winningDeal) {
    console.log(`\nℹ️ No se detectaron opciones válidas para guardar en esta corrida.`);
  }

  console.log(`\n✅ Proceso completado exitosamente.\n`);
}

main().catch(err => {
  console.error(`❌ Error fatal en el agente:`, err);
  process.exit(1);
});
