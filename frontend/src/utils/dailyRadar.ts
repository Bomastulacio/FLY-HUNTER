import { matchesRadar } from './compactFlights';
import { feedCandidate, latestQuotes } from './latestQuotes';
import { destinationAirports, radarDestinationGroups, radarAcceptsDestination } from '../../../shared/radarGeography';

export function isRecentQuote(deal: any, now = Date.now()): boolean {
  const observed = Date.parse(deal.detalle_cotizacion?.observedAt || deal.created_at || '');
  return Number.isFinite(observed) && observed <= now + 60000 && now - observed < 86400000;
}

/** Only compare observations already collected by the scheduled pipeline. */
export function dailyRadar(deals: any[], radar: any, now = Date.now()) {
  const countries = radarDestinationGroups(radar);
  const destination = (d: any) => String(d.ida_origen_destino || '').split('-')[1]?.trim();
  const belongs = (d: any) => radarAcceptsDestination(radar, destination(d) || '');
  const latest = latestQuotes(deals);
  const matching = latest.filter(d => feedCandidate(d) && matchesRadar(d, radar, true) && belongs(d)
    && d.detalle_cotizacion?.passengersVerified === true && d.detalle_cotizacion?.priceBasis === 'party_total');
  const recent = matching.filter(d => isRecentQuote(d, now));
  const affordable = recent.filter(d => matchesRadar(d, radar));
  const best = affordable[0] || null;
  const above = recent.find(d => Number(d.precio_total_usd) > Number(radar.presupuesto_max)) || null;
  const rows = countries.map(country => {
    const candidates = recent.filter(d => destinationAirports(country).includes(destination(d)));
    const quote = candidates.find(d => matchesRadar(d, radar)) || candidates.find(d => Number(d.precio_total_usd) > Number(radar.presupuesto_max)) || null;
    return { country, quote, aboveBudget: !!quote && Number(quote.precio_total_usd) > Number(radar.presupuesto_max) };
  });
  // A useful alternative must improve a known condition on the same travel dates.
  // No "fastest" claim from an outbound-only duration or an unknown return.
  const complete = (d: any) => d.detalle_cotizacion?.itineraryScope === 'roundtrip'
    && d.detalle_cotizacion?.passengersVerified === true
    && Array.isArray(d.detalle_cotizacion?.stopsPerDirection)
    && d.detalle_cotizacion.stopsPerDirection.length === 2
    && Math.max(...d.detalle_cotizacion.stopsPerDirection) === Number(d.cantidad_escalas);
  const alternative = best && complete(best) && Number(best.cantidad_escalas) > 0
    ? affordable.find(d => d.id !== best.id && complete(d) && Number(d.cantidad_escalas) === 0
      && d.ida_origen_destino === best.ida_origen_destino && d.vuelta_origen_destino === best.vuelta_origen_destino
      && d.ida_fecha === best.ida_fecha && d.vuelta_fecha === best.vuelta_fecha
      && (d.detalle_cotizacion?.paymentCondition || '') === (best.detalle_cotizacion?.paymentCondition || '')
      && Number(d.precio_total_usd) <= Number(best.precio_total_usd) * 1.25) || null : null;
  const diagnostics = { latest: latest.length, matching: matching.length, recent: recent.length, affordable: affordable.length,
    unknownDestination: !countries.some(c => destinationAirports(c).length) };
  return { best, above, alternative, rows, affordable, recent, diagnostics,
    previous: matching.find(d => !isRecentQuote(d, now)) || null };
}

export function emptyRadarMessage(state: ReturnType<typeof dailyRadar>): string {
  if (state.diagnostics.unknownDestination) return 'No pudimos reconocer el destino de este radar. Revisá el destino para continuar.';
  if (state.recent.length) return 'Hay cotizaciones recientes, pero ninguna cumple tu rango de presupuesto. Revisá también el mínimo configurado.';
  if (state.previous) return 'Las cotizaciones que coinciden con tu viaje tienen más de 24 horas. Esperamos una nueva consulta para mostrarlas como actuales.';
  return 'Todavía no tenemos cotizaciones de las últimas 24 horas que coincidan con tus fechas, pasajeros y filtros. Esto no significa que no haya vuelos disponibles.';
}
