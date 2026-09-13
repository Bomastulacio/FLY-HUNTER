import 'dotenv/config';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { collectGoogleFlights } from './skills/googleFlights.js';
import { collectDespegar } from './skills/despegar.js';
import { evaluateDealWithGemini } from './agent/geminiEvaluator.js';
import { evaluateQuote, quoteIntegrityReason } from './agent/quotePolicy.js';
import { buildSearchSpace, roundRobin, searchKey, type SearchAlert } from './agent/searchPlanner.js';
import { SearchRuntime, logEvent, type Provider, type ProviderResult } from './agent/searchRuntime.js';
import { saveFlightDeal, getActiveSearchAlerts, getMonitoringSavedDeals, persistMonitoring } from './db/supabase.js';
import { savedChecks, watchTargets, pickMonitoringSearch } from './agent/monitoring.js';
import type { FlightSearchParams, ScrapedFlightOption } from './types/flight.js';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const alerts = await getActiveSearchAlerts() as SearchAlert[];
  if (!alerts.length) {
    if (!dryRun) await writeFile('search-plan.json', JSON.stringify({ version: 1, searches: [] }));
    logEvent('run.skipped', { reason: 'no_active_alerts' }); return;
  }
  const runtime = new SearchRuntime();
  await runtime.load();
  const saved = await getMonitoringSavedDeals();
  const ordered = roundRobin(alerts, runtime.cursor('alerts'), alerts.length);
  const plans = ordered.map(alert => ({ alert, searches: buildSearchSpace(alert) })).filter(p => p.searches.length);
  const attempted: Array<Record<string, unknown>> = [];
  const sources: Provider[] = args.includes('--test-despegar') ? ['despegar'] : args.includes('--test-google') ? ['google_flights'] : ['google_flights', 'despegar'];
  const pairs = new Map<string, { params: FlightSearchParams; google?: ScrapedFlightOption; despegar?: ScrapedFlightOption }>();
  const persisted = new Set<string>();
  const queryResults = new Map<string, ProviderResult>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  // Fill existing caps (Google 4 / Despegar 2), alternating exploration and monitoring.
  // Rotating alerts preserves fairness; duplicate searches are shared within this run.
  for (let pass = 0; pass < 4; pass++) for (const { alert, searches } of plans) for (const provider of sources) {
    const signature = createHash('sha256').update(JSON.stringify(searches)).digest('hex').slice(0, 16);
    const cursorKey = `${alert.id}:${provider}:${signature}`;
    const watches = watchTargets(alert, searches, saved, provider);
    const selection = pickMonitoringSearch(searches, watches, runtime.cursor(`mode:${provider}`) % 2 === 1,
      runtime.cursor(cursorKey), runtime.cursor(`${cursorKey}:watch`), p => visited.has(`${alert.id}:${provider}:${searchKey(p)}`));
    if (!selection) continue;
    const { params, follow: following, steps } = selection;
    const selectedCursor = following ? `${cursorKey}:watch` : cursorKey;
    const key = `${provider}:${searchKey(params)}`;
    const previous = queryResults.get(key);
    if (!previous && !runtime.available(provider)) continue;
    visited.add(`${alert.id}:${provider}:${searchKey(params)}`);
    if (dryRun) { logEvent('search.planned', { provider, mode: following ? 'follow' : 'explore', ...params }); continue; }
    // Persist progress before I/O: a crashed attempt cannot trap every subsequent run on this pair.
    await runtime.advance(selectedCursor, steps);
    await runtime.advance(`mode:${provider}`);
    const result = previous || await runtime.search(provider, params, () => provider === 'google_flights'
      ? collectGoogleFlights(params, { headless: true }) : collectDespegar(params, { headless: true }));
    if (!result) continue;
    queryResults.set(key, result);
    await runtime.recordCoverage(cursorKey, params, result);
    await persistMonitoring(savedChecks(alert, params, provider, result, saved, result.checkedAt || new Date().toISOString()), {
      radar_id: alert.id, provider, checked_at: result.checkedAt || new Date().toISOString(), outcome: result.status,
      checked_combinations: runtime.coverageCount(cursorKey), total_combinations: searches.length,
    });
    reported.add(`${alert.id}:${provider}`);
    attempted.push({ alert_id: alert.id, origin: params.origin, dest: params.destination,
      dep_date: params.departureDate, ret_date: params.returnDate, passengers: params.passengers });
    for (const quote of result.options) {
      const evaluation = evaluateQuote(params, quote);
      logEvent('critic.decision', { provider, decision: evaluation.approvalStatus, reason: evaluation.reason });
      if (quoteIntegrityReason(params, quote)) continue;
      const quoteKey = JSON.stringify([quote.source, quote.route, quote.departureDate, quote.returnDate, quote.passengers, quote.airline, quote.priceTotalUSD, quote.paymentCondition]);
      if (!persisted.has(quoteKey)) {
        await saveFlightDeal(quote, evaluation, evaluation.approvalStatus === 'rechazado');
        persisted.add(quoteKey);
      }
      if (evaluation.approvalStatus !== 'aprobado') continue;
      const key = JSON.stringify([quote.route, quote.departureDate, quote.returnDate, quote.passengers]);
      const entry = pairs.get(key) || { params };
      const field = provider === 'google_flights' ? 'google' : 'despegar';
      if (!entry[field] || quote.priceTotalUSD < entry[field]!.priceTotalUSD) entry[field] = quote;
      pairs.set(key, entry);
    }
  }
  if (!dryRun) {
    for (const { alert, searches } of plans) for (const provider of sources) {
      if (reported.has(`${alert.id}:${provider}`)) continue;
      const signature = createHash('sha256').update(JSON.stringify(searches)).digest('hex').slice(0, 16);
      await persistMonitoring([], { radar_id: alert.id, provider, checked_at: new Date().toISOString(), outcome: 'deferred',
        checked_combinations: runtime.coverageCount(`${alert.id}:${provider}:${signature}`), total_combinations: searches.length });
    }
    await runtime.advance('alerts');
    // A run-scoped artifact lets LangGraph reuse the exact plan rather than inventing different dates.
    await writeFile('search-plan.json', JSON.stringify({ version: 1, searches: attempted }, null, 2));
    for (const entry of pairs.values()) if (entry.google && entry.despegar) {
      await evaluateDealWithGemini(entry.params, entry.google, entry.despegar);
    }
  }
  logEvent('run.completed', { quotes_saved: persisted.size, planned_searches: attempted.length, dry_run: dryRun });
}
main().catch(error => {
  logEvent('run.failed', { reason: error instanceof Error && error.message.includes('schema_monitoring.sql')
    ? 'missing_monitoring_schema: apply schema_monitoring.sql' : 'unhandled_error' }); process.exitCode = 1;
});
