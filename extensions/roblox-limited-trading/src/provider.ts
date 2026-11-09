/** Browser-safe catalog scheduler shared by production and offline acceptance.
 * Transport/storage are injected by the worker; no account data enters here.
 */
import { CATALOG_MAX_BYTES, parseCatalogText, QUOTE_FRESH_MS, type LimitedQuote } from './core';
import { parseLookupMessage } from './protocol';
import { ROUTILITY_ENDPOINT, parseRoutilityCatalogText, type RoutilityQuote } from './providers/routility';
import { ROLIMONS_ENDPOINT } from './providers/rolimons';
import { extensionDiagnosticHistory } from './diagnostics';
import {W8RLD_LIMITED_CATALOG,parseW8rldLimitedCatalogText} from '../../../plugins/lib/w8rldData';

export const PROVIDER_URL = ROLIMONS_ENDPOINT;
export const PROVIDER_TIMEOUT_MS = 8_000;
export const FAILURE_COOLDOWN_MS = 60_000;
export const MAX_STALE_MS = 24 * 60 * 60_000;
export interface CatalogRequest {
  url: typeof PROVIDER_URL | typeof ROUTILITY_ENDPOINT | typeof W8RLD_LIMITED_CATALOG; method: 'GET'; credentials: 'omit'; redirect: 'error';
  cache: 'no-store'; maxBytes: number; signal: AbortSignal;
}
export interface CatalogResponse {
  status: number; contentLength?: number; retryAfter?: string;
  body: AsyncIterable<Uint8Array>;
}
export interface CatalogState { version: 1; provider: 'rolimons' | 'routility'; fetchedAt: number; checkedAt?:number; text: string; retryAt: number; }
export interface CatalogStore { read(): Promise<unknown>; write(state: CatalogState): Promise<void>; }
export interface ProviderDependencies {
  authorized: boolean;
  transport?: (request: CatalogRequest) => Promise<CatalogResponse>;
  store?: CatalogStore;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => unknown;
  unschedule?: (handle: unknown) => void;
  canRequest?:()=>Promise<boolean>;
}
export interface CatalogResult<T = LimitedQuote> {
  state: 'disabled' | 'fresh' | 'stale' | 'unavailable'; quotes: T[];
  retryAt?: number;
}

export function retryAfterDeadline(raw: string | undefined, now: number): number {
  let delay = FAILURE_COOLDOWN_MS;
  if (raw && raw.length <= 128) {
    const seconds = /^\d+$/.test(raw) ? Number(raw) : undefined;
    const parsed = seconds === undefined ? Date.parse(raw) - now : seconds * 1000;
    if (Number.isFinite(parsed)) delay = Math.max(delay, parsed);
    else if (seconds !== undefined && parsed > 0) return Number.MAX_SAFE_INTEGER;
  }
  // A long provider Retry-After must never be shortened to our cache lifetime.
  return Math.min(Number.MAX_SAFE_INTEGER, now + delay);
}

export function createCatalogProvider(deps: ProviderDependencies) {
  return createProvider(deps, 'rolimons', PROVIDER_URL, parseCatalogText);
}
/** Production serving uses W8RLD only. A legacy persisted provider body can be
 * recovered with its original date, but a network response must be v1. */
export function createW8rldCatalogProvider(deps:ProviderDependencies){
  return createProvider(deps,'rolimons',W8RLD_LIMITED_CATALOG,parseW8rldLimitedCatalogText,
    (text,time)=>{try{return parseW8rldLimitedCatalogText(text,time);}catch{return parseCatalogText(text,time);}},
    quotes=>quotes.values().next().value?.fetchedAt??0);
}

/** Separate pinned Routility scheduler/cache; never fills Rolimon's metrics. */
export function createRoutilityCatalogProvider(deps: ProviderDependencies) {
  return createProvider<RoutilityQuote>(deps, 'routility', ROUTILITY_ENDPOINT, parseRoutilityCatalogText);
}

