/** Portable, offline capture contract. Browser observations are never pipeline evidence. */
export const CAPTURE_VERSION = 1;
export const PERSONAL_SOURCE = 'manual_capture';
export const captureProviders = {
  despegar: { name: 'Despegar', url: 'https://www.despegar.com.ar/' },
  aerolineas: { name: 'Aerolíneas Argentinas', url: 'https://www.aerolineas.com.ar/' },
  turismocity: { name: 'Turismocity', url: 'https://www.turismocity.com.ar/' },
} as const;
export type CaptureProvider = keyof typeof captureProviders;
export interface CaptureDraft {
  version: 1;
  sourceProvider: CaptureProvider;
  observedAt: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  passengers: number | null;
  totalUsd: number | null;
  airline: string;
  outboundStops: number | null;
  returnStops: number | null;
  paymentCondition: string;
  baggage: string;
}

/** USD only: accept both locale conventions, reject ambiguous multiple amounts. */
export function parseUsd(text: string): number | undefined {
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

export function blankCapture(provider: CaptureProvider = 'despegar', now = new Date()): CaptureDraft {
  return { version: 1, sourceProvider: provider, observedAt: now.toISOString(), origin: '', destination: '',
    departureDate: '', returnDate: '', passengers: null, totalUsd: null, airline: '',
    outboundStops: null, returnStops: null, paymentCondition: '', baggage: '' };
}
function validDate(value: string): boolean {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function dateFromText(text: string): string {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  const named = text.match(/\b(\d{1,2})\s*(?:de\s+)?(ene\w*|feb\w*|mar\w*|abr\w*|may\w*|jun\w*|jul\w*|ago\w*|sep\w*|oct\w*|nov\w*|dic\w*)\.?\s*(?:de\s+)?(20\d{2})\b/i);
  const month = named ? ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(named[2].slice(0,3).toLowerCase()) + 1 : 0;
  const date = iso?.[1] || (numeric ? `${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}`
    : named ? `${named[3]}-${String(month).padStart(2,'0')}-${named[1].padStart(2,'0')}` : '');
  return validDate(date) ? date : '';
}
function direction(text: string) {
  const airports = [...text.matchAll(/\b[A-Z]{3}\b/g)].map(m => m[0]).filter(code => !['USD','ARS','EUR','IDA'].includes(code));
  const stops = [...new Set([...text.matchAll(/\b(\d+)\s*escalas?\b|\b(?:directo|sin escalas)\b/gi)].map(m => m[1] ? Number(m[1]) : 0))];
  return { airports, date: dateFromText(text), stops: stops.length === 1 ? stops[0] : null };
}

/** Suggestions only. Missing or conflicting fields stay empty for human review. */
export function draftFromVisibleText(provider: CaptureProvider, text: string, airlineNames: string[] = [], now = new Date()): CaptureDraft {
  const d = blankCapture(provider, now);
  if (provider === 'turismocity' || text.length > 20000 || /captcha|verific[aá].{0,12}humano|GPS perdi[oó]/i.test(text)) return d;
  const counts = [...new Set([...text.matchAll(/\b(?:final|total|para)\s+(\d+)\s*(?:personas?|adultos?|pasajeros?)\b|\b(\d+)\s*adultos?\b/gi)].map(m => Number(m[1] || m[2])))];
  d.passengers = counts.length === 1 && counts[0] > 0 && counts[0] <= 9 ? counts[0] : null;
  // Per-leg/per-person tables do not establish a group total.
  if (d.passengers && /\b(?:final|total)\b/i.test(text) && !/por\s+(?:persona|adulto|pasajero)|por\s+tramo/i.test(text)) d.totalUsd = parseUsd(text) ?? null;
  const markers = [...text.matchAll(/\b(ida|vuelta|regreso)\b/gi)];
  const legs = markers.map((m, i) => ({ name: m[1].toLowerCase(), ...direction(text.slice(m.index! + m[0].length, markers[i + 1]?.index)) }));
  const outbound = legs.filter(l => l.name === 'ida' && l.date && l.airports.length >= 2);
  const inbound = legs.filter(l => l.name !== 'ida' && l.date && l.airports.length >= 2);
  if (outbound.length === 1 && inbound.length === 1) {
    const a = outbound[0], b = inbound[0];
    if (a.airports[0] === b.airports[1] && a.airports[1] === b.airports[0]) {
      Object.assign(d, { origin: a.airports[0], destination: a.airports[1], departureDate: a.date,
        returnDate: b.date, outboundStops: a.stops, returnStops: b.stops });
    }
  }
  d.airline = [...new Set(airlineNames.map(s => s.trim()).filter(s => s.length > 2 && s.length <= 80))].join(' / ').slice(0, 160);
  if (!d.airline && provider === 'aerolineas') d.airline = 'Aerolíneas Argentinas';
  if (/con d[eé]bito/i.test(text)) d.paymentCondition = 'Con débito';
  if (/pago en USD/i.test(text)) d.paymentCondition = 'Pago en USD';
  return d;
}

/** Whitelist a file's data. Never import URLs, identity, HTML, auth or verification flags. */
export function readCaptureFile(input: string, now = Date.now()): CaptureDraft {
  if (input.length > 16000) throw new Error('El archivo de cotización es demasiado grande.');
  const raw = JSON.parse(input);
  if (!raw || raw.version !== 1 || !Object.hasOwn(captureProviders, raw.sourceProvider)) throw new Error('Formato de captura no compatible.');
  const d = blankCapture(raw.sourceProvider);
  for (const key of ['origin','destination','departureDate','returnDate','airline','paymentCondition','baggage'] as const) {
    if (typeof raw[key] === 'string' && raw[key].length <= 200) d[key] = raw[key].trim();
  }
  for (const key of ['passengers','totalUsd','outboundStops','returnStops'] as const) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) d[key] = raw[key];
  }
  const stamp = Date.parse(raw.observedAt);
  if (!Number.isFinite(stamp) || stamp > now + 300000) throw new Error('La fecha de observación no es válida.');
  d.observedAt = new Date(stamp).toISOString();
  return d;
}

