import 'dotenv/config';
import { writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { collectGoogleFlights } from './skills/googleFlights.js';
import { collectDespegar } from './skills/despegar.js';
import { evaluateDealWithGemini } from './agent/geminiEvaluator.js';
import { evaluateQuote, quoteIntegrityReason } from './agent/quotePolicy.js';
import { buildSearchSpace, roundRobin, searchKey, searchSpaceSignature, parseSearchFocus, matchesFocus, type SearchAlert } from './agent/searchPlanner.js';
import { SearchRuntime, logEvent, type Provider, type ProviderResult } from './agent/searchRuntime.js';
import { saveFlightDeal, getActiveSearchAlerts, getMonitoringSavedDeals, persistMonitoring } from './db/supabase.js';
import { savedChecks, watchTargets, pickMonitoringSearch } from './agent/monitoring.js';
import type { FlightSearchParams, ScrapedFlightOption } from './types/flight.js';

export const huntIO = { getActiveSearchAlerts, getMonitoringSavedDeals, saveFlightDeal, persistMonitoring,
  collectGoogleFlights, collectDespegar, evaluateDealWithGemini,
  writePlan: (plan: Record<string, unknown>) => writeFile('search-plan.json', JSON.stringify(plan, null, 2)),
  writeSummary: async (summary: string) => {
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  },
};

export async function runHunt(args = process.argv.slice(2), io = huntIO, runtime = new SearchRuntime(), focusValue = process.env.FLIGHT_FOCUS || '') {
  const dryRun = args.includes('--dry-run');
  const focus = parseSearchFocus(focusValue);
  const alerts = await io.getActiveSearchAlerts() as SearchAlert[];
  if (!alerts.length) {
    if (focus) throw new Error('La combinación priorizada debe pertenecer a un radar activo');
    if (!dryRun) await io.writePlan({ version: 1, searches: [] });
    logEvent('run.skipped', { reason: 'no_active_alerts' }); return;
  }
  await runtime.load();
  const saved = await io.getMonitoringSavedDeals();
  const ordered = roundRobin(alerts, runtime.cursor('alerts'), alerts.length);
  const plans = ordered.map(alert => ({ alert, searches: buildSearchSpace(alert) })).filter(p => p.searches.length);
  if (focus) {
    if (!plans.some(plan => plan.searches.some(p => matchesFocus(p, focus)))) throw new Error('La combinación priorizada no está dentro de un radar activo con esos pasajeros');
    plans.sort((a, b) => Number(b.searches.some(p => matchesFocus(p, focus))) - Number(a.searches.some(p => matchesFocus(p, focus))));
  }
  const attempted: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const deferred: Array<{ provider: Provider; reason: string }> = [];
  const sources: Provider[] = args.includes('--test-despegar') ? ['despegar'] : args.includes('--test-google') ? ['google_flights'] : ['google_flights', 'despegar'];
  const pairs = new Map<string, { params: FlightSearchParams; google?: ScrapedFlightOption; despegar?: ScrapedFlightOption }>();
  const persisted = new Set<string>();
  const queryResults = new Map<string, ProviderResult>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  // Fill existing caps (Google 4 / Despegar 2), alternating exploration and monitoring.
  // Rotating alerts preserves fairness; duplicate searches are shared within this run.
  for (let pass = 0; pass < 4; pass++) for (const { alert, searches } of plans) for (const provider of sources) {
    const signature = searchSpaceSignature(searches);
    const cursorKey = `${alert.id}:${provider}:${signature}`;
    const watches = watchTargets(alert, searches, saved, provider);
    const priority = focus && searches.find(p => matchesFocus(p, focus) && !visited.has(`${alert.id}:${provider}:${searchKey(p)}`));
    const selection = priority ? { params: priority, follow: false, steps: 0 } : pickMonitoringSearch(searches, watches, runtime.cursor(`mode:${provider}`) % 2 === 1,
      runtime.cursor(cursorKey), runtime.cursor(`${cursorKey}:watch`), p => visited.has(`${alert.id}:${provider}:${searchKey(p)}`));
    if (!selection) continue;
    const { params, follow: following, steps } = selection;
    const selectedCursor = following ? `${cursorKey}:watch` : cursorKey;
    const key = `${provider}:${searchKey(params)}`;
    const previous = queryResults.get(key);
    if (!previous && !runtime.available(provider)) {
      logEvent('search.deferred', { provider, reason: runtime.deferralReason(provider), priority: !!priority });
      continue;
    }
    visited.add(`${alert.id}:${provider}:${searchKey(params)}`);
    const mode = priority ? 'focus' : following ? 'follow' : 'explore';
    if (dryRun) { logEvent('search.planned', { provider, mode, ...params }); continue; }
    // Persist progress before I/O: a crashed attempt cannot trap every subsequent run on this pair.
    if (!priority) {
      await runtime.advance(selectedCursor, steps);
      await runtime.advance(`mode:${provider}`);
    }
    logEvent('search.selected', { provider, mode, origin: params.origin, destination: params.destination,
      departure: params.departureDate, return: params.returnDate, passengers: params.passengers });
    const result = previous || await runtime.search(provider, params, () => provider === 'google_flights'
      ? io.collectGoogleFlights(params, { headless: true }) : io.collectDespegar(params, { headless: true }));
    if (!result) continue;
    queryResults.set(key, result);
    await runtime.recordCoverage(cursorKey, params, result);
    await io.persistMonitoring(savedChecks(alert, params, provider, result, saved, result.checkedAt || new Date().toISOString()), {
      radar_id: alert.id, provider, checked_at: result.checkedAt || new Date().toISOString(), outcome: result.status,
      checked_combinations: runtime.coverageCount(cursorKey, Date.parse(result.checkedAt || new Date().toISOString())), total_combinations: searches.length,
    });
    reported.add(`${alert.id}:${provider}`);
    receipts.push({ provider, mode, origin: params.origin, destination: params.destination,
      departure: params.departureDate, return: params.returnDate, passengers: params.passengers,
      status: result.status, quotes: result.options.length, checked_at: result.checkedAt });
    attempted.push({ alert_id: alert.id, origin: params.origin, dest: params.destination,
      dep_date: params.departureDate, ret_date: params.returnDate, passengers: params.passengers });
    for (const quote of result.options) {
      const evaluation = evaluateQuote(params, quote);
      logEvent('critic.decision', { provider, decision: evaluation.approvalStatus, reason: evaluation.reason });
      if (quoteIntegrityReason(params, quote)) continue;
      const quoteKey = JSON.stringify([quote.source, quote.route, quote.departureDate, quote.returnDate, quote.passengers, quote.airline, quote.priceTotalUSD, quote.paymentCondition]);
      if (!persisted.has(quoteKey)) {
        await io.saveFlightDeal(quote, evaluation, evaluation.approvalStatus === 'rechazado');
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
      const signature = searchSpaceSignature(searches);
      const pause = runtime.pauseStatus(provider);
      const checkedAt = pause?.checked_at || new Date().toISOString();
      await io.persistMonitoring([], { radar_id: alert.id, provider, checked_at: new Date().toISOString(), outcome: 'deferred',
        checked_combinations: runtime.coverageCount(`${alert.id}:${provider}:${signature}`, Date.parse(checkedAt)), total_combinations: searches.length,
        ...pause });
      deferred.push({ provider, reason: runtime.deferralReason(provider) || 'no_unvisited_combination' });
    }
    await runtime.advance('alerts');
    // A run-scoped artifact lets LangGraph reuse the exact plan rather than inventing different dates.
    await io.writePlan({ version: 1, searches: attempted, provider_results: receipts, deferred_sources: deferred });
    const deferredLabels: Record<string, string> = {
      run_budget_exhausted: 'Tope de intentos por corrida alcanzado',
      daily_budget_exhausted: 'Tope diario alcanzado (incluye corridas manuales)',
      provider_blocked: 'Pausa por bloqueo del proveedor', provider_error: 'Pausa por error de consulta',
      provider_cooldown: 'Pausa heredada; motivo anterior no registrado',
      no_unvisited_combination: 'No quedan combinaciones pendientes en esta corrida',
    };
    await io.writeSummary(`## Resultado de la búsqueda\n\n${persisted.size} cotizaciones verificadas registradas; ${reported.size} pares radar/fuente procesados.\n\n`
      + '| Fuente | Ruta | Ida / vuelta | Adultos | Resultado | Cotizaciones |\n|---|---|---|---|---|---|\n'
      + receipts.map(r => `| ${r.provider} | ${r.origin}–${r.destination} | ${r.departure} / ${r.return} | ${r.passengers} | ${r.status} | ${r.quotes} |`).join('\n')
      + '\n\nFuentes sin intento por cuota o pausa: ' + (plans.length * sources.length - reported.size)
      + '. Un job terminado no confirma que todas las fechas hayan sido consultadas.\n'
      + (deferred.length ? '\n| Fuente sin intento | Motivo |\n|---|---|\n'
        + deferred.map(d => `| ${d.provider} | ${deferredLabels[d.reason]} |`).join('\n') + '\n' : ''));
    for (const entry of pairs.values()) if (entry.google && entry.despegar) {
      await io.evaluateDealWithGemini(entry.params, entry.google, entry.despegar);
    }
  }
  logEvent('run.completed', { quotes_saved: persisted.size, planned_searches: attempted.length, dry_run: dryRun });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runHunt().catch(error => {
  console.error(error instanceof Error ? error.message : 'Error de ejecución');
  logEvent('run.failed', { reason: error instanceof Error && error.message.includes('schema_monitoring.sql')
    ? 'missing_monitoring_schema: apply schema_monitoring.sql' : 'unhandled_error' }); process.exitCode = 1;
});
