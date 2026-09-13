import type { FlightSearchParams } from '../types/flight.js';

export interface SearchAlert {
  id?: string; user_id?: string; origen: string; destino: string; paises?: string[];
  fecha_ida_min?: string; fecha_ida_max?: string;
  fecha_vuelta_min?: string; fecha_vuelta_max?: string;
  pasajeros?: number; escalas_max?: number; presupuesto_min?: number;
  presupuesto_max?: number; aerolineas_excluidas?: string[];
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
const destinations: Record<string, string[]> = {
  EUROPA: ['MAD', 'CDG', 'LHR', 'FRA', 'FCO', 'AMS', 'LIS'],
  NORTEAMERICA: ['MIA', 'JFK', 'LAX', 'YYZ', 'MEX'],
  LATINOAMERICA: ['GRU', 'GIG', 'BOG', 'LIM', 'SCL', 'MVD'],
  CARIBE: ['CUN', 'PUJ', 'HAV', 'SJO', 'SJU'], ASIA: ['NRT', 'HND', 'KIX', 'ICN', 'BKK', 'SIN', 'DXB'],
  OCEANIA: ['SYD', 'MEL', 'AKL'], CUALQUIERA: ['MAD', 'MIA', 'NRT', 'CUN'],
  ESPANA: ['MAD', 'BCN'], FRANCIA: ['CDG', 'ORY'], ITALIA: ['FCO', 'MXP'],
  'REINO UNIDO': ['LHR', 'LGW'], ALEMANIA: ['FRA', 'BER', 'MUC'], PORTUGAL: ['LIS', 'OPO'],
  'PAISES BAJOS': ['AMS'], SUIZA: ['ZRH', 'GVA'], GRECIA: ['ATH'],
  'ESTADOS UNIDOS': ['MIA', 'JFK', 'LAX', 'ORD'], CANADA: ['YYZ', 'YVR'], MEXICO: ['MEX', 'CUN'],
  BRASIL: ['GRU', 'GIG'], CHILE: ['SCL'], COLOMBIA: ['BOG', 'MDE'], PERU: ['LIM'], URUGUAY: ['MVD'],
  'REPUBLICA DOMINICANA': ['PUJ', 'SDQ'], CUBA: ['HAV'], 'COSTA RICA': ['SJO'], 'PUERTO RICO': ['SJU'],
  JAPON: ['NRT', 'HND', 'KIX'], TAILANDIA: ['BKK', 'HKT'], 'COREA DEL SUR': ['ICN'],
  'EMIRATOS ARABES': ['DXB'], AUSTRALIA: ['SYD', 'MEL'], 'NUEVA ZELANDA': ['AKL'],
  MIAMI: ['MIA'], 'NUEVA YORK': ['JFK', 'EWR'], TOKIO: ['NRT', 'HND'], CANCUN: ['CUN'],
  PARIS: ['CDG', 'ORY'], 'RIO DE JANEIRO': ['GIG'], MADRID: ['MAD'],
};

function dates(min?: string, max = min): string[] {
  if (!min || !max || !/^\d{4}-\d{2}-\d{2}$/.test(min) || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return [];
  const start = Date.parse(min), end = Date.parse(max);
  if (!Number.isFinite(start + end) || end < start || (end - start) / 86400000 > 366) return [];
  if (new Date(start).toISOString().slice(0, 10) !== min || new Date(end).toISOString().slice(0, 10) !== max) return [];
  return Array.from({ length: (end - start) / 86400000 + 1 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}

/** Stable Cartesian coverage: no hidden 10–20 day rule, random sampling, or first-country fallback. */
export function buildSearchSpace(alert: SearchAlert, now = new Date()): FlightSearchParams[] {
  const origins = [...new Set(alert.origen.split(/[,/]/).map(normalize).filter(c => /^[A-Z]{3}$/.test(c)))];
  const targets = alert.paises?.length && !alert.paises.some(p => normalize(p) === 'CUALQUIERA')
    ? alert.paises : [alert.destino];
  const airports = [...new Set(targets.flatMap(t => destinations[normalize(t)] || (/^[A-Z]{3}$/.test(normalize(t)) ? [normalize(t)] : [])))];
  const pax = Number(alert.pasajeros);
  if (!Number.isInteger(pax) || pax < 1 || pax > 9) return [];
  const departures = dates(alert.fecha_ida_min, alert.fecha_ida_max || alert.fecha_ida_min);
  const returns = dates(alert.fecha_vuelta_min, alert.fecha_vuelta_max || alert.fecha_vuelta_min);
  const searches: FlightSearchParams[] = [];
  // Interleave destinations so one large date window cannot monopolize the source.
  for (const departureDate of departures) for (const returnDate of returns) {
    if (returnDate <= departureDate || departureDate < now.toISOString().slice(0, 10)) continue;
    for (const origin of origins) for (const destination of airports) {
      searches.push({ origin, destination, departureDate, returnDate, passengers: pax,
        maxStops: Math.min(1, alert.escalas_max ?? 1), budgetMinUSD: Number(alert.presupuesto_min ?? 0),
        budgetMaxUSD: Number(alert.presupuesto_max ?? 1200 * pax), excludedAirlines: alert.aerolineas_excluidas || [] });
    }
  }
  return searches;
}

export function searchKey(params: FlightSearchParams): string {
  return JSON.stringify([params.origin, params.destination, params.departureDate, params.returnDate,
    params.passengers, params.maxStops ?? 1, [...(params.excludedAirlines || [])].map(normalize).sort(), 'USD', 'economy']);
}

export function roundRobin<T>(items: readonly T[], cursor: number, limit: number): T[] {
  if (!items.length) return [];
  return Array.from({ length: Math.min(items.length, Math.max(0, limit)) }, (_, i) => items[(Math.max(0, cursor) + i) % items.length]);
}
