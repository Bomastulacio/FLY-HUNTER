import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSearchSpace, roundRobin, searchKey } from '../src/agent/searchPlanner.js';
import { evaluateQuote, selectDiverseQuotes } from '../src/agent/quotePolicy.js';
import { parseCard, parseUsd, challenged, verifiedPassengerCount } from '../src/skills/quoteParser.js';
import { SearchRuntime } from '../src/agent/searchRuntime.js';
import { evaluateDealWithGemini } from '../src/agent/geminiEvaluator.js';
import { matchesRadar, renderCompactFlight } from '../../frontend/src/utils/compactFlights.js';
import type { ScrapedFlightOption } from '../src/types/flight.js';
import { chromium } from 'playwright';
import { collectDespegar } from '../src/skills/despegar.js';

const radar = { id: 'test', origen: 'EZE', destino: 'MAD', pasajeros: 2, presupuesto_min: 1700, presupuesto_max: 2400,
  fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19', fecha_vuelta_min: '2027-05-01', fecha_vuelta_max: '2027-05-03', escalas_max: 1 };
const params = { origin: 'EZE', destination: 'MAD', departureDate: '2027-04-18', returnDate: '2027-05-01', passengers: 2, maxStops: 1, budgetMaxUSD: 2400 };
const observed = '2026-09-12T12:00:00Z';
const snapshot = { text: 'Final 2 personas US$ 1.884 Con Débito IDA dom. 18 abr. 2027 EZE MAD Aeroméxico 1 escala VUELTA sáb. 1 may. 2027 MAD EZE Aeroméxico 1 escala',
  airlineNames: ['Aeroméxico'], bookingUrl: 'https://www.despegar.com.ar/shop/flights/results/', collectedAt: observed };
const quote = () => parseCard('despegar', snapshot, params)!;

test('Screenshot regression: party total, exact dates, one stop EACH way and debit condition', () => {
  const q = quote();
  assert.ok(q);
  assert.equal(q.priceTotalUSD, 1884);
  assert.equal(q.pricePerPaxUSD, 942);
  assert.equal(q.airline, 'Aeroméxico');
  assert.equal(q.paymentCondition, 'Precio con débito');
  assert.deepEqual(q.evidence?.stopsPerDirection, [1, 1]);
  assert.equal(evaluateQuote(params, q).approvalStatus, 'aprobado');
});

test('No invented carrier/stops/currency or ambiguous crossed-out price', () => {
  for (const card of [
    { ...snapshot, airlineNames: [] },
    { ...snapshot, text: snapshot.text.replaceAll('1 escala', '') },
    { ...snapshot, text: snapshot.text.replace('US$ 1.884', '$ 2.543.400') },
    { ...snapshot, text: snapshot.text + ' US$ 1.963' },
    { ...snapshot, text: snapshot.text.replace('1 may.', '3 may.') },
    { ...snapshot, text: snapshot.text.replace('Final 2 personas', 'Final 1 persona') },
    { ...snapshot, text: snapshot.text.replace('1 escala VUELTA', '2 escalas VUELTA') },
  ]) assert.equal(parseCard('despegar', card, params), undefined);
});

test('USD locale and decimal handling without a guessed ARS rate', () => {
  for (const s of ['US$ 1.884,50', '1,884.50 USD', 'US$ 1884.50']) assert.equal(parseUsd(s), 1884.50);
  assert.equal(parseUsd('US$ 1.884'), 1884);
  assert.equal(parseUsd('ARS 1.884'), undefined);
  assert.equal(parseUsd('US$ 1.2.3'), undefined);
  assert.equal(verifiedPassengerCount('El precio incluye los impuestos y las comisiones correspondientes a 2 adultos.'), 2);
});

test('Round-robin eventually covers the missing 18 April / 1 May pair and all selected destinations', () => {
  const space = buildSearchSpace({ ...radar, destino: 'Europa', paises: ['España', 'Francia'], origen: 'EZE,AEP' }, new Date(observed));
  const visited = Array.from({ length: space.length }, (_, cursor) => roundRobin(space, cursor, 1)[0]);
  assert.ok(visited.some(p => p.destination === 'MAD' && p.departureDate === '2027-04-18' && p.returnDate === '2027-05-01'));
  assert.deepEqual(new Set(visited.map(p => p.destination)), new Set(['MAD', 'BCN', 'CDG', 'ORY']));
  assert.equal(new Set(visited.map(searchKey)).size, space.length);
  assert.deepEqual(roundRobin(space, 3, 2), roundRobin(space, 3, 2));
  assert.ok(buildSearchSpace({ ...radar, fecha_vuelta_min: '2027-06-01', fecha_vuelta_max: '2027-06-01' }, new Date(observed)).length);
  assert.equal(buildSearchSpace({ ...radar, destino: 'unknown' }, new Date(observed)).length, 0);
});

test('AR is retained beyond the first five cards, without preferring it over a cheaper winner', () => {
  const qs = Array.from({ length: 9 }, (_, i) => ({ ...quote(), airline: `Carrier ${i}`, priceTotalUSD: 1700 + i * 10 }));
  qs[8].airline = 'Aerolíneas Argentinas';
  const selected = selectDiverseQuotes(qs, 5);
  assert.equal(selected.length, 5);
  assert.equal(selected[0].priceTotalUSD, 1700);
  assert.ok(selected.some(q => q.airline === 'Aerolíneas Argentinas'));
});

test('Approval is per quote; price, pax and hard filters cannot leak through another winner', async () => {
  const good = quote();
  const bad = { ...good, source: 'google_flights' as const, airline: 'LEVEL', priceTotalUSD: 800, pricePerPaxUSD: 400 };
  const p = { ...params, excludedAirlines: ['LEVEL'] };
  assert.equal(evaluateQuote(p, bad).approvalStatus, 'rechazado');
  assert.equal(evaluateQuote(p, { ...good, passengers: 1 }).approvalStatus, 'rechazado');
  assert.equal(evaluateQuote(p, { ...good, departureDate: '2027-04-19' }).approvalStatus, 'rechazado');
  assert.equal(evaluateQuote(p, { ...good, evidence: undefined }).approvalStatus, 'rechazado');
  assert.equal((await evaluateDealWithGemini(p, bad, good)).bestOption, 'despegar');
});

test('Provider calls share a run limit, exact cache keys and durable cooldowns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fh-evals-'));
  try {
    const path = join(directory, 'state.json');
    const runtime = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await runtime.load();
    let calls = 0;
    const run = async () => { calls++; return { status: 'ok' as const, options: [quote()] }; };
    await runtime.search('google_flights', params, run);
    await runtime.search('google_flights', params, run);
    assert.equal(calls, 1);
    assert.equal(await runtime.search('google_flights', { ...params, passengers: 1 }, run), undefined);
    await runtime.search('despegar', params, async () => ({ status: 'blocked', options: [] }));
    await runtime.advance('coverage');
    const resumed = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await resumed.load();
    assert.equal(resumed.cursor('coverage'), 1);
    assert.equal(resumed.available('despegar'), false);
    await resumed.search('google_flights', params, run);
    assert.equal(calls, 1);
    assert.ok(challenged('GPS perdió señal'));
    assert.ok(challenged('', 429));
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'fh-evals-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Feed only compares the current radar and exposes the fare payment condition safely', () => {
  const deal = { id: 'fixture', ida_origen_destino: 'EZE-MAD', vuelta_origen_destino: 'MAD-EZE', ida_fecha: '2027-04-18', vuelta_fecha: '2027-05-01',
    pasajeros: 2, precio_total_usd: 1884, cantidad_escalas: 1, aerolinea: 'Aeroméxico', fuente: 'despegar', link_reserva: snapshot.bookingUrl,
    detalle_cotizacion: { observedAt: observed, paymentCondition: 'Precio con débito <script>' } };
  assert.ok(matchesRadar(deal, radar));
  assert.equal(matchesRadar({ ...deal, pasajeros: 1 }, radar), false);
  assert.equal(matchesRadar({ ...deal, ida_fecha: '2027-04-16' }, radar), false);
  assert.equal(matchesRadar({ ...deal, cantidad_escalas: null }, radar), false);
  const html = renderCompactFlight(deal, radar);
  assert.ok(html.includes('2 adultos'));
  assert.ok(html.includes('Precio con débito &lt;script&gt;'));
  assert.equal(html.includes('Precio con débito <script>'), false);
});

