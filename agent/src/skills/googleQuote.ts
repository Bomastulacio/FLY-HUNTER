import type { FlightSearchParams } from '../types/flight.js';
import { parseCard, parseUsd } from './quoteParser.js';

/** Both independent DOM representations must describe the SAME visible result. */
export function parseGoogleResult(input: {
  label: string; visiblePrices: string[]; passengers?: number; bookingUrl: string; collectedAt: string;
}, p: FlightSearchParams) {
  const label = input.label.replace(/\s+/g, ' ').trim();
  const match = label.match(/^A partir de ([\d.,]+) dólares estadounidenses \(precio total de ida y vuelta\)\. Vuelo (directo|con (\d+) escalas?) de (.+?)\. (?:Operado por (.+?)\. )?Sale de /i);
  if (!match) return undefined;
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
