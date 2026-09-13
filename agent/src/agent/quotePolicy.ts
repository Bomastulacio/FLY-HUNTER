import type { AgentEvaluation, FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';

export const normalizedAirline = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const isAerolineasArgentinas = (s: string) => /\baerolineas argentinas\b/.test(normalizedAirline(s));

export function quoteIntegrityReason(p: FlightSearchParams, q: ScrapedFlightOption): string | undefined {
  if (![0, 1].includes(p.maxStops ?? 1)) return 'Configuración de radar inválida';
  if (!Number.isFinite(q.priceTotalUSD) || q.priceTotalUSD <= 0) return 'Precio desconocido o inválido';
  if (!Number.isInteger(q.passengers) || q.passengers !== p.passengers) return 'La cotización corresponde a otros pasajeros';
  if (!q.evidence?.passengersVerified || q.evidence.priceBasis !== 'party_total') return 'Falta verificar el total para el grupo';
  if (q.source === 'google_flights' && (q.evidence.googleParserVersion !== 2
    || !q.evidence.priceVerified || !q.evidence.queryVerified || q.evidence.searchView !== 'cheapest')) return 'Cotización de Google sin verificar';
  if (Math.abs(q.pricePerPaxUSD * q.passengers - q.priceTotalUSD) > 0.02 * q.passengers) return 'Total y precio por persona inconsistentes';
  if (q.route.replace(/\s/g, '') !== `${p.origin}-${p.destination}` || q.departureDate !== p.departureDate || q.returnDate !== p.returnDate) return 'La cotización corresponde a otra ruta o fechas';
  if (!Number.isInteger(q.stops) || q.stops < 0 || q.stops > Math.min(1, p.maxStops ?? 1)) return 'Escalas no permitidas o desconocidas';
  if (q.evidence.stopsPerDirection?.some(s => !Number.isInteger(s) || s < 0 || s > Math.min(1, p.maxStops ?? 1))) return 'Escalas no permitidas en un tramo';
  if (!q.airline.trim() || /^(aerolinea|desconocida|multiples)$/.test(normalizedAirline(q.airline))) return 'Aerolínea sin verificar';
  if (p.excludedAirlines?.some(a => a.trim() && ` ${normalizedAirline(q.airline)} `.includes(` ${normalizedAirline(a)} `))) return 'Aerolínea excluida';
  if (!Number.isFinite(Date.parse(q.collectedAt))) return 'Fecha de observación inválida';
  return undefined;
}

export function rejectionReason(p: FlightSearchParams, q: ScrapedFlightOption): string | undefined {
  const invalid = quoteIntegrityReason(p, q);
  if (invalid) return invalid;
  const maxBudget = p.budgetMaxUSD ?? 1200 * p.passengers;
  if (!Number.isFinite(maxBudget) || maxBudget <= 0) return 'Configuración de radar inválida';
  if (q.priceTotalUSD > maxBudget) return 'Supera el presupuesto';
  if (q.priceTotalUSD >= 750 * p.passengers && q.priceTotalUSD < (p.budgetMinUSD ?? 0)) return 'Debajo del mínimo configurado: requiere revisión';
  return undefined;
}

export function evaluateQuote(p: FlightSearchParams, q: ScrapedFlightOption): AgentEvaluation {
  const rejection = rejectionReason(p, q);
  return {
    approvalStatus: rejection ? 'rechazado' : 'aprobado', isAnomaly: false,
    isGoldenOpportunity: !rejection && q.priceTotalUSD < 750 * p.passengers,
    bestOption: q.source, reason: rejection || `Total observado para ${q.passengers} personas dentro de tus filtros.${q.paymentCondition ? ` ${q.paymentCondition}.` : ''}`,
    summaryForNotification: rejection || `Vuelo a US$ ${q.priceTotalUSD} para ${q.passengers} personas.`,
  };
}

/** Keep price leaders and carrier variety, including AR, after reading every available card. */
export function selectDiverseQuotes(options: ScrapedFlightOption[], limit = 8): ScrapedFlightOption[] {
  const ordered = [...options].sort((a, b) => a.priceTotalUSD - b.priceTotalUSD);
  const leaders = new Map<string, ScrapedFlightOption>();
  for (const q of ordered) {
    const key = normalizedAirline(q.airline);
    if (!leaders.has(key)) leaders.set(key, q);
  }
  const selected = [...leaders.values()].slice(0, limit);
  const ar = ordered.find(q => isAerolineasArgentinas(q.airline));
  if (ar && limit > 0 && !selected.includes(ar)) selected.splice(Math.max(0, limit - 1), 1, ar);
  return selected.sort((a, b) => a.priceTotalUSD - b.priceTotalUSD);
}
