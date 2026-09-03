import 'dotenv/config';
import { searchGoogleFlights } from './skills/googleFlights.js';
import { searchDespegarFlights, buildDespegarSearchUrl } from './skills/despegar.js';
import { evaluateDealWithGemini } from './agent/geminiEvaluator.js';
import { saveFlightDeal } from './db/supabase.js';
import type { FlightSearchParams } from './types/flight.js';

async function main() {
  const args = process.argv.slice(2);
  console.log(`=======================================================`);
  console.log(`🚀 FLIGHT HUNTER - AGENT IN THE LOOP (TypeScript)`);
  console.log(`=======================================================`);

  // Parámetros de búsqueda de ejemplo (configurados para 2 personas)
  const searchParams: FlightSearchParams = {
    origin: 'EZE',
    destination: 'BCN',
    departureDate: '2027-04-17',
    returnDate: '2027-05-02',
    passengers: 2,
    maxStops: 1,
    budgetMaxUSD: 2400,
    excludedAirlines: ['LEVEL']
  };

  if (args.includes('--test-despegar')) {
    console.log(`\nModo de prueba: Solo Despegar`);
    const despegarResults = await searchDespegarFlights(searchParams, { headless: false });
    console.log(`Resultados Despegar:`, despegarResults);
    return;
  }

  // 1. Skill Google Flights (Playwright)
  console.log(`\n[Paso 1/3] Ejecutando Skill Google Flights (2 pasajeros)...`);
  const googleResults = await searchGoogleFlights(searchParams, { 
    headless: args.includes('--headless') || process.env.HEADLESS === 'true' 
  });

  const bestGoogleOption = googleResults.length > 0 ? googleResults[0] : undefined;

  if (bestGoogleOption) {
    console.log(`\n🏆 Mejor tarifa Google Flights:`);
    console.log(`   - Aerolínea: ${bestGoogleOption.airline}`);
    console.log(`   - Precio total (2 personas): US$ ${bestGoogleOption.priceTotalUSD}`);
    console.log(`   - Escalas: ${bestGoogleOption.stops}`);
    console.log(`   - Duración: ${bestGoogleOption.durationText || 'N/A'}`);
    console.log(`   - Link: ${bestGoogleOption.bookingUrl}`);
  } else {
    console.log(`\n⚠️ No se encontraron opciones en Google Flights para los filtros solicitados.`);
  }

  // 2. Link / Skill Despegar para comparar
  console.log(`\n[Paso 2/3] Generando comparación con Despegar para ${searchParams.passengers} pasajeros...`);
  const despegarUrl = buildDespegarSearchUrl(searchParams);
  console.log(`   - Link directo Despegar (2 personas): ${despegarUrl}`);

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
