import { createHash } from 'node:crypto';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import type { SearchAlert } from './searchPlanner.js';
import { roundRobin } from './searchPlanner.js';
import { normalizedAirline, quoteIntegrityReason } from './quotePolicy.js';
import type { Provider, ProviderResult } from './searchRuntime.js';

export interface SavedDeal {
  id: string; user_id: string; origen: string; destino: string; ida_fecha: string; vuelta_fecha: string;
  pasajeros: number; aerolinea: string; cantidad_escalas: number | null; fuente: string;
  precio_total_usd: number; guardado_el: string; detalle_cotizacion?: Record<string, unknown> | null;
}

export function sameSearch(saved: SavedDeal, p: FlightSearchParams): boolean {
  return saved.origen === p.origin && saved.destino === p.destination && saved.ida_fecha === p.departureDate
    && saved.vuelta_fecha === p.returnDate && Number(saved.pasajeros) === p.passengers;
}
export const savedProvider = (s: SavedDeal) => s.fuente === 'serpapi' ? 'google_flights' : s.fuente;

/** A bookmark can schedule work only inside one of its owner's currently active radars. */
export function watchTargets(alert: SearchAlert, searches: FlightSearchParams[], saved: SavedDeal[], provider: Provider) {
  const owned = saved.filter(s => s.user_id === alert.user_id && savedProvider(s) === provider
    && s.cantidad_escalas != null && Number.isInteger(Number(s.cantidad_escalas)) && Number(s.cantidad_escalas) >= 0
    && Number(s.cantidad_escalas) <= Math.min(1, alert.escalas_max ?? 1)
    && !(alert.aerolineas_excluidas || []).some(a => a.trim() && ` ${normalizedAirline(s.aerolinea || '')} `.includes(` ${normalizedAirline(a)} `)));
  return searches.filter(p => owned.some(s => sameSearch(s, p)));
}

export function pickMonitoringSearch(searches: FlightSearchParams[], watches: FlightSearchParams[], preferFollow: boolean,
  exploreCursor: number, watchCursor: number, alreadyVisited: (p: FlightSearchParams) => boolean) {
  for (const follow of preferFollow && watches.length ? [true, false] : [false]) {
    const candidates = follow ? watches : searches;
    const cursor = follow ? watchCursor : exploreCursor;
    const ordered = roundRobin(candidates, cursor, candidates.length);
    const index = ordered.findIndex(p => !alreadyVisited(p));
    if (index >= 0) return { params: ordered[index], follow, steps: index + 1 };
  }
  return undefined;
}

export function savedChecks(alert: SearchAlert, p: FlightSearchParams, provider: Provider, result: ProviderResult,
  saved: SavedDeal[], checkedAt: string) {
  return saved.filter(s => s.user_id === alert.user_id && savedProvider(s) === provider && sameSearch(s, p)).map(s => {
    // Today's collectors lack flight numbers / fare family. This follows a comparable
    // route/date/carrier offer, never claims to reprice an identical ticket.
    const q = result.options.filter(q => !quoteIntegrityReason(p, q)
      && normalizedAirline(q.airline) === normalizedAirline(s.aerolinea || '')
      && q.stops === Number(s.cantidad_escalas) && s.cantidad_escalas != null
      && (q.paymentCondition || null) === (s.detalle_cotizacion?.paymentCondition || null))
      .sort((a, b) => a.priceTotalUSD - b.priceTotalUSD)[0];
    const observedAt = q?.collectedAt || checkedAt;
    const outcome = q ? 'observed' : result.status === 'ok' || result.status === 'empty' ? 'not_observed' : result.status;
    const quote = q ? toObservedDeal(q) : null;
    const event_id = createHash('sha256').update(JSON.stringify([s.id, provider, observedAt, outcome, quote])).digest('hex');
    return { event_id, saved_deal_id: s.id, provider, checked_at: observedAt, outcome, quote };
  });
}

export function toObservedDeal(q: ScrapedFlightOption) {
  const [origin, destination] = q.route.split('-').map(s => s.trim());
  return { ida_origen_destino: `${origin}-${destination}`, vuelta_origen_destino: `${destination}-${origin}`,
    ida_fecha: q.departureDate, vuelta_fecha: q.returnDate, pasajeros: q.passengers,
    precio_total_usd: q.priceTotalUSD, precio_por_pasajero_usd: q.pricePerPaxUSD, aerolinea: q.airline,
    cantidad_escalas: q.stops, fuente: q.source, link_reserva: q.bookingUrl, created_at: q.collectedAt,
    detalle_cotizacion: { ...q.evidence, observedAt: q.collectedAt, paymentCondition: q.paymentCondition || null } };
}
