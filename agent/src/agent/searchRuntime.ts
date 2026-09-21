import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import { searchKey } from './searchPlanner.js';

export type Provider = ScrapedFlightOption['source'];
export type DeferralReason = 'run_budget_exhausted' | 'daily_budget_exhausted' | 'provider_blocked' | 'provider_error' | 'provider_cooldown';
export interface ProviderResult { status: 'ok' | 'empty' | 'blocked' | 'error' | 'unverified'; options: ScrapedFlightOption[]; reason?: string; stage?: string; checkedAt?: string }
interface State {
  cursors: Record<string, number>;
  cooldown: Partial<Record<Provider, number>>;
  pauses?: Partial<Record<Provider, { outcome: 'blocked' | 'error'; checked_at: string }>>;
  cache: Record<string, { expires: number; result: ProviderResult }>;
  daily: Record<string, number>;
  coverage?: Record<string, Record<string, number>>;
}
export const logEvent = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));

export class SearchRuntime {
  private state: State = { cursors: {}, cooldown: {}, cache: {}, daily: {} };
  private used: Record<Provider, number> = { google_flights: 0, despegar: 0 };
  private last: Partial<Record<Provider, number>> = {};
  constructor(private path = resolve(process.env.FLIGHT_STATE_PATH || '.flight-state/state.json'),
    private limits: Record<Provider, number> = { google_flights: 4, despegar: 2 }, private intervalMs = 30000) {}

  async load() {
    try { const data = JSON.parse(await readFile(this.path, 'utf8'));
      if (data?.cursors && data?.cooldown && data?.cache) this.state = { ...data, daily: data.daily || {} };
      else throw new Error('Invalid persisted state');
    } catch (error: any) { if (error.code !== 'ENOENT') throw new Error('No se pudo leer el estado de búsquedas; se detiene para evitar repetir consultas'); }
    for (const [key, entry] of Object.entries(this.state.cache)) if (entry.expires <= Date.now()) delete this.state.cache[key];
  }
  cursor(key: string) { const n = this.state.cursors[key]; return Number.isSafeInteger(n) && n >= 0 ? n : 0; }
  coverageCount(key: string, now = Date.now()) {
    return Object.values(this.state.coverage?.[key] || {}).filter(time => time > now - 86400000 && time <= now).length;
  }
  async recordCoverage(key: string, params: FlightSearchParams, result: ProviderResult) {
    if (!['ok', 'empty'].includes(result.status)) return;
    const at = Date.parse(result.checkedAt || '');
    if (!Number.isFinite(at)) return;
    this.state.coverage ??= {};
    for (const [group, entries] of Object.entries(this.state.coverage)) {
      // A paused source can display its actual last attempt for up to 24 h. Keep
      // enough history to reconstruct the 24 h coverage window at that timestamp.
      for (const [query, time] of Object.entries(entries)) if (time <= Date.now() - 2 * 86400000) delete entries[query];
      if (!Object.keys(entries).length) delete this.state.coverage[group];
    }
    const entries = this.state.coverage[key] ??= {};
    entries[createHash('sha256').update(searchKey(params)).digest('hex')] = at;
    await this.save();
  }
  async advance(key: string, steps = 1) {
    if (!Number.isSafeInteger(steps) || steps < 1) throw new Error('Invalid cursor advance');
    this.state.cursors[key] = this.cursor(key) + steps; await this.save();
  }
  available(provider: Provider) {
    return this.deferralReason(provider) === undefined;
  }
  deferralReason(provider: Provider): DeferralReason | undefined {
    if (this.state.cooldown[provider]! > Date.now()) {
      const pause = this.pauseStatus(provider);
      return pause?.outcome === 'blocked' ? 'provider_blocked' : pause?.outcome === 'error' ? 'provider_error' : 'provider_cooldown';
    }
    if (this.used[provider] >= this.limits[provider]) return 'run_budget_exhausted';
    if ((this.state.daily[this.dayKey(provider)] || 0) >= this.limits[provider] * 2) return 'daily_budget_exhausted';
    return undefined;
  }
  /** A skipped run does not turn yesterday's block into a new provider consultation. */
  pauseStatus(provider: Provider): { outcome: 'blocked' | 'error'; checked_at: string } | undefined {
    const pause = this.state.pauses?.[provider];
    if (!(this.state.cooldown[provider]! > Date.now()) || !pause
      || !['blocked', 'error'].includes(pause.outcome) || !Number.isFinite(Date.parse(pause.checked_at))) return undefined;
    return { ...pause };
  }
  private dayKey(provider: Provider) { return `${new Date().toISOString().slice(0, 10)}:${provider}`; }
  private async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(this.state));
    await rename(temp, this.path);
  }
  async search(provider: Provider, params: FlightSearchParams, run: () => Promise<ProviderResult>): Promise<ProviderResult | undefined> {
    // Retire old extracted quotes without resetting quota reservations or cooldowns.
    const version = provider === 'google_flights' ? ':verified-dom-v2:' : '';
    const key = createHash('sha256').update(provider + version + searchKey(params)).digest('hex');
    const cached = this.state.cache[key];
    if (cached && cached.expires > Date.now()) { logEvent('search.cache_hit', { provider, key }); return cached.result; }
    if (!this.available(provider)) { logEvent('search.deferred', { provider, reason: this.deferralReason(provider) }); return undefined; }
    const wait = this.intervalMs - (Date.now() - (this.last[provider] || 0));
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.used[provider]++;
    const day = this.dayKey(provider);
    this.state.daily[day] = (this.state.daily[day] || 0) + 1;
    await this.save();  // Reserve before navigation, including attempts interrupted by a runner crash.
    this.last[provider] = Date.now();
    const start = Date.now();
    let result: ProviderResult;
    try { result = await run(); } catch { result = { status: 'error', options: [] }; }
    result = { ...result, checkedAt: new Date().toISOString() };
    if (result.status === 'blocked' || result.status === 'error') {
      this.state.cooldown[provider] = Date.now() + (result.status === 'blocked' ? 24 : 1) * 3600000;
      this.state.pauses ??= {};
      this.state.pauses[provider] = { outcome: result.status, checked_at: result.checkedAt! };
    }
    // Unverified markup is not evidence that there are no flights.
    if (result.status === 'ok' || result.status === 'empty') this.state.cache[key] = { expires: Date.now() + (result.status === 'ok' ? 6 : 1) * 3600000, result };
    await this.save();
    logEvent('search.completed', { provider, key, status: result.status, reason: result.reason, stage: result.stage, quotes: result.options.length, latency_ms: Date.now() - start, api_credits: 0, searches_used: this.used[provider] });
    return result;
  }
}
