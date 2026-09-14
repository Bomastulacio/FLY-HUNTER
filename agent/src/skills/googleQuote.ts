import type { FlightSearchParams } from '../types/flight.js';
import { parseCard, parseUsd } from './quoteParser.js';

const spanishMonths = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function departureDateMatches(label: string, requested: string): boolean {
  const date = label.match(/\bSale de .+? el (.+?) a las? \d{1,2}[:.]\d{2}/i)?.[1];
  // Some rows omit a date; their scope still comes from the verified page controls.
  // An explicit row date, however, must never be replaced with the requested one.
  if (!date) return true;
  const normalized = date.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/^(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo),?\s*/, '')
    .replace(/,/g, '').trim();
  const [year, month, day] = requested.split('-').map(Number);
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Number(iso[1]) === year && Number(iso[2]) === month && Number(iso[3]) === day;
  const monthFirst = normalized.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(?:de\s+)?(\d{4}))?$/);
  const dayFirst = normalized.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/);
  const namedMonth = monthFirst?.[1] ?? dayFirst?.[2];
  const actualDay = Number(monthFirst?.[2] ?? dayFirst?.[1]);
  const actualYear = monthFirst?.[3] ?? dayFirst?.[3];
  return !!namedMonth && spanishMonths.indexOf(namedMonth) + 1 === month && actualDay === day
    && (!actualYear || Number(actualYear) === year);
}

/** Both independent DOM representations must describe the SAME visible result. */
export function parseGoogleResult(input: {
  label: string; visiblePrices: string[]; passengers?: number; bookingUrl: string; collectedAt: string;
}, p: FlightSearchParams) {
  const label = input.label.replace(/\s+/g, ' ').trim();
  const match = label.match(/^A partir de ([\d.,]+) dólares estadounidenses \(precio total de ida y vuelta\)\. Vuelo (directo|con (\d+) escalas?) de (.+?)\. (?:Operado por (.+?)\. )?Sale de /i);
  if (!match) return undefined;
  if (!departureDateMatches(label, p.departureDate)) return undefined;
  const accessiblePrice = parseUsd(`USD ${match[1]}`);
  const prices = input.visiblePrices.map(parseUsd);
  if (!prices.length || !accessiblePrice || prices.some(price => price !== accessiblePrice)) return undefined;
  const airline = [match[4], match[5]].filter(Boolean).join(' / ');
  if (airline.length > 160 || /aeropuerto|ida y vuelta|\d+\s*(?:h|min)|[<>]/i.test(airline)) return undefined;
  const quote = parseCard('google_flights', {
    text: `USD ${accessiblePrice} ${match[3] ? `${match[3]} escala` : 'Directo'}`,
    airlineNames: [match[4], ...(match[5] ? match[5].split(',').map(s => s.trim()) : [])],
    pagePassengerCount: input.passengers, bookingUrl: input.bookingUrl, collectedAt: input.collectedAt,
  }, p);
  if (!quote?.evidence) return undefined;
  quote.durationText = label.match(/Duración total: ([^.]+)\./)?.[1];
  quote.evidence = { ...quote.evidence, googleParserVersion: 2, searchView: 'cheapest',
    priceVerified: true, queryVerified: true, fareType: 'from_price' };
  return quote;
}
