import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { buildSearchSpace, searchKey } from '../src/agent/searchPlanner.js';
import { watchTargets, savedChecks, pickMonitoringSearch, type SavedDeal } from '../src/agent/monitoring.js';
import { SearchRuntime } from '../src/agent/searchRuntime.js';
import { parseGoogleResult } from '../src/skills/googleQuote.js';
import { evaluateQuote } from '../src/agent/quotePolicy.js';
import { monitoredSavedDeal, meaningfulDrop } from '../../frontend/src/utils/monitoringView.js';
import { nextSearchAt, scheduleLabel, SEARCH_HOURS_UTC } from '../../frontend/src/utils/searchSchedule.js';
import { latestQuotes, feedCandidate } from '../../frontend/src/utils/latestQuotes.js';
import { matchesRadar, renderCompactFlight } from '../../frontend/src/utils/compactFlights.js';
import { chromium } from 'playwright';

const now = new Date('2026-09-12T12:00:00Z');
const alert = { id: 'radar', user_id: 'owner', origen: 'EZE', destino: 'MAD', pasajeros: 2, escalas_max: 1,
  presupuesto_max: 2400, fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19', fecha_vuelta_min: '2027-05-01', fecha_vuelta_max: '2027-05-03' };
const space = buildSearchSpace(alert, now);
const saved: SavedDeal = { id: 'saved', user_id: 'owner', origen: 'EZE', destino: 'MAD', ida_fecha: '2027-04-18',
  vuelta_fecha: '2027-05-01', pasajeros: 2, aerolinea: 'Aeromexico', cantidad_escalas: 1, fuente: 'google_flights',
  precio_total_usd: 2200, guardado_el: now.toISOString() };
const params = space.find(p => p.departureDate === saved.ida_fecha && p.returnDate === saved.vuelta_fecha)!;
const quote = (price = 1925) => parseGoogleResult({ label: `A partir de ${price} dólares estadounidenses (precio total de ida y vuelta). Vuelo con 1 escala de Aeromexico. Sale de Ezeiza. Seleccionar vuelo`,
  visiblePrices: [`${price} USD`], passengers: 2, bookingUrl: 'https://www.google.com/travel/flights', collectedAt: now.toISOString() }, params)!;

test('Saved tracking respects ownership, changed radar dates, passengers and exclusions', () => {
  assert.deepEqual(watchTargets(alert, space, [saved], 'google_flights'), [params]);
  assert.deepEqual(watchTargets(alert, space, [{ ...saved, user_id: 'other' }], 'google_flights'), []);
  assert.deepEqual(watchTargets(alert, space, [{ ...saved, pasajeros: 1 }], 'google_flights'), []);
  assert.deepEqual(watchTargets({ ...alert, aerolineas_excluidas: ['Aeroméxico'] }, space, [saved], 'google_flights'), []);
  assert.deepEqual(watchTargets(alert, buildSearchSpace({ ...alert, fecha_ida_min: '2027-04-19' }, now), [saved], 'google_flights'), []);
  assert.deepEqual(watchTargets(alert, space, [saved], 'despegar'), []);
});

test('Monitoring alternates with exploration, falls back when a watch was already checked, and progresses across runs', () => {
  const watches = [params];
  const visited = new Set<string>();
  let explore = 0, follow = 0;
  const selected: string[] = [];
  for (let i = 0; i < 4; i++) {
    const result = pickMonitoringSearch(space, watches, i % 2 === 1, explore, follow, p => visited.has(searchKey(p)))!;
    assert.ok(result);
    visited.add(searchKey(result.params)); selected.push(searchKey(result.params));
    if (result.follow) follow += result.steps; else explore += result.steps;
  }
  assert.equal(selected.length, new Set(selected).size);
  assert.ok(selected.includes(searchKey(params)));
  assert.ok(explore >= 3);
  assert.equal(pickMonitoringSearch(space, [], false, explore, follow, () => false)?.params, space[explore % space.length]);
});

test('Price increases remain observable without becoming approved deals; observations are idempotent', () => {
  const q = quote(2800);
  assert.equal(evaluateQuote(params, q).approvalStatus, 'rechazado');
  const result = { status: 'ok' as const, options: [q] };
  const first = savedChecks(alert, params, 'google_flights', result, [saved], now.toISOString());
  const repeat = savedChecks(alert, params, 'google_flights', result, [saved], '2026-09-12T20:00:00Z');
  assert.equal(first[0].event_id, repeat[0].event_id);
  assert.equal(first[0].quote?.precio_total_usd, 2800);
  assert.equal(saved.precio_total_usd, 2200);
  assert.equal(savedChecks(alert, params, 'google_flights', { status: 'blocked', options: [] }, [saved], now.toISOString())[0].outcome, 'blocked');
  assert.equal(savedChecks(alert, params, 'google_flights', { status: 'ok', options: [{ ...q, airline: 'LEVEL' }] }, [saved], now.toISOString())[0].outcome, 'not_observed');
  assert.equal(savedChecks(alert, params, 'google_flights', { status: 'ok', options: [{ ...q, stops: 2 }] }, [saved], now.toISOString())[0].quote, null);
});

test('Saved cards keep the original price and last valid observation after a failed recheck', () => {
  const check = savedChecks(alert, params, 'google_flights', { status: 'ok', options: [quote()] }, [saved], now.toISOString())[0];
  const display = monitoredSavedDeal(saved, check, now.getTime());
  assert.equal(display.id, saved.id);
  assert.equal(display.precio_total_usd, 1925);
  assert.equal(display.saved_price_usd, 2200);
  assert.ok(meaningfulDrop(saved, check, now.getTime()));
  assert.equal(meaningfulDrop(saved, check, now.getTime() + 86400001), false);
  const failure = { ...check, outcome: 'error', quote: null, last_quote: check.quote, last_observed_at: check.checked_at };
  assert.equal(monitoredSavedDeal(saved, failure, now.getTime()).precio_total_usd, 1925);
  assert.equal(meaningfulDrop(saved, failure, now.getTime()), false);
  assert.equal(monitoredSavedDeal(saved, { ...check, quote: { ...check.quote, pasajeros: 1 } }, now.getTime()).precio_total_usd, 2200);
  assert.equal(monitoredSavedDeal(saved, { ...check, quote: { ...check.quote, fuente: 'despegar' } }, now.getTime()).precio_total_usd, 2200);
  assert.equal(monitoredSavedDeal(saved, { ...check, quote: { ...check.quote, cantidad_escalas: 0 } }, now.getTime()).precio_total_usd, 2200);
});

test('Tracked cards keep disclosure, original price and touch targets without mobile/desktop overflow', async () => {
  const css = (await Promise.all(['global', 'compact'].map(name => readFile(new URL(`../../frontend/src/styles/${name}.css`, import.meta.url), 'utf8')))).join('\n').replace(/@import[^;]+;/g, '');
  const check = savedChecks(alert, params, 'google_flights', { status: 'ok', options: [quote()] }, [saved], now.toISOString())[0];
  const projected = monitoredSavedDeal(saved, check, now.getTime());
  const html = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="compact-app"><main><div class="dashboard-feed">${[0, 1, 2].map(i => renderCompactFlight({ ...projected, id: `saved-${i}` }, alert, false, 'España', true)).join('')}</div></main></body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 700 });
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      await page.setContent(html);
      const first = page.locator('.flight-item').first();
      assert.equal(await first.locator('.flight-content').isVisible(), false);
      await first.locator('.flight-summary').click();
      assert.equal(await first.locator('.flight-content').isVisible(), true);
      assert.ok((await first.innerText()).includes('Guardaste a US$2.200'));
      assert.ok((await first.innerText()).includes('US$1.925'));
      const touch = await first.locator('.flight-save').boundingBox();
      assert.ok(touch && touch.width >= 44 && touch.height >= 44);
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        columns: getComputedStyle(document.querySelector('.dashboard-feed')!).gridTemplateColumns.split(' ').length }));
      assert.ok(geometry.scroll <= geometry.width, `overflow at ${width}px`);
      assert.equal(geometry.columns, width < 701 ? 1 : width <= 1020 ? 2 : 3);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('Coverage counts successful distinct combinations only and cache hits do not rejuvenate them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fh-evals-'));
  try {
    const runtime = new SearchRuntime(join(directory, 'state.json'), { google_flights: 1, despegar: 1 }, 0);
    await runtime.load();
    const stamp = new Date().toISOString();
    await runtime.recordCoverage('radar', params, { status: 'ok', options: [], checkedAt: stamp });
    await runtime.recordCoverage('radar', params, { status: 'ok', options: [], checkedAt: stamp });
    await runtime.recordCoverage('radar', space[0], { status: 'blocked', options: [], checkedAt: stamp });
    assert.equal(runtime.coverageCount('radar'), 1);
    assert.equal(runtime.coverageCount('radar', Date.parse(stamp) + 86400001), 0);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'fh-evals-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Countdown follows the two actual UTC cron hours across days and time zones', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/agent-hunt.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes(`cron: '0 ${SEARCH_HOURS_UTC.join(',')} * * *'`));
  assert.equal(nextSearchAt(new Date('2026-09-12T08:59:59Z')).toISOString(), '2026-09-12T09:00:00.000Z');
  assert.equal(nextSearchAt(new Date('2026-09-12T09:00:00Z')).toISOString(), '2026-09-12T21:00:00.000Z');
  assert.equal(nextSearchAt(new Date('2026-09-12T22:00:00Z')).toISOString(), '2026-09-13T09:00:00.000Z');
  assert.equal(scheduleLabel('America/Argentina/Buenos_Aires'), '06:00 y 18:00');
});

