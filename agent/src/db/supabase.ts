import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import type { ScrapedFlightOption, AgentEvaluation } from '../types/flight.js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export async function saveFlightDeal(
  deal: ScrapedFlightOption,
  evaluation?: AgentEvaluation
) {
  if (!supabase) {
    throw new Error('Faltan las credenciales de persistencia de Supabase');
  }

  try {
    const routeParts = deal.route.split('-').map(s => s.trim());
    const idaOD = `${routeParts[0]}-${routeParts[1]}`;
    const vueltaOD = `${routeParts[1]}-${routeParts[0]}`;

    const pax = Math.max(1, deal.passengers || 1);
    const unitPrice = deal.pricePerPaxUSD || Math.round(deal.priceTotalUSD / pax);

    // Hash dedupe: md5(ida_fecha || ida_od || vuelta_fecha || vuelta_od || aerolinea || round(precio) || pax)
    const rawHash = `${deal.departureDate}_${idaOD}_${deal.returnDate}_${vueltaOD}_${deal.airline}_${deal.priceTotalUSD.toFixed(2)}_${pax}_${deal.source}_${deal.paymentCondition || ''}`;
    const hashDedupe = crypto.createHash('md5').update(rawHash).digest('hex');

    const payload = {
      ida_fecha: deal.departureDate,
      ida_origen_destino: idaOD,
      vuelta_fecha: deal.returnDate,
      vuelta_origen_destino: vueltaOD,
      precio_total_usd: deal.priceTotalUSD,
      pasajeros: pax,
      precio_por_pasajero_usd: unitPrice,
      created_at: deal.collectedAt,
      detalle_cotizacion: { ...deal.evidence, observedAt: deal.collectedAt, paymentCondition: deal.paymentCondition || null },
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
      .upsert(payload, { onConflict: 'hash_dedupe', ignoreDuplicates: true })
      .select()
      .maybeSingle();

    if (error) {
      console.error(`[DB] ❌ Error guardando vuelo en Supabase:`, error.message);
      throw new Error('No se pudo guardar la cotización');
    }

    if (!data) {
      // A repeat observation refreshes freshness only; preserve human decisions and notification state.
      const refreshed = await supabase.from('flight_deals').update({ created_at: deal.collectedAt,
        detalle_cotizacion: payload.detalle_cotizacion, link_reserva: deal.bookingUrl })
        .eq('hash_dedupe', hashDedupe).lt('created_at', deal.collectedAt);
      if (refreshed.error) throw new Error('No se pudo actualizar la observación');
    }

    console.log(`[DB] 💾 Vuelo guardado con éxito en Supabase (ID: ${data?.id})`);
    return data;
  } catch (error) {
    console.error(`[DB] ❌ Excepción guardando en Supabase:`, error);
    throw new Error('Persistencia de vuelos incompleta');
  }
}

export async function getActiveSearchAlerts(): Promise<any[]> {
  if (!supabase) throw new Error('Faltan las credenciales de Supabase');
  try {
    const { data, error } = await supabase
      .from('search_alerts')
      .select('*')
      .eq('activo', true)
      .order('id', { ascending: true });

    if (error) {
      console.warn(`[DB] ⚠️ No se pudieron consultar alertas de Supabase:`, error.message);
      throw new Error('No se pudieron leer los radares');
    }
    return data || [];
  } catch (err) {
    console.warn(`[DB] ⚠️ Error consultando alertas en Supabase:`, err);
    throw new Error('No se pudieron leer los radares');
  }
}
