import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUsd,
  blankCapture,
  draftFromVisibleText,
  readCaptureFile,
  captureErrors,
  personalSavedPayload,
  type CaptureDraft
} from '../../shared/personalCapture.js';
import { watchTargets, savedChecks, type SavedDeal } from '../src/agent/monitoring.js';
import { monitoredSavedDeal, meaningfulDrop } from '../../frontend/src/utils/monitoringView.js';
import { renderCompactFlight } from '../../frontend/src/utils/compactFlights.js';
import { buildSearchSpace } from '../src/agent/searchPlanner.js';

const now = new Date('2026-09-15T12:00:00Z');

test('parseUsd extracts valid USD amounts with different locale conventions and rejects ambiguous text', () => {
  assert.equal(parseUsd('Precio final: US$ 1.884,50'), 1884.50);
  assert.equal(parseUsd('Total: 1,884.50 USD'), 1884.50);
  assert.equal(parseUsd('Tarifa: USD 950'), 950);
  assert.equal(parseUsd('Tarifa: 1200 US$'), 1200);

  // Ambiguous: multiple distinct prices in the same text
  assert.equal(parseUsd('Ida US$ 900 y Vuelta US$ 984'), undefined);
  // No USD
  assert.equal(parseUsd('Total: ARS 2.500.000'), undefined);
  assert.equal(parseUsd('Total: $ 1.884'), undefined);
});

test('draftFromVisibleText extracts visible details from Despegar fixture', () => {
  const text = `
    Vuelos a Madrid desde Buenos Aires
    Total final para 2 adultos: US$ 1.884
    Ida: EZE a MAD el 18 de abril de 2027, 1 escala
    Vuelta: MAD a EZE el 01 de mayo de 2027, 1 escala
    Precio con débito
  `;
  const draft = draftFromVisibleText('despegar', text, ['Iberia'], now);
  assert.equal(draft.sourceProvider, 'despegar');
  assert.equal(draft.origin, 'EZE');
  assert.equal(draft.destination, 'MAD');
  assert.equal(draft.departureDate, '2027-04-18');
  assert.equal(draft.returnDate, '2027-05-01');
  assert.equal(draft.passengers, 2);
  assert.equal(draft.totalUsd, 1884);
  assert.equal(draft.outboundStops, 1);
  assert.equal(draft.returnStops, 1);
  assert.equal(draft.airline, 'Iberia');
  assert.equal(draft.paymentCondition, 'Con débito');
});

test('draftFromVisibleText extracts Aerolíneas Argentinas summary and sets carrier default', () => {
  const text = `
    Tu selección de vuelo
    Ida: EZE - MIA 2027-06-10 sin escalas
    Regreso: MIA - EZE 2027-06-25 sin escalas
    Total para 2 pasajeros: USD 1.750,00
  `;
  const draft = draftFromVisibleText('aerolineas', text, [], now);
  assert.equal(draft.sourceProvider, 'aerolineas');
  assert.equal(draft.origin, 'EZE');
  assert.equal(draft.destination, 'MIA');
  assert.equal(draft.departureDate, '2027-06-10');
  assert.equal(draft.returnDate, '2027-06-25');
  assert.equal(draft.passengers, 2);
  assert.equal(draft.totalUsd, 1750);
  assert.equal(draft.outboundStops, 0);
  assert.equal(draft.returnStops, 0);
  assert.equal(draft.airline, 'Aerolíneas Argentinas');
});

test('Turismocity always returns blank capture for manual verification', () => {
  const text = 'Oferta Turismocity EZE MAD 2027-04-18 2027-05-01 Total US$ 1500';
  const draft = draftFromVisibleText('turismocity', text, ['Air Europa'], now);
  assert.equal(draft.sourceProvider, 'turismocity');
  assert.equal(draft.origin, '');
  assert.equal(draft.destination, '');
  assert.equal(draft.totalUsd, null);
});

test('draftFromVisibleText detects CAPTCHA or oversized text and aborts parsing', () => {
  const captchaText = 'Por favor verificá que sos humano para continuar. Completa el CAPTCHA.';
  const draft = draftFromVisibleText('despegar', captchaText, [], now);
  assert.equal(draft.origin, '');
  assert.equal(draft.totalUsd, null);

  const hugeText = 'a'.repeat(25000);
  const hugeDraft = draftFromVisibleText('despegar', hugeText, [], now);
  assert.equal(hugeDraft.origin, '');
});

