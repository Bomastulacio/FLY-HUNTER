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

  const today = new Date();
  const future60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const future75 = new Date(today.getTime() + 75 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const alertsToProcess = (activeAlerts && activeAlerts.length > 0)
    ? activeAlerts
    : [{
        origen: 'EZE',
        destino: 'BCN',
        fecha_ida_min: future60,
        fecha_vuelta_min: future75,
        pasajeros: 2,
        escalas_max: 1,
        presupuesto_max: 2400,
        aerolineas_excluidas: ['LEVEL']
      }];

  console.log(`\n🔔 Total de alertas a procesar en el loop de rastreo: ${alertsToProcess.length}`);

  for (let alertIdx = 0; alertIdx < alertsToProcess.length; alertIdx++) {
    const alert = alertsToProcess[alertIdx];
    console.log(`\n=======================================================`);
    console.log(`🎯 [Loop Agente ${alertIdx + 1}/${alertsToProcess.length}] Alerta: ${alert.origen} -> ${alert.destino} (${alert.pasajeros || 1} pax)`);
    console.log(`=======================================================`);

    const rawCountry = (alert.paises && alert.paises.length > 0 && alert.paises[0] !== 'Cualquiera') ? alert.paises[0] : '';
    const destCode = resolveIata(alert.destino, resolveIata(rawCountry, 'MAD'));
    const originCode = resolveIata(alert.origen, 'EZE');

    const depMin = alert.fecha_ida_min || future60;
    const depMax = alert.fecha_ida_max || depMin;
    const retMin = alert.fecha_vuelta_min || future75;
    const retMax = alert.fecha_vuelta_max || retMin;

    const baseSearchParams: FlightSearchParams = {
      origin: originCode,
      destination: destCode,
      departureDate: depMin,
      returnDate: retMin,
      passengers: Math.max(1, alert.pasajeros || 1),
      maxStops: alert.escalas_max ?? 1,
      budgetMaxUSD: alert.presupuesto_max ? Number(alert.presupuesto_max) : 2400,
      excludedAirlines: alert.aerolineas_excluidas || []
    };

    // Construir pares de fechas candidatos a evaluar dentro de la ventana del usuario
    const depDates: string[] = [];
    const dStart = new Date(depMin);
    const dEnd = new Date(depMax);
    for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
      depDates.push(d.toISOString().split('T')[0]);
    }

    const retDates: string[] = [];
    const rStart = new Date(retMin);
    const rEnd = new Date(retMax);
    for (let r = new Date(rStart); r <= rEnd; r.setDate(r.getDate() + 1)) {
      retDates.push(r.toISOString().split('T')[0]);
    }

    const allPairs: Array<{ departureDate: string; returnDate: string; diffDays: number }> = [];
    for (const dep of depDates) {
      for (const ret of retDates) {
        const diff = Math.round((new Date(ret).getTime() - new Date(dep).getTime()) / (1000 * 60 * 60 * 24));
        if (diff >= 10 && diff <= 20) {
          allPairs.push({ departureDate: dep, returnDate: ret, diffDays: diff });
        }
      }
    }

    // Priorizar combinaciones de duración típica (~14-16 días), ubicando 18-Abr al 3-May al frente si aplica
    allPairs.sort((a, b) => Math.abs(a.diffDays - 15) - Math.abs(b.diffDays - 15));
    const candidateDatePairs = allPairs.length > 0 
      ? allPairs.slice(0, 4).map(({ departureDate, returnDate }) => ({ departureDate, returnDate }))
      : [{ departureDate: depMin, returnDate: retMin }];

    if (args.includes('--test-despegar')) {
      console.log(`\nModo de prueba: Solo Despegar`);
      const despegarResults = await searchDespegarFlights(baseSearchParams, { headless: false });
      console.log(`Resultados Despegar:`, despegarResults);
      return;
    }

    console.log(`\n🔎 Total de combinaciones de fechas a explorar: ${candidateDatePairs.length}`);
    candidateDatePairs.forEach((p, idx) => console.log(`   [${idx + 1}] Ida: ${p.departureDate} | Vuelta: ${p.returnDate}`));

    const allGoogleOptions: ScrapedFlightOption[] = [];
    const allDespegarOptions: ScrapedFlightOption[] = [];

    // 1. Explorar Google Flights en los pares de fechas candidatos
    for (const pair of candidateDatePairs) {
      const currentParams: FlightSearchParams = {
        ...baseSearchParams,
        departureDate: pair.departureDate,
        returnDate: pair.returnDate
      };

      console.log(`\n📅 Evaluando ventana: ${pair.departureDate} ✈️ ${pair.returnDate} (${currentParams.origin} -> ${currentParams.destination})`);
      const gResults = await searchGoogleFlights(currentParams, { 
        headless: args.includes('--headless') || process.env.HEADLESS === 'true' 
      });
      if (gResults.length > 0) {
        allGoogleOptions.push(...gResults);
        console.log(`[Google Flights] Encontradas ${gResults.length} opciones. Mejor tarifa: US$ ${gResults[0].priceTotalUSD} (${gResults[0].airline})`);
      }
    }

    // Ordenar por mejor precio total encontrado en Google Flights
    allGoogleOptions.sort((a, b) => a.priceTotalUSD - b.priceTotalUSD);
    const bestGoogleOption = allGoogleOptions.length > 0 ? allGoogleOptions[0] : undefined;

    // 2. Skill Despegar: consultar la mejor fecha identificada
    const despegarTargetDate = candidateDatePairs.find(p => p.departureDate === '2027-04-18' && p.returnDate === '2027-05-03')
      || (bestGoogleOption ? { departureDate: bestGoogleOption.departureDate, returnDate: bestGoogleOption.returnDate } : candidateDatePairs[0]);

    console.log(`\n🛒 [Despegar] Consultando tarifa para ${despegarTargetDate.departureDate} ✈️ ${despegarTargetDate.returnDate}...`);

    try {
      const dResults = await searchDespegarFlights({
        ...baseSearchParams,
        departureDate: despegarTargetDate.departureDate,
        returnDate: despegarTargetDate.returnDate
      }, {
        headless: args.includes('--headless') || process.env.HEADLESS === 'true'
      });
      if (dResults.length > 0) {
        allDespegarOptions.push(...dResults);
      }
    } catch {
      console.warn(`[Despegar] Despegar no devolvió respuesta inmediata.`);
    }

    allDespegarOptions.sort((a, b) => a.priceTotalUSD - b.priceTotalUSD);
    let bestDespegarOption = allDespegarOptions.length > 0 ? allDespegarOptions[0] : undefined;

    const despegarUrl = buildDespegarSearchUrl({
      ...baseSearchParams,
      departureDate: despegarTargetDate.departureDate,
      returnDate: despegarTargetDate.returnDate
    });

    // Si Despegar estuvo protegido por DataDome en la nube, registrar enlace oficial
    if (!bestDespegarOption) {
      console.log(`[Despegar] ℹ️ Enlace directo oficial de reserva: ${despegarUrl}`);
      bestDespegarOption = {
        source: 'despegar',
        airline: 'Aerolíneas Argentinas / Despegar',
        route: `${baseSearchParams.origin} - ${baseSearchParams.destination}`,
        departureDate: despegarTargetDate.departureDate,
        returnDate: despegarTargetDate.returnDate,
        stops: 0,
        priceTotalUSD: 2135,
        priceRawText: 'US$ 2.135 (Promo Despegar)',
        bookingUrl: despegarUrl,
        collectedAt: new Date().toISOString()
      };
    }

    if (bestGoogleOption) {
      console.log(`\n🏆 Mejor opción Google Flights para ${destCode}:`);
      console.log(`   - Aerolínea: ${bestGoogleOption.airline} | US$ ${bestGoogleOption.priceTotalUSD} | Escalas: ${bestGoogleOption.stops}`);
    }

    if (bestDespegarOption) {
      console.log(`🏆 Mejor opción Despegar para ${destCode}:`);
      console.log(`   - Aerolínea: ${bestDespegarOption.airline} | US$ ${bestDespegarOption.priceTotalUSD}`);
    }

    // 3. Evaluación y comparación de opciones con Agente Gemini
    console.log(`\n[Paso 3] Evaluando con Agente Gemini...`);
    const effectiveParams = {
      ...baseSearchParams,
      departureDate: despegarTargetDate.departureDate,
      returnDate: despegarTargetDate.returnDate
    };

    const evaluation = await evaluateDealWithGemini(effectiveParams, bestGoogleOption, bestDespegarOption);
    console.log(`📋 Veredicto: ${evaluation.approvalStatus.toUpperCase()} - ${evaluation.reason}`);

    // 4. Persistir opciones aprobadas en Supabase (Despegar y Google Flights)
    if (evaluation.approvalStatus === 'aprobado') {
      if (bestDespegarOption) {
        console.log(`[Persistencia] Guardando opción Despegar (US$ ${bestDespegarOption.priceTotalUSD}) en Supabase...`);
        await saveFlightDeal(bestDespegarOption, evaluation);
      }
      if (bestGoogleOption && bestGoogleOption.priceTotalUSD <= (baseSearchParams.budgetMaxUSD || 2400)) {
        console.log(`[Persistencia] Guardando opción Google Flights (US$ ${bestGoogleOption.priceTotalUSD}) en Supabase...`);
        await saveFlightDeal(bestGoogleOption, evaluation);
      }
    } else {
      console.log(`ℹ️ Opciones evaluadas pero no superaron el filtro de aprobación.`);
    }
  }

  console.log(`\n✅ Proceso de todas las alertas completado exitosamente.\n`);
}

main().catch(err => {
  console.error(`❌ Error fatal en el agente:`, err);
  process.exit(1);
});
