import 'dotenv/config';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { collectGoogleFlights } from './skills/googleFlights.js';
import { collectDespegar } from './skills/despegar.js';
import { evaluateDealWithGemini } from './agent/geminiEvaluator.js';
import { evaluateQuote } from './agent/quotePolicy.js';
import { buildSearchSpace, roundRobin, type SearchAlert } from './agent/searchPlanner.js';
import { SearchRuntime, logEvent, type Provider } from './agent/searchRuntime.js';
import { saveFlightDeal, getActiveSearchAlerts } from './db/supabase.js';
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
  const ordered = roundRobin(alerts, runtime.cursor('alerts'), alerts.length);
  const plans = ordered.map(alert => ({ alert, searches: buildSearchSpace(alert) })).filter(p => p.searches.length);
  const attempted: Array<Record<string, unknown>> = [];
  const sources: Provider[] = args.includes('--test-despegar') ? ['despegar'] : args.includes('--test-google') ? ['google_flights'] : ['google_flights', 'despegar'];
  const pairs = new Map<string, { params: FlightSearchParams; google?: ScrapedFlightOption; despegar?: ScrapedFlightOption }>();
  const persisted = new Set<string>();
  // Two passes, interleaving alerts; source budgets apply to the entire run, not each alert.
  for (let pass = 0; pass < 2; pass++) for (const { alert, searches } of plans) for (const provider of sources) {
    if (!runtime.available(provider)) continue;
    const signature = createHash('sha256').update(JSON.stringify(searches)).digest('hex').slice(0, 16);
    const cursorKey = `${alert.id}:${provider}:${signature}`;
    const params = roundRobin(searches, runtime.cursor(cursorKey), 1)[0];
    if (dryRun) { logEvent('search.planned', { provider, ...params }); continue; }
    // Persist progress before I/O: a crashed attempt cannot trap every subsequent run on this pair.
    await runtime.advance(cursorKey);
    const result = await runtime.search(provider, params, () => provider === 'google_flights'
      ? collectGoogleFlights(params, { headless: true }) : collectDespegar(params, { headless: true }));
    if (!result) continue;
    attempted.push({ alert_id: alert.id, origin: params.origin, dest: params.destination,
      dep_date: params.departureDate, ret_date: params.returnDate, passengers: params.passengers });
    for (const quote of result.options) {
      const evaluation = evaluateQuote(params, quote);
      logEvent('critic.decision', { provider, decision: evaluation.approvalStatus, reason: evaluation.reason });
      if (evaluation.approvalStatus !== 'aprobado') continue;
      const quoteKey = JSON.stringify([quote.source, quote.route, quote.departureDate, quote.returnDate, quote.passengers, quote.airline, quote.priceTotalUSD, quote.paymentCondition]);
      if (!persisted.has(quoteKey)) {
        await saveFlightDeal(quote, evaluation);
        persisted.add(quoteKey);
      }
      const key = JSON.stringify([quote.route, quote.departureDate, quote.returnDate, quote.passengers]);
      const entry = pairs.get(key) || { params };
      const field = provider === 'google_flights' ? 'google' : 'despegar';
      if (!entry[field] || quote.priceTotalUSD < entry[field]!.priceTotalUSD) entry[field] = quote;
      pairs.set(key, entry);
    }
  }
  if (!dryRun) {
    await runtime.advance('alerts');
    // A run-scoped artifact lets LangGraph reuse the exact plan rather than inventing different dates.
    await writeFile('search-plan.json', JSON.stringify({ version: 1, searches: attempted }, null, 2));
    for (const entry of pairs.values()) if (entry.google && entry.despegar) {
      await evaluateDealWithGemini(entry.params, entry.google, entry.despegar);
    }
  }
  logEvent('run.completed', { quotes_saved: persisted.size, planned_searches: attempted.length, dry_run: dryRun });
}
main().catch(() => { logEvent('run.failed', { reason: 'unhandled_error' }); process.exitCode = 1; });
