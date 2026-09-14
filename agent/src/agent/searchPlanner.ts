import { createHash } from 'node:crypto';
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

/** Visit the middle of each remaining interval, then its halves: stable, bounded and exhaustive. */
function spread<T>(items: readonly T[]): T[] {
  const result: T[] = [];
  const ranges: Array<[number, number]> = [[0, items.length - 1]];
  for (let cursor = 0; cursor < ranges.length; cursor++) {
    const [start, end] = ranges[cursor];
    if (start > end) continue;
    const middle = Math.floor((start + end) / 2);
    result.push(items[middle]);
    if (start < middle) ranges.push([start, middle - 1]);
    if (middle < end) ranges.push([middle + 1, end]);
  }
  return result;
}

/** Stable Cartesian coverage: distribute dates/routes early without dropping any valid combination. */
export function buildSearchSpace(alert: SearchAlert, now = new Date()): FlightSearchParams[] {
  const origins = [...new Set(alert.origen.split(/[,/]/).map(normalize).filter(c => /^[A-Z]{3}$/.test(c)))];
  const targets = alert.paises?.length && !alert.paises.some(p => normalize(p) === 'CUALQUIERA')
    ? alert.paises : [alert.destino];
  const targetAirports = targets.map(t => destinations[normalize(t)] || (/^[A-Z]{3}$/.test(normalize(t)) ? [normalize(t)] : []));
  // Take one airport per requested country before its secondary airports.
  const airports = [...new Set(Array.from({ length: Math.max(0, ...targetAirports.map(a => a.length)) },
    (_, index) => targetAirports.flatMap(a => a[index] ? [a[index]] : [])).flat())];
  const pax = Number(alert.pasajeros);
  if (!Number.isInteger(pax) || pax < 1 || pax > 9) return [];
  const departures = dates(alert.fecha_ida_min, alert.fecha_ida_max || alert.fecha_ida_min);
  const returns = dates(alert.fecha_vuelta_min, alert.fecha_vuelta_max || alert.fecha_vuelta_min);
  const datePairs: Array<{ departureDate: string; returnDate: string }> = [];
  const today = now.toISOString().slice(0, 10);
  for (const departureDate of departures) for (const returnDate of returns) {
    if (returnDate <= departureDate || departureDate < today) continue;
    datePairs.push({ departureDate, returnDate });
  }
  const balancedDates = spread(datePairs);
  const routes = airports.flatMap(destination => origins.map(origin => ({ origin, destination })));
  const searches: FlightSearchParams[] = [];
  // Every route receives every valid date pair exactly once. The phase per route
  // avoids spending an entire early pass on the same departure/return dates.
  // A changed order has a new signature; quota reservations/cooldowns remain intact.
  for (let dateRound = 0; dateRound < balancedDates.length; dateRound++) {
    for (const [routeIndex, { origin, destination }] of routes.entries()) {
      const { departureDate, returnDate } = balancedDates[(dateRound + routeIndex) % balancedDates.length];
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

/** Budget affects eligibility, not supplier I/O: editing it must not reset the exploration cursor. */
export function searchSpaceSignature(searches: FlightSearchParams[]): string {
  return createHash('sha256').update(JSON.stringify(searches.map(searchKey))).digest('hex').slice(0, 16);
}

export type SearchFocus = Pick<FlightSearchParams, 'origin' | 'destination' | 'departureDate' | 'returnDate' | 'passengers'>;

/** One-run priority, never permission to leave an active radar or increase provider limits. */
export function parseSearchFocus(value: string): SearchFocus | undefined {
  if (!value.trim()) return undefined;
  const fields = value.split(',').map(v => v.trim());
  const [origin, destination, departureDate, returnDate, passengers] = fields;
  if (fields.length !== 5 || ![origin, destination].every(v => /^[A-Z]{3}$/.test(v))
    || !dates(departureDate).length || !dates(returnDate).length || returnDate <= departureDate || !/^[1-9]$/.test(passengers)) {
    throw new Error('Foco inválido: usá origen,destino,ida,vuelta,adultos con fechas YYYY-MM-DD');
  }
  return { origin, destination, departureDate, returnDate, passengers: Number(passengers) };
}

export function matchesFocus(p: FlightSearchParams, focus: SearchFocus): boolean {
  return p.origin === focus.origin && p.destination === focus.destination && p.departureDate === focus.departureDate
    && p.returnDate === focus.returnDate && p.passengers === focus.passengers;
}

export function roundRobin<T>(items: readonly T[], cursor: number, limit: number): T[] {
  if (!items.length) return [];
  return Array.from({ length: Math.min(items.length, Math.max(0, limit)) }, (_, i) => items[(Math.max(0, cursor) + i) % items.length]);
}
