import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { buildSearchSpace, searchKey, searchSpaceSignature } from '../src/agent/searchPlanner.js';
import { SearchRuntime } from '../src/agent/searchRuntime.js';

const radar = { id: 'coverage-fixture', origen: 'EZE,AEP', destino: 'Europa',
  paises: ['España', 'Reino Unido', 'Francia', 'Alemania'], pasajeros: 2, escalas_max: 1,
  presupuesto_min: 1700, presupuesto_max: 2400,
  fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19',
  fecha_vuelta_min: '2027-04-26', fecha_vuelta_max: '2027-05-03' };
const today = new Date('2026-09-14T12:00:00Z');

test('Balanced exploration covers the whole Cartesian window once and spreads initial dates/countries', () => {
  const space = buildSearchSpace(radar, today);
  assert.equal(space.length, 2 * 9 * 3 * 8);
  assert.equal(new Set(space.map(searchKey)).size, space.length);
  assert.deepEqual(space, buildSearchSpace(radar, today));

  const routes = new Map<string, typeof space>();
  for (const search of space) {
    const key = `${search.origin}-${search.destination}`;
    routes.set(key, [...(routes.get(key) || []), search]);
    assert.equal(search.passengers, 2);
    assert.equal(search.maxStops, 1);
    assert.ok(search.returnDate > search.departureDate);
  }
  assert.equal(routes.size, 18);
  for (const route of routes.values()) {
    assert.equal(route.length, 24);
    assert.equal(new Set(route.map(p => `${p.departureDate}/${p.returnDate}`)).size, 24);
    assert.deepEqual([...new Set(route.map(p => p.departureDate))].sort(), ['2027-04-17', '2027-04-18', '2027-04-19']);
    assert.equal(new Set(route.map(p => p.returnDate)).size, 8);
  }

  const firstDayGoogle = space.slice(0, 8);
  assert.deepEqual([...new Set(firstDayGoogle.map(p => p.destination))], ['MAD', 'LHR', 'CDG', 'FRA']);
  assert.equal(new Set(firstDayGoogle.map(p => p.origin)).size, 2);
  assert.equal(new Set(firstDayGoogle.map(p => p.departureDate)).size, 3);
  assert.ok(new Set(firstDayGoogle.map(p => p.returnDate)).size >= 5);
});

test('Balanced traversal still excludes past departures and invalid or non-roundtrip date pairs', () => {
  const space = buildSearchSpace({ ...radar, origen: 'EZE', destino: 'MAD', paises: [],
    fecha_ida_min: '2026-09-13', fecha_ida_max: '2026-09-16',
    fecha_vuelta_min: '2026-09-14', fecha_vuelta_max: '2026-09-17' }, today);
  assert.equal(space.length, 6);
  assert.ok(space.every(p => p.departureDate >= '2026-09-14' && p.returnDate > p.departureDate));
  assert.equal(buildSearchSpace({ ...radar, fecha_ida_min: '2027-02-30' }, today).length, 0);
});

test('Budget-only edits preserve the cursor signature; supplier parameters and traversal order do not', () => {
  const original = buildSearchSpace({ ...radar, aerolineas_excluidas: ['LEVEL', 'Iberia'] }, today);
  const budgetChange = buildSearchSpace({ ...radar, presupuesto_min: 1600, presupuesto_max: 2800,
    aerolineas_excluidas: ['Iberia', 'LEVEL'] }, today);
  assert.equal(searchSpaceSignature(original), searchSpaceSignature(budgetChange));
  assert.notEqual(searchSpaceSignature(original), searchSpaceSignature([...original].reverse()));
  assert.notEqual(searchSpaceSignature(original), searchSpaceSignature(buildSearchSpace({ ...radar, pasajeros: 1 }, today)));
  assert.notEqual(searchSpaceSignature(original), searchSpaceSignature(buildSearchSpace({ ...radar, escalas_max: 0 }, today)));
  assert.notEqual(searchSpaceSignature(original), searchSpaceSignature(buildSearchSpace({ ...radar, aerolineas_excluidas: ['LEVEL'] }, today)));
});

