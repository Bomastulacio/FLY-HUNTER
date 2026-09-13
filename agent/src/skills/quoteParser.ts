import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import { normalizedAirline } from '../agent/quotePolicy.js';

/** USD only. Never guess an ARS exchange rate or erase decimal cents. */
export function parseUsd(text: string): number | undefined {
  // Whitespace may group thousands, never unrelated values (e.g. "USD 1925 1 escala").
  const amount = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)*)`;
  const matches = [...text.matchAll(new RegExp(`(?:US\\$|USD)\\s*(${amount})|(${amount})\\s*(?:US\\$|USD)`, 'gi'))];
  if (matches.length !== 1) return undefined;
  let value = (matches[0][1] || matches[0][2]).replace(/\s/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) return undefined;
  const separator = value.match(/[.,](\d{1,2})$/);
  if (separator) {
    const last = value.lastIndexOf(separator[0][0]);
    const whole = value.slice(0, last);
    if (/[.,]/.test(whole) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(whole)) return undefined;
    value = whole.replace(/[.,]/g, '') + '.' + separator[1];
  } else {
    if (/[.,]/.test(value) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) return undefined;
    value = value.replace(/[.,]/g, '');
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function readStops(text: string): number[] {
  return [...text.matchAll(/\b(\d+)\s*(?:escalas?|stops?)\b|\b(?:directo|sin escalas|nonstop|non-stop)\b/gi)]
    .map(m => m[1] ? Number(m[1]) : 0);
}

export function verifiedPassengerCount(text: string): number | undefined {
  const normalized = normalizedAirline(text);
  const counts = [...normalized.matchAll(/\b(?:final|total|para|for)\s+(\d+)\s+(?:personas?|adultos?|adults?|pasajeros?|passengers?)\b/g)].map(m => Number(m[1]));
  const included = normalized.match(/precio incluye.*?correspondientes a\s+(\d+)\s+adultos/);
  if (included) counts.push(Number(included[1]));
  const unique = [...new Set(counts)];
  return unique.length === 1 ? unique[0] : undefined;
}

const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept?', 'oct', 'nov', 'dic'];
function containsDate(text: string, iso: string): boolean {
  if (text.includes(iso)) return true;
  const [year, month, day] = iso.split('-').map(Number);
  const pattern = new RegExp(`\\b0?${day}\\s*(?:de\\s+)?${months[month - 1]}[a-z]*\\.?\\s*(?:de\\s+)?${year}\\b`, 'i');
  return pattern.test(text) || new RegExp(`\\b0?${day}[/-]0?${month}[/-]${year}\\b`).test(text);
}

export interface CardSnapshot {
  text: string;
  airlineNames: string[];
  pagePassengerCount?: number;
  bookingUrl: string;
  collectedAt: string;
}

export function parseCard(source: ScrapedFlightOption['source'], card: CardSnapshot, p: FlightSearchParams): ScrapedFlightOption | undefined {
  const total = parseUsd(card.text);
  const pax = verifiedPassengerCount(card.text) ?? card.pagePassengerCount;
  const stops = readStops(card.text);
  if (!total || pax !== p.passengers || !stops.length || stops.some(s => s > Math.min(1, p.maxStops ?? 1))) return undefined;
  if (source === 'despegar') {
    // A whole return ticket must contain both directions, both dates and the requested airports.
    if (stops.length < 2 || !/\bida\b/i.test(card.text) || !/\bvuelta\b/i.test(card.text)) return undefined;
    if (![p.origin, p.destination].every(code => new RegExp(`\\b${code}\\b`).test(card.text))) return undefined;
    if (!containsDate(card.text, p.departureDate) || !containsDate(card.text, p.returnDate)) return undefined;
  }
  const airlineNames = [...new Set(card.airlineNames.map(a => a.replace(/^(?:logo(?:tipo)?(?: de)?|imagen de)\s+/i, '').trim()).filter(a => a.length > 2 && a.length < 80))];
  if (!airlineNames.length) return undefined;
  const airline = airlineNames.join(' / ');
  if (p.excludedAirlines?.some(a => a.trim() && ` ${normalizedAirline(airline)} `.includes(` ${normalizedAirline(a)} `))) return undefined;
  const paymentCondition = /con d[eé]bito/i.test(card.text) ? 'Precio con débito' :
    /(?:exclusivo|solo)\s+(?:con|para)\b/i.test(card.text) ? 'Tarifa condicionada: revisá el medio de pago en la fuente' : undefined;
  return { source, airline, route: `${p.origin} - ${p.destination}`, departureDate: p.departureDate,
    returnDate: p.returnDate, stops: Math.max(...stops), priceTotalUSD: total, passengers: pax,
    pricePerPaxUSD: Math.round(total / pax * 100) / 100, priceRawText: `USD ${total}`,
    bookingUrl: card.bookingUrl, collectedAt: card.collectedAt, paymentCondition,
    evidence: { priceBasis: 'party_total', passengersVerified: true,
      itineraryScope: source === 'despegar' ? 'roundtrip' : 'search_result', stopsPerDirection: stops } };
}

export function challenged(text: string, status?: number): boolean {
  return status === 403 || status === 429 || /captcha|verification required|slide right to secure|unusual (?:activity|traffic)|verify you are human|verific[aá] que sos humano|GPS perdi[oó] (?:la )?se[nñ]al/i.test(text);
}
