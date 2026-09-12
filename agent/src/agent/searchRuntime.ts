import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FlightSearchParams, ScrapedFlightOption } from '../types/flight.js';
import { searchKey } from './searchPlanner.js';

export type Provider = ScrapedFlightOption['source'];
export interface ProviderResult { status: 'ok' | 'empty' | 'blocked' | 'error' | 'unverified'; options: ScrapedFlightOption[] }
interface State {
  cursors: Record<string, number>;
  cooldown: Partial<Record<Provider, number>>;
  cache: Record<string, { expires: number; result: ProviderResult }>;
  daily: Record<string, number>;
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
  async advance(key: string) { this.state.cursors[key] = this.cursor(key) + 1; await this.save(); }
  available(provider: Provider) {
    return this.used[provider] < this.limits[provider]
      && (this.state.daily[this.dayKey(provider)] || 0) < this.limits[provider] * 2
      && !(this.state.cooldown[provider]! > Date.now());
  }
  private dayKey(provider: Provider) { return `${new Date().toISOString().slice(0, 10)}:${provider}`; }
  private async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(this.state));
    await rename(temp, this.path);
  }
  async search(provider: Provider, params: FlightSearchParams, run: () => Promise<ProviderResult>): Promise<ProviderResult | undefined> {
    const key = createHash('sha256').update(provider + searchKey(params)).digest('hex');
    const cached = this.state.cache[key];
    if (cached && cached.expires > Date.now()) { logEvent('search.cache_hit', { provider, key }); return cached.result; }
    if (!this.available(provider)) { logEvent('search.deferred', { provider, reason: 'budget_or_cooldown' }); return undefined; }
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
    if (result.status === 'blocked') this.state.cooldown[provider] = Date.now() + 24 * 3600000;
    if (result.status === 'error') this.state.cooldown[provider] = Date.now() + 3600000;
    // Unverified markup is not evidence that there are no flights.
    if (result.status === 'ok' || result.status === 'empty') this.state.cache[key] = { expires: Date.now() + (result.status === 'ok' ? 6 : 1) * 3600000, result };
    await this.save();
    logEvent('search.completed', { provider, key, status: result.status, quotes: result.options.length, latency_ms: Date.now() - start, api_credits: 0, searches_used: this.used[provider] });
    return result;
  }
}