test('An active provider pause keeps its actual outcome and consultation timestamp across skipped runs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fh-coverage-eval-'));
  const path = join(directory, 'state.json');
  const params = buildSearchSpace(radar, today)[0];
  try {
    for (const provider of ['google_flights', 'despegar'] as const) {
      const runtime = new SearchRuntime(path, { google_flights: 4, despegar: 2 }, 0);
      await runtime.load();
      await runtime.advance('existing-exploration', 3);
      const outcome = provider === 'google_flights' ? 'blocked' : 'error';
      const result = await runtime.search(provider, params, async () => ({ status: outcome, options: [] }));
      const pause = { outcome, checked_at: result!.checkedAt };
      assert.deepEqual(runtime.pauseStatus(provider), pause);
      assert.equal(runtime.deferralReason(provider), outcome === 'blocked' ? 'provider_blocked' : 'provider_error');
      const resumed = new SearchRuntime(path, { google_flights: 4, despegar: 2 }, 0);
      await resumed.load();
      assert.deepEqual(resumed.pauseStatus(provider), pause);
      assert.equal(resumed.available(provider), false);
      assert.equal(await resumed.search(provider, params, async () => { throw new Error('Must not contact paused provider'); }), undefined);
      assert.deepEqual(resumed.pauseStatus(provider), pause);
      const state = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(state.daily[`${result!.checkedAt!.slice(0, 10)}:${provider}`], 1);
      assert.ok(resumed.cursor('existing-exploration') >= 3);
      const clock = mock.method(Date, 'now', () => Date.parse(result!.checkedAt!) + 86400001);
      try { assert.equal(resumed.pauseStatus(provider), undefined); } finally { clock.mock.restore(); }
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'fh-coverage-eval-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Deferrals distinguish per-run budget, daily budget, and legacy cooldown without making supplier calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fh-coverage-eval-'));
  const path = join(directory, 'state.json');
  const space = buildSearchSpace(radar, today);
  try {
    const first = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await first.load();
    assert.equal(first.deferralReason('google_flights'), undefined);
    await first.search('google_flights', space[0], async () => ({ status: 'empty', options: [] }));
    assert.equal(first.deferralReason('google_flights'), 'run_budget_exhausted');
    const second = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await second.load();
    await second.search('google_flights', space[1], async () => ({ status: 'empty', options: [] }));
    const third = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await third.load();
    assert.equal(third.deferralReason('google_flights'), 'daily_budget_exhausted');
    const state = JSON.parse(await readFile(path, 'utf8'));
    state.cooldown.despegar = Date.now() + 60000;
    await writeFile(path, JSON.stringify(state));
    const legacy = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await legacy.load();
    assert.equal(legacy.deferralReason('despegar'), 'provider_cooldown');
    assert.equal(legacy.pauseStatus('despegar'), undefined);
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'fh-coverage-eval-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Coverage at a paused source timestamp remains truthful while other searches prune history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fh-coverage-eval-'));
  const path = join(directory, 'state.json');
  const space = buildSearchSpace(radar, today);
  const attemptAt = Date.now();
  try {
    const runtime = new SearchRuntime(path, { google_flights: 1, despegar: 1 }, 0);
    await runtime.load();
    await runtime.recordCoverage('radar', space[0], { status: 'ok', options: [], checkedAt: new Date(attemptAt - 23 * 3600000).toISOString() });
    const clock = mock.method(Date, 'now', () => attemptAt + 23 * 3600000);
    try {
      await runtime.recordCoverage('other', space[1], { status: 'empty', options: [], checkedAt: new Date(Date.now()).toISOString() });
      assert.equal(runtime.coverageCount('radar', attemptAt), 1);
      assert.equal(runtime.coverageCount('radar'), 0);
      assert.equal(runtime.coverageCount('other', attemptAt), 0);
    } finally { clock.mock.restore(); }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'fh-coverage-eval-'));
    await rm(directory, { recursive: true, force: true });
  }
});
