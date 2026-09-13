import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHunt, huntIO } from '../src/index.js';
import { SearchRuntime } from '../src/agent/searchRuntime.js';
import { parseSearchFocus, matchesFocus, buildSearchSpace } from '../src/agent/searchPlanner.js';
import { parseCard } from '../src/skills/quoteParser.js';
import { toObservedDeal } from '../src/agent/monitoring.js';
import { feedCandidate, latestQuotes } from '../../frontend/src/utils/latestQuotes.js';
import { matchesRadar, renderCompactFlight } from '../../frontend/src/utils/compactFlights.js';

const radar = { id: 'radar', user_id: 'owner', origen: 'EZE', destino: 'Madrid', pasajeros: 2,
  presupuesto_min: 1700, presupuesto_max: 2400, escalas_max: 1,
  fecha_ida_min: '2027-04-18', fecha_ida_max: '2027-04-18', fecha_vuelta_min: '2027-05-01', fecha_vuelta_max: '2027-05-01' };
const focus = 'EZE,MAD,2027-04-18,2027-05-01,2';

test('Screenshot scenario: Despegar alone reaches persistence and the feed when Google is blocked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fh-hunt-eval-'));
  try {
    const persisted: any[] = [], scans: any[] = [], plans: any[] = [], summaries: string[] = [];
    let googleCalls = 0, despegarCalls = 0;
    const io: typeof huntIO = { ...huntIO,
      getActiveSearchAlerts: async () => [radar], getMonitoringSavedDeals: async () => [],
      collectGoogleFlights: async () => { googleCalls++; return { status: 'blocked', options: [] }; },
      collectDespegar: async p => {
        despegarCalls++;
        assert.equal(matchesFocus(p, parseSearchFocus(focus)!), true);
        const options = [
          { airline: 'Aeroméxico', stops: '1 escala', price: '1.884' },
          { airline: 'Aerolíneas Argentinas', stops: 'Directo', price: '2.253' },
        ].map(row => parseCard('despegar', { text: `Final 2 personas US$ ${row.price} Con Débito
          IDA dom. 18 abr. 2027 EZE MAD ${row.stops} VUELTA sáb. 1 may. 2027 MAD EZE ${row.stops}`,
          airlineNames: [row.airline], bookingUrl: 'https://www.despegar.com.ar/shop/flights/results/roundtrip/EZE/MAD/2027-04-18/2027-05-01/2/0/0',
          collectedAt: new Date().toISOString() }, p)!);
        assert.ok(options.every(Boolean));
        return { status: 'ok', options };
      },
      saveFlightDeal: async (quote, evaluation) => {
        persisted.push({ ...toObservedDeal(quote), id: `quote-${persisted.length}`, estado_aprobacion: evaluation?.approvalStatus });
        return null;
      },
      persistMonitoring: async (_, status) => { scans.push(status); },
      evaluateDealWithGemini: async () => { throw new Error('Gemini must not be required to publish a single-source quote'); },
      writePlan: async plan => { plans.push(plan); }, writeSummary: async summary => { summaries.push(summary); },
    };
    await runHunt([], io, new SearchRuntime(join(directory, 'state.json'), { google_flights: 4, despegar: 2 }, 0), focus);
    assert.equal(googleCalls, 1); assert.equal(despegarCalls, 1);
    const feed = latestQuotes(persisted).filter(feedCandidate).filter(deal => matchesRadar(deal, radar));
    assert.deepEqual(feed.map(d => d.precio_total_usd), [1884, 2253]);
    assert.ok(feed.every(d => renderCompactFlight(d, radar).includes('Ver en Despegar')));
    assert.deepEqual(scans.map(s => s.outcome), ['blocked', 'ok']);
    assert.equal(plans[0].provider_results.length, 2);
    assert.ok(summaries[0].includes('despegar') && summaries[0].includes('blocked'));
    // The same persisted quota/cooldown ledger applies to a manual focus; it cannot force a blocked source.
    await runHunt([], io, new SearchRuntime(join(directory, 'state.json'), { google_flights: 4, despegar: 2 }, 0), focus);
    assert.equal(googleCalls, 1); assert.equal(despegarCalls, 1); // Despegar reuses its exact cache.
    assert.equal(scans.at(-2).outcome, 'ok'); assert.equal(scans.at(-1).outcome, 'deferred');
    await assert.rejects(runHunt([], io, new SearchRuntime(join(directory, 'state.json')), 'EZE,MAD,2027-04-16,2027-05-01,2'), /radar activo/);
    assert.equal(googleCalls, 1); assert.equal(despegarCalls, 1);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'fh-hunt-eval-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Focused searches are explicit, valid and match the exact party, dates and route', () => {
  assert.equal(parseSearchFocus(''), undefined);
  for (const value of ['EZE,MAD,2027-04-18,2027-05-01', 'EZE,MAD,2027-02-30,2027-05-01,2',
    'EZE,MAD,2027-04-18,2027-05-01,2.5', 'EZE,MAD,2027-05-01,2027-04-18,2']) assert.throws(() => parseSearchFocus(value));
  const target = parseSearchFocus(focus)!;
  const space = buildSearchSpace({ ...radar, fecha_ida_min: '2027-04-17', fecha_ida_max: '2027-04-19', fecha_vuelta_max: '2027-05-03' });
  assert.equal(space.filter(p => matchesFocus(p, target)).length, 1);
  assert.equal(space.filter(p => matchesFocus(p, { ...target, passengers: 1 })).length, 0);
});
