import 'dotenv/config';
import { searchGoogleFlights } from './skills/googleFlights.js';
import { searchDespegarFlights, buildDespegarSearchUrl } from './skills/despegar.js';
import { evaluateDealWithGemini } from './agent/geminiEvaluator.js';
import { saveFlightDeal, getActiveSearchAlerts } from './db/supabase.js';
import type { FlightSearchParams } from './types/flight.js';

async function main() {
  const args = process.argv.slice(2);
  console.log(`=======================================================`);
  console.log(`🚀 FLIGHT HUNTER - AGENT IN THE LOOP (TypeScript)`);
  console.log(`=======================================================`);

  // Consultar si existen alertas activas configuradas en Supabase
  const activeAlerts = await getActiveSearchAlerts();
  let searchParams: FlightSearchParams;

  if (activeAlerts && activeAlerts.length > 0) {
    const alert = activeAlerts[0];
    console.log(`[Alertas] 🔔 Utilizando alerta de usuario: ${alert.origen} -> ${alert.destino} (${alert.pasajeros || 1} pax)`);
    
    // Fechas dinámicas relativas si la alerta no define fecha
    const today = new Date();
    const future60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const future75 = new Date(today.getTime() + 75 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const destCode = (alert.paises && alert.paises.length > 0 && alert.paises[0] !== 'Cualquiera')
      ? alert.paises[0]
      : (alert.destino && alert.destino.length === 3 ? alert.destino : 'BCN');

    searchParams = {
      origin: alert.origen ? (alert.origen.includes('EZE') ? 'EZE' : alert.origen) : 'EZE',
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

  // 2. Link / Skill Despegar para comparar
  console.log(`\n[Paso 2/3] Generando comparación con Despegar para ${searchParams.passengers} pasajeros...`);
  const despegarUrl = buildDespegarSearchUrl(searchParams);
  console.log(`   - Link directo Despegar (${searchParams.passengers} personas): ${despegarUrl}`);

  // 3. Evaluación con Agente Gemini
  console.log(`\n[Paso 3/3] Evaluando oportunidad con Gemini...`);
  const evaluation = await evaluateDealWithGemini(searchParams, bestGoogleOption, undefined);

  console.log(`\n📋 RESUMEN DEL AGENTE:`);
  console.log(`   - Estado de Aprobación: ${evaluation.approvalStatus.toUpperCase()}`);
  console.log(`   - Oportunidad de Oro: ${evaluation.isGoldenOpportunity ? 'SÍ 🔥' : 'NO'}`);
  console.log(`   - Veredicto: ${evaluation.reason}`);
  console.log(`   - Notificación: "${evaluation.summaryForNotification}"`);

  // 4. Guardar en Supabase si está aprobado
  if (bestGoogleOption && evaluation.approvalStatus === 'aprobado') {
    console.log(`\n[Persistencia] Guardando mejor opción en Supabase...`);
    await saveFlightDeal(bestGoogleOption, evaluation);
  }

  console.log(`\n✅ Proceso completado exitosamente.\n`);
}

main().catch(err => {
  console.error(`❌ Error fatal en el agente:`, err);
  process.exit(1);
});