test('Latest observed price supersedes old bargains before each radar applies its own budget', () => {
  const old = { ida_origen_destino: 'EZE-MAD', vuelta_origen_destino: 'MAD-EZE', ida_fecha: saved.ida_fecha,
    vuelta_fecha: saved.vuelta_fecha, pasajeros: 2, cantidad_escalas: 1, aerolinea: 'Aeroméxico', fuente: 'despegar',
    precio_total_usd: 1884, estado_aprobacion: 'aprobado', created_at: '2026-09-12T09:00:00Z' };
  const newer = { ...old, aerolinea: 'Aeromexico', precio_total_usd: 2800, estado_aprobacion: 'no_aplica',
    detalle_cotizacion: { budgetScope: 'radar' }, created_at: '2026-09-12T12:00:00Z' };
  const candidates = latestQuotes([old, newer]).filter(feedCandidate);
  assert.deepEqual(candidates, [newer]);
  assert.deepEqual(candidates.filter(d => matchesRadar(d, alert)), []);
  assert.deepEqual(candidates.filter(d => matchesRadar(d, { ...alert, presupuesto_max: 3000 })), [newer]);
  assert.equal(feedCandidate({ ...newer, estado_aprobacion: 'rechazado', es_oportunidad_oro: true }), false);
  assert.equal(feedCandidate({ ...newer, estado_aprobacion: 'pendiente' }), false);
  assert.equal(feedCandidate({ ...newer, detalle_cotizacion: {} }), false);
  assert.equal(latestQuotes([old, newer, { ...newer, pasajeros: 1 }, { ...newer, fuente: 'google_flights' }]).length, 3);
  assert.equal(latestQuotes([newer, { ...newer, precio_total_usd: 2700 }])[0].precio_total_usd, 2700);
});