test('Despegar browser extraction ties split price elements to the same return ticket', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const fixture = `<article class="cluster-container">
    <div>Final <b>2 personas</b></div><s>US$ 1.963</s><div><span>US$</span> <strong>1.884</strong></div><div>Con Débito</div>
    <div>IDA <span>dom. 18 abr. 2027</span> <span>EZE</span> <span>MAD</span> <span class="airline-name">Aeroméxico</span> <span>1 escala</span></div>
    <div>VUELTA <span>sáb. 1 may. 2027</span> <span>MAD</span> <span>EZE</span> <span class="airline-name">Aeroméxico</span> <span>1 escala</span></div>
    </article>`;
  let requests = 0;
  await context.route('**/*', route => {
    requests++;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
  });
  const newContext = mock.method(browser, 'newContext', async () => context);
  const launch = mock.method(chromium, 'launch', async () => browser);
  try {
    const result = await collectDespegar(params);
    assert.equal(result.status, 'ok');
    assert.equal(result.options.length, 1);
    assert.equal(result.options[0].priceTotalUSD, 1884);
    assert.equal(result.options[0].paymentCondition, 'Precio con débito');
    assert.equal(requests, 2);
  } finally {
    launch.mock.restore(); newContext.mock.restore();
    await browser.close();
  }
});
