import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyRadar } from '../../frontend/src/utils/dailyRadar.js';
import { renderCompactFlight } from '../../frontend/src/utils/compactFlights.js';

const now = Date.parse('2026-10-02T15:00:00Z');
const radar = { origen: 'EZE', destino: 'Europa', paises: ['España', 'Italia'], pasajeros: 2, escalas_max: 1, presupuesto_min: 1700, presupuesto_max: 2400,
  fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19', fecha_vuelta_min: '2027-05-01', fecha_vuelta_max: '2027-05-03', aerolineas_excluidas: ['LEVEL'] };
const quote = (id: string, price: number, extra: any = {}) => ({ id, ida_origen_destino: 'EZE-MAD', vuelta_origen_destino: 'MAD-EZE', ida_fecha: '2027-04-18', vuelta_fecha: '2027-05-01', pasajeros: 2,
  cantidad_escalas: 1, precio_total_usd: price, aerolinea: 'Iberia', fuente: 'despegar', estado_aprobacion: 'aprobado', created_at: '2026-10-02T12:00:00Z',
  detalle_cotizacion: { priceBasis: 'party_total', passengersVerified: true, itineraryScope: 'roundtrip', stopsPerDirection: [1, 1] }, ...extra });

test('Daily brief replaces old cheap quotes before budget filtering and keeps Italy visible', () => {
  const state = dailyRadar([quote('old', 1800, { created_at: '2026-10-02T09:00:00Z' }), quote('new', 2700),
    quote('italy', 2300, { ida_origen_destino: 'EZE-FCO', vuelta_origen_destino: 'FCO-EZE' })], radar, now);
  assert.equal(state.best.id, 'italy');
  assert.equal(state.rows[0].quote.id, 'new');
  assert.equal(state.rows[0].aboveBudget, true);
  assert.equal(state.above.id, 'new');
});

test('A stale, rejected, unknown, excluded or wrong-passenger price never becomes the daily winner', () => {
  for (const extra of [{ created_at: '2026-09-30T12:00:00Z' }, { estado_aprobacion: 'rechazado' }, { estado_aprobacion: 'pendiente' },
    { pasajeros: 1 }, { aerolinea: 'LEVEL' }, { detalle_cotizacion: {} }, { cantidad_escalas: 2 }]) {
    assert.equal(dailyRadar([quote('invalid', 1100, extra)], radar, now).best, null);
  }
});

test('Alternative needs a real improvement on matching dates, payment and verified return', () => {
  const cheap = quote('cheap', 1800);
  const direct = quote('direct', 2100, { cantidad_escalas: 0, detalle_cotizacion: { ...cheap.detalle_cotizacion, stopsPerDirection: [0, 0] } });
  assert.equal(dailyRadar([cheap, direct], radar, now).alternative?.id, 'direct');
  for (const extra of [{ ida_fecha: '2027-04-19' }, { precio_total_usd: 2300 },
    { detalle_cotizacion: { ...direct.detalle_cotizacion, itineraryScope: 'search_result' } },
    { detalle_cotizacion: { ...direct.detalle_cotizacion, paymentCondition: 'Solo efectivo' } }]) {
    assert.equal(dailyRadar([cheap, { ...direct, ...extra }], radar, now).alternative, null);
  }
});

test('Unvalidated OTA URLs open an explicitly labelled passenger-aware search, not a fake reservation', () => {
  const html = renderCompactFlight(quote('ota', 2000, { link_reserva: 'https://www.despegar.com.ar/vuelos/results/roundtrip/test' }), radar);
  assert.match(html, /Como no hay un enlace de reserva validado/);
  assert.match(html, /for%202%20adults/);
  assert.doesNotMatch(html, /href="https:\/\/www.despegar/);
});