test('Monitoring SQL is repeatable and isolates users for reads, preferences and immutable observations', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
      grant usage on schema auth, public to anon, authenticated, service_role;
      grant execute on all functions in schema auth to anon, authenticated, service_role;`);
    const base = (await readFile(new URL('../../schema.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '');
    await db.exec(base);
    await db.exec('grant select, insert, update, delete on public.saved_deals, public.search_alerts to authenticated;');
    const migration = await readFile(new URL('../../schema_monitoring.sql', import.meta.url), 'utf8');
    await db.exec(migration); await db.exec(migration);
    const owner = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const radar = '33333333-3333-4333-8333-333333333333';
    const foreignRadar = '44444444-4444-4444-8444-444444444444';
    const bookmark = '55555555-5555-4555-8555-555555555555';
    await db.query('insert into auth.users values ($1), ($2)', [owner, other]);
    await db.query("insert into public.search_alerts(id,user_id,origen,destino,email) values ($1,$2,'EZE','MAD','fixture@example.invalid'),($3,$4,'EZE','MIA','fixture@example.invalid')", [radar, owner, foreignRadar, other]);
    await db.query("insert into public.saved_deals(id,user_id,origen,destino,ida_fecha,vuelta_fecha,precio_total_usd) values ($1,$2,'EZE','MAD','2027-04-18','2027-05-01',2200)", [bookmark, owner]);
    await db.query("insert into public.saved_deal_checks values ($1,$2,'google_flights',now(),'observed',$3)", ['a'.repeat(64), bookmark, { precio_total_usd: 1925 }]);
    await db.query("insert into public.radar_scan_status values ($1,'google_flights',now(),'ok',1,54)", [radar]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    assert.equal((await db.query('select * from public.saved_deal_latest')).rows.length, 1);
    assert.equal((await db.query('select * from public.radar_scan_status')).rows.length, 1);
    await db.query('insert into public.radar_preferences values ($1,$2)', [owner, radar]);
    await assert.rejects(db.query('update public.radar_preferences set primary_radar_id=$1', [foreignRadar]));
    await assert.rejects(db.query('insert into public.radar_preferences values ($1,$2)', [other, foreignRadar]));
    await assert.rejects(db.exec('delete from public.saved_deal_checks'));
    await assert.rejects(db.exec("update public.saved_deal_checks set quote='{}'::jsonb"));
    await assert.rejects(db.query("insert into public.saved_deal_checks values ($1,$2,'google_flights',now(),'observed','{}')", ['b'.repeat(64), bookmark]));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    for (const table of ['radar_preferences', 'saved_deal_checks', 'saved_deal_latest', 'radar_scan_status']) {
      assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0);
    }
    await db.exec('reset role; set role anon');
    for (const table of ['radar_preferences', 'saved_deal_checks', 'saved_deal_latest', 'radar_scan_status']) {
      await assert.rejects(db.query(`select * from public.${table}`));
    }
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select * from public.saved_deal_checks')).rows.length, 1);
  } finally { await db.close(); }
});
