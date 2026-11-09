/** Credentialless browser transport for the existing desktop public catalogs.
 * Only the worker imports this module. Messages never select a URL or headers.
 */
import { CATALOG_MAX_BYTES } from '../../../plugins/lib/robloxLimitedValuation';
import { W8RLD_LIMITED_CATALOG,W8RLD_DATA_ORIGIN } from '../../../plugins/lib/w8rldData';
import { createW8rldCatalogProvider, createRoutilityCatalogProvider, retryAfterDeadline, type CatalogRequest, type CatalogResponse, type CatalogState, type CatalogStore } from './provider';

export async function fetchCatalog(request: CatalogRequest): Promise<CatalogResponse> {
  if (request.url!==W8RLD_LIMITED_CATALOG || request.method !== 'GET'
    || request.credentials !== 'omit' || request.redirect !== 'error' || request.cache !== 'no-store'
    || request.maxBytes !== CATALOG_MAX_BYTES) throw new Error('Unsupported catalog request');
  const response = await fetch(request.url, {
    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: request.signal, headers: { Accept: 'application/json' },
  });
  const contentLength = response.headers.get('content-length');
  const json = /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
  return {
    status: response.status === 200 && !json ? 502 : response.status,
    ...(contentLength === null ? {} : { contentLength: /^\d+$/.test(contentLength) ? Number(contentLength) : Infinity }),
    retryAfter: response.headers.get('retry-after') ?? undefined,
    body: (async function* () {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing catalog body');
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return;
          bytes += chunk.value.byteLength;
          if (bytes > CATALOG_MAX_BYTES) throw new Error('Catalog response too large');
          yield chunk.value;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    })(),
  };
}

interface LocalCatalogStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, CatalogState>): Promise<void>;
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

/** Reuse the existing scheduler/store contract, with no account or trade store. */
export function createBrowserProviders(local: LocalCatalogStorage,permissions?:{contains(options:{origins:string[]}):Promise<boolean>}) {
  // Catalogs and persisted request budgets are worker-only, never content storage.
  const access = Promise.resolve().then(() => local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }));
  void access.catch(() => {});
  const store = (provider: CatalogState['provider']): CatalogStore => {
    const key = `w8rld:catalog:v1:${provider}`;
    return {
      async read() { await access; return (await local.get(key))[key]; },
      async write(state) { await access; await local.set({ [key]: state }); },
    };
  };
  return {
    rolimons: createW8rldCatalogProvider({ authorized: true, transport: fetchCatalog, store: store('rolimons'),canRequest:async()=>{try{return !!await permissions?.contains({origins:[W8RLD_DATA_ORIGIN]});}catch{return false;}} }),
    // No admitted durable Routility USD/ask feed. Keep the old cache/request
    // ledger recoverable; do not invoke its former browsing-time transport.
    routility: createRoutilityCatalogProvider({ authorized: true, store: store('routility') }),
  };
}

/** Exact public factual paths only. No arbitrary URL, cookies, redirects or API writes. */
export async function readRobloxPublicJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const u = new URL(url);
  const allowed = !u.username && !u.password && !u.hash && u.protocol === 'https:' && (
    u.hostname === 'friends.roblox.com' && !u.search && /^\/v1\/users\/[1-9]\d{0,15}\/(?:followers|followings|friends)\/count$/.test(u.pathname)
    || u.hostname === 'users.roblox.com' && !u.search && /^\/v1\/users\/[1-9]\d{0,15}$/.test(u.pathname)
    || u.hostname === 'groups.roblox.com' && (!u.search && (/^\/v1\/groups\/[1-9]\d{0,15}$/.test(u.pathname) || /^\/v2\/users\/[1-9]\d{0,15}\/groups\/roles$/.test(u.pathname)) || u.pathname === '/v2/groups' && /^\?groupIds=[1-9]\d{0,15}$/.test(u.search))
    || u.hostname === 'games.roblox.com' && u.pathname === '/v1/games' && /^\?universeIds=[1-9]\d{0,15}$/.test(u.search)
    || u.hostname === 'apis.roblox.com' && u.pathname === '/search-api/omni-search'
      && [...u.searchParams.keys()].every(k => ['verticalType','searchQuery','pageToken','globalSessionId','sessionId','pageType'].includes(k))
      && [...u.searchParams.keys()].length === new Set(u.searchParams.keys()).size
      && (u.searchParams.get('searchQuery')?.length ?? 0) >= 2 && (u.searchParams.get('searchQuery')?.length ?? 101) <= 100
      && u.searchParams.get('pageToken') === '' && /^[a-f0-9-]{36}$/.test(u.searchParams.get('sessionId') ?? '')
      && (u.searchParams.get('verticalType') === 'user' && u.searchParams.get('globalSessionId') === u.searchParams.get('sessionId') && !u.searchParams.has('pageType')
        || u.searchParams.get('pageType') === 'all' && !u.searchParams.has('verticalType') && !u.searchParams.has('globalSessionId')));
  if (!allowed || u.port || url !== u.href) throw Error('Unsupported public fact path');
  return readBoundedPublicJson(url,signal);
}

/** Pinned upstream getHistory's public URL; no arbitrary host/path/options. */
export async function readRoutilityHistory(id: string, signal: AbortSignal): Promise<unknown> {
  if (!/^[1-9]\d{0,15}$/.test(id) || Number(id)>Number.MAX_SAFE_INTEGER) throw Error('Unsupported public item');
  return readBoundedPublicJson(`https://routility.io/api/public/item-usd-history/${id}`,signal);
}
async function readBoundedPublicJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel(); const retryAt = retryAfterDeadline(response.headers.get('retry-after') ?? undefined, Date.now());
    throw Object.assign(Error('Public facts unavailable'), { retryAt });
  }
  const reader = response.body?.getReader(); if (!reader) throw Error('Public facts unavailable');
  let bytes = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const r = await reader.read(); if (r.done) break; bytes += r.value.byteLength; if (bytes > 128 * 1024) throw Error('Public response too large'); chunks.push(r.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const data = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
}