export function captureErrors(d: CaptureDraft, now = Date.now()): string[] {
  const errors: string[] = [];
  if (!Object.hasOwn(captureProviders, d.sourceProvider)) errors.push('Elegí una fuente.');
  if (!/^[A-Z]{3}$/.test(d.origin) || !/^[A-Z]{3}$/.test(d.destination) || d.origin === d.destination) errors.push('Completá dos aeropuertos IATA distintos (por ejemplo EZE y MAD).');
  if (!validDate(d.departureDate) || !validDate(d.returnDate) || d.returnDate <= d.departureDate) errors.push('Revisá las fechas de ida y vuelta.');
  if (!Number.isInteger(d.passengers) || d.passengers! < 1 || d.passengers! > 9) errors.push('Indicá entre 1 y 9 adultos.');
  if (!Number.isFinite(d.totalUsd) || d.totalUsd! <= 0 || d.totalUsd! >= 1000000 || Math.abs(d.totalUsd! * 100 - Math.round(d.totalUsd! * 100)) > 0.000001) errors.push('Indicá el total final del grupo en USD, con hasta dos decimales.');
  if (![d.outboundStops, d.returnStops].every(s => s === 0 || s === 1)) errors.push('Confirmá las escalas de ambos tramos: máximo una por tramo.');
  if (!d.airline.trim() || d.airline.length > 160) errors.push('Completá las aerolíneas de ambos tramos.');
  if (!d.paymentCondition.trim() || !d.baggage.trim() || d.paymentCondition.length > 200 || d.baggage.length > 200) errors.push('Completá pago y equipaje; podés indicar «Por confirmar».');
  const stamp = Date.parse(d.observedAt);
  if (!Number.isFinite(stamp) || stamp > now + 300000) errors.push('Revisá cuándo observaste el precio.');
  return errors;
}

export function personalSavedPayload(d: CaptureDraft, userId: string, now = new Date()) {
  const errors = captureErrors(d, now.getTime());
  if (errors.length) throw new Error(errors.join(' '));
  return { user_id: userId, flight_deal_id: null, origen: d.origin, destino: d.destination,
    ida_fecha: d.departureDate, vuelta_fecha: d.returnDate, pasajeros: d.passengers,
    precio_total_usd: d.totalUsd, precio_por_pasajero_usd: Math.round(d.totalUsd! / d.passengers! * 100) / 100,
    aerolinea: d.airline.trim(), cantidad_escalas: Math.max(d.outboundStops!, d.returnStops!),
    fuente: PERSONAL_SOURCE, link_reserva: captureProviders[d.sourceProvider].url, guardado_el: now.toISOString(),
    detalle_cotizacion: { captureVersion: 1, sourceProvider: d.sourceProvider, captureMethod: 'user_reviewed',
      observedAt: d.observedAt, priceBasis: 'party_total', itineraryScope: 'roundtrip',
      priceVerified: false, passengersVerified: false, stopsPerDirection: [d.outboundStops, d.returnStops],
      paymentCondition: d.paymentCondition.trim(), baggage: d.baggage.trim() } };
}