function createProvider<T>(deps: ProviderDependencies, provider: CatalogState['provider'], url: CatalogRequest['url'], parse: (text: string, time: number) => Map<string, T>,recoverParse=parse,sourceTime?:(quotes:Map<string,T>)=>number) {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const unschedule = deps.unschedule ?? ((handle) => globalThis.clearTimeout(handle as number));
  let state: CatalogState = { version: 1, provider, fetchedAt: 0, text: '', retryAt: 0 };
  let quotes = new Map<string, T>();
  let recovery: Promise<void> | undefined;
  let recoveryBlocked = false;
  let flight: { controller: AbortController; promise: Promise<void>; users: number } | undefined;
  let disposed = false;
  async function recover(): Promise<void> {
    if (!deps.store) return;
    try {
      const value = await deps.store.read() as Partial<CatalogState> | null;
      const time = now();
      if (value === undefined || value === null) return;
      if (value.version !== 1 || value.provider !== provider || typeof value.text !== 'string' || value.text.length > CATALOG_MAX_BYTES
        || !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt! < 0 || value.fetchedAt! > time
        || !Number.isSafeInteger(value.retryAt) || value.retryAt! < 0||(value.checkedAt!==undefined&&(!Number.isSafeInteger(value.checkedAt)||value.checkedAt<0||value.checkedAt>time))) { recoveryBlocked = true; return; }
      // A corrupt body must not discard an otherwise valid persisted cooldown.
      let restored = new Map<string, T>();
      if (value.text && time - value.fetchedAt! < MAX_STALE_MS) {
        try { restored = recoverParse(value.text, value.fetchedAt!);if(sourceTime&&sourceTime(restored)!==value.fetchedAt)restored.clear(); } catch { /* Retain the request budget, discard invalid evidence. */ }
      }
      state = { version: 1, provider, fetchedAt: restored.size ? value.fetchedAt! : 0, checkedAt:value.checkedAt??value.fetchedAt, text: restored.size ? value.text : '', retryAt: value.retryAt! };
      quotes = restored;
      if (value.text && !restored.size) await deps.store.write({ ...state });
    } catch {
      extensionDiagnosticHistory.record({code:'W8RLD-EXT-SETTINGS-001',status:'unavailable',enabled:'unknown',stage:'settings'});
      recoveryBlocked = true; /* Unknown persisted request budgets fail closed. */
    }
  }
  async function persist(): Promise<void> {
    try { if (deps.store) await deps.store.write({ ...state }); }
    catch {
      extensionDiagnosticHistory.record({code:'W8RLD-EXT-SETTINGS-001',status:'failed',enabled:'unknown',stage:'settings'});
      throw new Error('Catalog persistence unavailable');
    }
  }
  function result(ids: string[]): CatalogResult<T> {
    const age = now() - state.fetchedAt;
    const usable = state.fetchedAt > 0 && age >= 0 && age < MAX_STALE_MS && quotes.size > 0;
    return { state: usable ? age < QUOTE_FRESH_MS ? 'fresh' : 'stale' : 'unavailable', quotes: usable ? ids.flatMap((id) => quotes.has(id) ? [quotes.get(id)!] : []) : [], ...(state.retryAt > now() ? { retryAt: state.retryAt } : {}) };
  }
  async function refresh(controller: AbortController): Promise<void> {
    let timer: unknown;
    let timedOut = false;
    let rateLimited = false;
    let abortListener: (() => void) | undefined;
    try {
      // Persist a lease BEFORE transport so a restarted worker cannot request
      // repeatedly. A storage failure refuses transport rather than losing it.
      state.retryAt = now() + PROVIDER_TIMEOUT_MS + FAILURE_COOLDOWN_MS;
      await persist();
      if (controller.signal.aborted || disposed) return;
      const aborted = new Promise<never>((_, reject) => {
        abortListener = () => reject(new Error('Catalog request cancelled'));
        controller.signal.addEventListener('abort', abortListener, { once: true });
        timer = schedule(() => { timedOut = true; controller.abort(); }, PROVIDER_TIMEOUT_MS);
      });
      const load = async () => {
        const response = await deps.transport!({ url, method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', maxBytes: CATALOG_MAX_BYTES, signal: controller.signal });
        if (controller.signal.aborted) throw new Error('Cancelled');
        if (response.status !== 200) {
          rateLimited = response.status === 429;
          state.retryAt = retryAfterDeadline(response.retryAfter, now());
          throw new Error('Catalog unavailable');
        }
        if (response.contentLength !== undefined && (!Number.isSafeInteger(response.contentLength) || response.contentLength < 0 || response.contentLength > CATALOG_MAX_BYTES)) throw new Error('Catalog response too large');
        const parts: Uint8Array[] = []; let bytes = 0; let chunks = 0;
        for await (const part of response.body) {
          if (controller.signal.aborted || !(part instanceof Uint8Array) || ++chunks > 8192 || (bytes += part.byteLength) > CATALOG_MAX_BYTES) throw new Error('Invalid catalog stream');
          parts.push(part);
        }
        const body = new Uint8Array(bytes); let offset = 0;
        for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        const checkedAt=now(),parsed=parse(text,checkedAt),fetchedAt=sourceTime?sourceTime(parsed):checkedAt;
        if(sourceTime&&fetchedAt<state.fetchedAt){state.checkedAt=checkedAt;throw Error('Newer last-good snapshot retained');}
        if (!parsed.size || fetchedAt <= 0 || controller.signal.aborted || disposed) throw new Error('Invalid catalog');
        // Persist successful evidence before advertising it as reusable.
        const next: CatalogState = { version: 1, provider, text, fetchedAt,checkedAt, retryAt: 0 };
        if (deps.store) await deps.store.write(next);
        if (controller.signal.aborted || disposed) return;
        state = next; quotes = parsed;
      };
      await Promise.race([load(), aborted]);
    } catch {
      if (!controller.signal.aborted || timedOut) extensionDiagnosticHistory.record({
        code: timedOut ? 'W8RLD-EXT-PROVIDER-002' : 'W8RLD-EXT-PROVIDER-001', status: timedOut ? 'timeout' : rateLimited ? 'rate-limited' : 'unavailable',
        enabled: 'yes', provider, providerStatus: timedOut ? 'timeout' : rateLimited ? 'rate-limited' : 'unavailable',
      });
      controller.abort();
      state.retryAt = Math.max(state.retryAt, now() + FAILURE_COOLDOWN_MS);
      await persist().catch(() => {});
    } finally {
      if (timer !== undefined) unschedule(timer);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
    }
  }
  async function lookup(rawIds: unknown, signal?: AbortSignal): Promise<CatalogResult<T>> {
    const request = parseLookupMessage({ type: 'w8rld:limited-lookup', assetIds: rawIds });
    if (!request) throw new Error('Invalid Limited lookup request');
    if (disposed || signal?.aborted) throw new Error('Catalog request cancelled');
    if (!deps.authorized || !deps.transport) return { state: 'disabled', quotes: [] };
    await (recovery ??= recover());
    if (disposed || signal?.aborted) throw new Error('Catalog request cancelled');
    if (recoveryBlocked) return { state: 'unavailable', quotes: [] };
    if (state.text && now() - state.fetchedAt >= MAX_STALE_MS) {
      extensionDiagnosticHistory.record({ code: 'W8RLD-EXT-CACHE-001', status: 'expired', enabled: 'yes', provider, cache: 'expired' });
      state.text = ''; state.fetchedAt = 0; quotes.clear();
      await persist().catch(() => {});
    }
    if(deps.canRequest&&!await deps.canRequest())return result(request.assetIds);
    if ((state.checkedAt??state.fetchedAt) > 0 && now() - (state.checkedAt??state.fetchedAt) >= 0 && now() - (state.checkedAt??state.fetchedAt) < QUOTE_FRESH_MS) return result(request.assetIds);
    if (!flight && state.retryAt <= now()) {
      const controller = new AbortController();
      const task = { controller, users: 0, promise: Promise.resolve() };
      task.promise = refresh(controller).finally(() => { if (flight === task) flight = undefined; });
      flight = task;
    }
    const task = flight;
    if (!task) return result(request.assetIds);
    task.users++;
    let listener: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        listener = () => reject(new Error('Catalog request cancelled'));
        signal?.addEventListener('abort', listener, { once: true });
        if (signal?.aborted) listener();
      });
      await Promise.race([task.promise, cancelled]);
      if (disposed || signal?.aborted) throw new Error('Catalog request cancelled');
      return result(request.assetIds);
    } finally {
      if (listener) signal?.removeEventListener('abort', listener);
      if (--task.users === 0 && flight === task) task.controller.abort();
    }
  }
  return { lookup,
    async snapshot(signal?: AbortSignal): Promise<CatalogResult<T>> {
      // Worker-only bounded catalog projection; renderer messages remain paged.
      await lookup(['1'], signal);
      return result([...quotes.keys()]);
    },
    async status() {
      await (recovery ??= recover());
      return { ...result([]), quotes: undefined, fetchedAt: state.fetchedAt, entries: quotes.size };
    },
    async clearCache() {
      await (recovery ??= recover());
      if (recoveryBlocked) throw Error('Cannot clear a catalog with an unknown persisted request budget.');
      // An in-flight refresh may have already persisted its pre-request lease.
      // Wait for its cancellation before discarding observations; never reset budgets.
      const task = flight; task?.controller.abort(); await task?.promise;
      quotes.clear(); state.text = ''; state.fetchedAt = 0; await persist();
    },
    async search(rank: (quote: T) => number | undefined, limit = 20, signal?: AbortSignal): Promise<CatalogResult<T>> {
      // Uses this same catalog/cache/request budget; queries never leave the worker.
      await lookup(['1'], signal);
      const ids = [...quotes].flatMap(([id, quote]) => { const n = rank(quote); return n === undefined ? [] : [{ id, rank: n }]; })
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).slice(0, Math.max(1, Math.min(20, limit))).map(r => r.id);
      return result(ids);
    },
    dispose() { disposed = true; flight?.controller.abort(); } };
}
