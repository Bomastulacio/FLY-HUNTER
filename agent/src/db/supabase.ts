import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import type { ScrapedFlightOption, AgentEvaluation } from '../types/flight.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export async function saveFlightDeal(
  deal: ScrapedFlightOption,
  evaluation?: AgentEvaluation
) {
  if (!supabase) {
    console.log(`[DB] ℹ️ Sin conexión Supabase activa. Omitiendo guardado en base de datos.`);
    return null;
  }

  try {
    const routeParts = deal.route.split('-').map(s => s.trim());
    const idaOD = `${routeParts[0]}-${routeParts[1]}`;
    const vueltaOD = `${routeParts[1]}-${routeParts[0]}`;

    // Hash dedupe: md5(ida_fecha || ida_od || vuelta_fecha || vuelta_od || aerolinea || round(precio))
    const rawHash = `${deal.departureDate}_${idaOD}_${deal.returnDate}_${vueltaOD}_${deal.airline}_${Math.round(deal.priceTotalUSD)}`;
    const hashDedupe = crypto.createHash('md5').update(rawHash).digest('hex');

    const payload = {
      ida_fecha: deal.departureDate,
      ida_origen_destino: idaOD,
      vuelta_fecha: deal.returnDate,
      vuelta_origen_destino: vueltaOD,
      precio_total_usd: deal.priceTotalUSD,
      aerolinea: deal.airline,
      cantidad_escalas: deal.stops,
      fuente: deal.source,
      link_reserva: deal.bookingUrl,
      es_oportunidad_oro: evaluation?.isGoldenOpportunity ?? false,
      es_anomalia: evaluation?.isAnomaly ?? false,
      estado_aprobacion: evaluation?.approvalStatus ?? 'aprobado',
      hash_dedupe: hashDedupe
    };

    const { data, error } = await supabase
      .from('flight_deals')
      .upsert(payload, { onConflict: 'hash_dedupe' })
      .select()
      .single();

    if (error) {
      console.error(`[DB] ❌ Error guardando vuelo en Supabase:`, error.message);
      return null;
    }

    console.log(`[DB] 💾 Vuelo guardado con éxito en Supabase (ID: ${data?.id})`);
    return data;
  } catch (error) {
    console.error(`[DB] ❌ Excepción guardando en Supabase:`, error);
    return null;
  }
}

export async function getActiveSearchAlerts(): Promise<any[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('search_alerts')
      .select('*')
      .eq('activo', true)
      .order('creado_en', { ascending: false })
      .limit(5);

    if (error) {
      console.warn(`[DB] ⚠️ No se pudieron consultar alertas de Supabase:`, error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn(`[DB] ⚠️ Error consultando alertas en Supabase:`, err);
    return [];
  }
}