test('readCaptureFile validates schema version, whitelists fields, and rejects malicious/corrupt input', () => {
  const validJson = JSON.stringify({
    version: 1,
    sourceProvider: 'despegar',
    observedAt: now.toISOString(),
    origin: 'EZE',
    destination: 'MAD',
    departureDate: '2027-04-18',
    returnDate: '2027-05-01',
    passengers: 2,
    totalUsd: 1884,
    airline: 'Iberia',
    outboundStops: 1,
    returnStops: 1,
    paymentCondition: 'Con débito',
    baggage: '1 carry-on por pasajero',
    extraMaliciousUrl: 'https://evil.com/steal',
    cookie: 'session=secret'
  });

  const parsed = readCaptureFile(validJson, now.getTime());
  assert.equal(parsed.version, 1);
  assert.equal(parsed.origin, 'EZE');
  assert.equal(parsed.destination, 'MAD');
  assert.equal(parsed.totalUsd, 1884);
  // Untrusted properties are never imported into draft
  assert.equal((parsed as any).extraMaliciousUrl, undefined);
  assert.equal((parsed as any).cookie, undefined);

  // Future timestamp > 5 min rejects
  const futureJson = JSON.stringify({
    version: 1,
    sourceProvider: 'despegar',
    observedAt: new Date(now.getTime() + 600000).toISOString(),
    origin: 'EZE',
    destination: 'MAD'
  });
  assert.throws(() => readCaptureFile(futureJson, now.getTime()), /fecha de observación/);

  // Wrong version rejects
  assert.throws(() => readCaptureFile(JSON.stringify({ version: 2, sourceProvider: 'despegar' })), /no compatible/);
  // Corrupt json rejects
  assert.throws(() => readCaptureFile('{ broken json'), /SyntaxError/);
});

test('captureErrors and personalSavedPayload validate constraints and build safe saved_deals payload', () => {
  const validDraft: CaptureDraft = {
    version: 1,
    sourceProvider: 'despegar',
    observedAt: now.toISOString(),
    origin: 'EZE',
    destination: 'MAD',
    departureDate: '2027-04-18',
    returnDate: '2027-05-01',
    passengers: 2,
    totalUsd: 1884,
    airline: 'Iberia',
    outboundStops: 1,
    returnStops: 1,
    paymentCondition: 'Con débito',
    baggage: 'Mochila + Carry-on'
  };

  const errors = captureErrors(validDraft, now.getTime());
  assert.equal(errors.length, 0);

  const payload = personalSavedPayload(validDraft, 'user-123', now);
  assert.equal(payload.user_id, 'user-123');
  assert.equal(payload.flight_deal_id, null);
  assert.equal(payload.origen, 'EZE');
  assert.equal(payload.destino, 'MAD');
  assert.equal(payload.ida_fecha, '2027-04-18');
  assert.equal(payload.vuelta_fecha, '2027-05-01');
  assert.equal(payload.pasajeros, 2);
  assert.equal(payload.precio_total_usd, 1884);
  assert.equal(payload.precio_por_pasajero_usd, 942);
  assert.equal(payload.fuente, 'manual_capture');
  assert.equal(payload.cantidad_escalas, 1);
  assert.equal(payload.detalle_cotizacion.sourceProvider, 'despegar');
  assert.equal(payload.detalle_cotizacion.captureMethod, 'user_reviewed');

  // Test invalid draft
  const invalidDraft: CaptureDraft = {
    ...validDraft,
    origin: 'EZE',
    destination: 'EZE', // Same destination
    totalUsd: -50,
    outboundStops: 3 // More than 1 stop
  };
  const invalidErrors = captureErrors(invalidDraft, now.getTime());
  assert.ok(invalidErrors.length >= 3);
  assert.throws(() => personalSavedPayload(invalidDraft, 'user-123', now));
});

