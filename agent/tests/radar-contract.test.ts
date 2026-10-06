import { test } from 'node:test';
import assert from 'node:assert/strict';
import cases from '../../shared/radar-contract-cases.json' with { type: 'json' };
import catalog from '../../shared/radar-geography.json' with { type: 'json' };
import { buildSearchSpace } from '../src/agent/searchPlanner.js';
import { toObservedDeal } from '../src/agent/monitoring.js';
import { evaluateQuote } from '../src/agent/quotePolicy.js';
import { dailyRadar, emptyRadarMessage } from '../../frontend/src/utils/dailyRadar.js';
import { radarAcceptsDestination, originAirports, destinationAirports } from '../../shared/radarGeography.js';
import type { ScrapedFlightOption } from '../src/types/flight.js';

const now = new Date('2026-10-05T12:00:00Z');
const base = { origen: 'EZE', pasajeros: 1, escalas_max: 1, presupuesto_min: 0, presupuesto_max: 1526,
  fecha_ida_min: '2027-01-29', fecha_ida_max: '2027-01-29', fecha_vuelta_min: '2027-03-05', fecha_vuelta_max: '2027-03-05' };

test('Every searchable destination reaches the feed through the real quote policy and projection', () => {
  for (const destino of Object.keys(catalog.searchAirports)) {
    const radar = { ...base, destino, paises: [destino] };
    const searches = buildSearchSpace(radar, now);
    assert.ok(searches.length, destino);
    for (const p of searches) {
      const q: ScrapedFlightOption = { route: `${p.origin}-${p.destination}`, source: 'google_flights',
        airline: 'American Airlines', passengers: 1, stops: 0, priceTotalUSD: 913, pricePerPaxUSD: 913,
        departureDate: p.departureDate, returnDate: p.returnDate, collectedAt: now.toISOString(), bookingUrl: '',
        evidence: { priceBasis: 'party_total', passengersVerified: true, itineraryScope: 'search_result',
          googleParserVersion: 2, priceVerified: true, queryVerified: true, searchView: 'cheapest' } };
      const evaluation = evaluateQuote(p, q);
      assert.equal(evaluation.approvalStatus, 'aprobado');
      const row = { ...toObservedDeal(q), id: destino + p.destination, estado_aprobacion: evaluation.approvalStatus };
      assert.equal(dailyRadar([row], radar, now.getTime()).best?.id, row.id, `${destino} / ${p.destination}`);
      assert.equal(dailyRadar([{ ...row, pasajeros: 2 }], radar, now.getTime()).best, null);
      assert.equal(dailyRadar([{ ...row, cantidad_escalas: 2 }], radar, now.getTime()).best, null);
    }
  }
});

test('Shared Python/TypeScript regression cases cover region-in-countries, accents, cities and IATA', () => {
  for (const entry of cases) {
    const radar = { ...base, ...entry };
    assert.ok(buildSearchSpace(radar, now).some(p => p.destination === entry.airport));
    assert.ok(radarAcceptsDestination(radar, entry.airport));
    assert.equal(radarAcceptsDestination(radar, 'ZZZ'), false);
    const origin = entry.originAirport || base.origen;
    const plan = buildSearchSpace(radar, now).find(p => p.origin === origin && p.destination === entry.airport)!;
    assert.ok(plan, `${radar.origen} -> ${entry.airport}`);
    const quote: ScrapedFlightOption = { route: `${origin}-${entry.airport}`, source: 'google_flights',
      airline: 'Example Air', passengers: 1, stops: 0, priceTotalUSD: 913, pricePerPaxUSD: 913,
      departureDate: plan.departureDate, returnDate: plan.returnDate, collectedAt: now.toISOString(), bookingUrl: '',
      evidence: { priceBasis: 'party_total', passengersVerified: true, itineraryScope: 'search_result',
        googleParserVersion: 2, priceVerified: true, queryVerified: true, searchView: 'cheapest' } };
    const evaluation = evaluateQuote(plan, quote);
    assert.equal(evaluation.approvalStatus, 'aprobado');
    const row = { ...toObservedDeal(quote), id: 'world-fixture', estado_aprobacion: evaluation.approvalStatus };
    assert.equal(dailyRadar([row], radar, now.getTime()).best?.id, row.id);
  }
});

test('Exact airports never silently expand, unknown IATA is rejected and geography does not infer routes', () => {
  for (const code of ['AEP', 'EZE', 'LGA', 'EWR', 'LGW', 'HND', 'CGH', 'ITM', 'NBO']) {
    assert.deepEqual(originAirports(code), [code]);
    assert.deepEqual(destinationAirports(code), [code]);
  }
  assert.deepEqual(originAirports('ZZZ'), []);
  assert.deepEqual(destinationAirports('ZZZ', 'search'), []);
  assert.ok(buildSearchSpace({ ...base, origen: 'AEP', destino: 'BER' }, now).length);
  assert.equal(buildSearchSpace({ ...base, origen: 'LHR', destino: 'LHR' }, now).length, 0);
  for (const airports of Object.values(catalog.metroAirports)) {
    for (const code of airports) assert.ok(code in catalog.airports, code);
  }
});

test('Unknown destinations are diagnosable instead of silently claiming no flights exist', () => {
  const state = dailyRadar([], { ...base, destino: 'Un destino inexistente' }, now.getTime());
  assert.match(emptyRadarMessage(state), /reconocer el destino/);
});

test('Screenshot: an October 1 saved quote is not current on October 5, while a fresh quote is visible', () => {
  const radar = { ...base, destino: 'Norteamérica', paises: ['Norteamérica'] };
  const row = { id: 'saved', ida_origen_destino: 'EZE-MIA', vuelta_origen_destino: 'MIA-EZE',
    ida_fecha: '2027-01-29', vuelta_fecha: '2027-03-05', pasajeros: 1, cantidad_escalas: 1,
    aerolinea: 'Avianca', precio_total_usd: 1032, fuente: 'google_flights', estado_aprobacion: 'aprobado',
    created_at: '2026-10-01T21:40:00Z', detalle_cotizacion: { priceBasis: 'party_total', passengersVerified: true,
      itineraryScope: 'search_result', googleParserVersion: 2, priceVerified: true, queryVerified: true, searchView: 'cheapest' } };
  const old = dailyRadar([row], radar, now.getTime());
  assert.equal(old.best, null);
  assert.match(emptyRadarMessage(old), /más de 24 horas/);
  const fresh = { ...row, id: 'fresh', created_at: now.toISOString(), precio_total_usd: 913 };
  assert.equal(dailyRadar([row, fresh], radar, now.getTime()).best?.id, 'fresh');
});