test('Manual captures are completely excluded from agent automated watchTargets and savedChecks', () => {
  const alert = {
    id: 'radar-1',
    user_id: 'owner',
    origen: 'EZE',
    destino: 'MAD',
    pasajeros: 2,
    escalas_max: 1,
    presupuesto_max: 2400,
    fecha_ida_min: '2027-04-17',
    fecha_ida_max: '2027-04-19',
    fecha_vuelta_min: '2027-05-01',
    fecha_vuelta_max: '2027-05-03'
  };
  const space = buildSearchSpace(alert, now);
  const manualSaved: SavedDeal = {
    id: 'manual-1',
    user_id: 'owner',
    origen: 'EZE',
    destino: 'MAD',
    ida_fecha: '2027-04-18',
    vuelta_fecha: '2027-05-01',
    pasajeros: 2,
    aerolinea: 'Iberia',
    cantidad_escalas: 1,
    fuente: 'manual_capture',
    precio_total_usd: 1884,
    guardado_el: now.toISOString()
  };

  // watchTargets must NOT return any targets for manual_capture
  assert.deepEqual(watchTargets(alert, space, [manualSaved], 'despegar'), []);
  assert.deepEqual(watchTargets(alert, space, [manualSaved], 'google_flights'), []);

  // savedChecks must NOT generate any verification checks for manual_capture
  const searchParam = space.find(p => p.departureDate === '2027-04-18' && p.returnDate === '2027-05-01')!;
  const result = { status: 'ok' as const, options: [] };
  const checks = savedChecks(alert, searchParam, 'despegar', result, [manualSaved], now.toISOString());
  assert.deepEqual(checks, []);
});

test('monitoredSavedDeal projects manual capture with explicit non-tracking status and meaningfulDrop returns false', () => {
  const manualSaved = {
    id: 'manual-1',
    user_id: 'owner',
    origen: 'EZE',
    destino: 'MAD',
    ida_fecha: '2027-04-18',
    vuelta_fecha: '2027-05-01',
    pasajeros: 2,
    aerolinea: 'Iberia',
    cantidad_escalas: 1,
    fuente: 'manual_capture',
    precio_total_usd: 1884,
    guardado_el: now.toISOString()
  };

  const projected = monitoredSavedDeal(manualSaved, null, now.getTime());
  assert.equal(projected.tracking_status, 'Captura personal (sin seguimiento automático)');
  assert.equal(projected.tracking_observed, false);
  assert.equal(projected.tracking_stale, false);

  // Meaningful drop must always be false for manual captures
  assert.equal(meaningfulDrop(manualSaved, { outcome: 'observed', last_quote: { precio_total_usd: 1200 } }, now.getTime()), false);
});

test('renderCompactFlight renders Captura personal badge and keeps Data Scientist insight inside details', () => {
  const manualDeal = {
    id: 'manual-deal-1',
    origen: 'EZE',
    destino: 'MAD',
    ida_origen_destino: 'EZE-MAD',
    vuelta_origen_destino: 'MAD-EZE',
    ida_fecha: '2027-04-18',
    vuelta_fecha: '2027-05-01',
    pasajeros: 2,
    precio_total_usd: 1884,
    aerolinea: 'Iberia',
    cantidad_escalas: 1,
    fuente: 'manual_capture',
    guardado_el: now.toISOString(),
    detalle_cotizacion: {
      sourceProvider: 'despegar',
      observedAt: now.toISOString()
    }
  };

  const alert = { presupuesto_max: 2400, pasajeros: 2 };
  const insight = {
    ruta: 'EZE-MAD',
    precio_promedio_7d: 1950,
    minimo_historico: 1800,
    tendencia: -15
  };

  const html = renderCompactFlight(manualDeal, alert, false, 'España', true, insight);

  // Badge present in the card
  assert.ok(html.includes('Captura personal'));
  assert.ok(html.includes('Ver en Despegar'));

  // Verify Data Scientist block is inside details
  assert.ok(html.includes('<details class="flight-explanation">'));
  assert.ok(html.includes('Análisis de ruta (Data Scientist):'));
  assert.ok(html.includes('Promedio 7 días:'));

  // Ensure Data Scientist label is NOT in summary
  const summaryPart = html.slice(0, html.indexOf('</summary>'));
  assert.ok(!summaryPart.includes('Data Scientist'));
  assert.ok(!summaryPart.includes('Análisis de ruta'));
});
