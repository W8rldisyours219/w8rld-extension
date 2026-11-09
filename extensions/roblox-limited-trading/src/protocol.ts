/** Pure internal message contract. No page execution, credentials or network. */
import { finiteNonNegative, QUOTE_SOURCE, safeAssetId, type LimitedQuote } from './core';
import type { MetricObservation } from './marketEvidence';
import { companionRoute } from './preferences';
import { routilityThumbnailUrl } from '../../../plugins/lib/robloxLimitedValuation';

export const MAX_LOOKUP_IDS = 100;
export const MAX_REPLY_BYTES = 128 * 1024;
export type LookupMessage = { type: 'w8rld:limited-lookup'; assetIds: string[] };
export type LookupErrorCode = 'INVALID_SENDER' | 'INVALID_REQUEST' | 'PROVIDER_DISABLED' | 'CATALOG_UNAVAILABLE';
export interface ItemFacts { assetId: string; retrievedAt: number; bestPrice?: number; copies?: number; premiumCopies?: number; hoardShare?: number; thumbnailUrl?: string; }
export interface ProviderStatus { state: 'disabled' | 'fresh' | 'stale' | 'unavailable'; retryAt?: number; }
export type LookupReply = { ok: true; quotes: LimitedQuote[]; usdQuotes?: MetricObservation<number>[]; demandQuotes?: MetricObservation<string>[]; facts?: ItemFacts[]; providers?: { rolimons: ProviderStatus; routility: ProviderStatus } } | { ok: false; code: LookupErrorCode; error: string };
export interface LookupSender { id?: string; url?: string; origin?: string; frameId?: number; tab?: { id?: number; url?: string }; }
const keysAre = (value: object, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));

export function validSender(sender: LookupSender | undefined, extensionId: string): boolean {
  // Chrome retains the document URL in sender.url across same-document SPA
  // navigation, while tab.url follows the current route. Validate both against
  // the exact origin/trade-route boundary rather than requiring byte equality.
  return !!extensionId && sender?.id === extensionId && sender.frameId === 0 && sender.origin === 'https://www.roblox.com'
    && typeof sender.url === 'string' && !!companionRoute(sender.url)
    && typeof sender.tab?.id === 'number' && Number.isSafeInteger(sender.tab.id) && sender.tab.id >= 0
    && typeof sender.tab.url === 'string' && !!companionRoute(sender.tab.url);
}

export function parseLookupMessage(value: unknown): LookupMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !keysAre(value, ['type', 'assetIds'])) return undefined;
  const message = value as { type?: unknown; assetIds?: unknown };
  if (message.type !== 'w8rld:limited-lookup' || !Array.isArray(message.assetIds) || !message.assetIds.length || message.assetIds.length > MAX_LOOKUP_IDS) return undefined;
  const ids: string[] = [];
  for (const raw of message.assetIds) { const id = safeAssetId(raw); if (!id) return undefined; ids.push(id); }
  return { type: 'w8rld:limited-lookup', assetIds: [...new Set(ids)] };
}

export function parseLookupReply(value: unknown, requestedIds: readonly string[]): LookupReply | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const reply = value as { ok?: unknown; quotes?: unknown; usdQuotes?: unknown; demandQuotes?: unknown; code?: unknown; error?: unknown };
  if (reply.ok === false) {
    if (!keysAre(value, ['ok', 'code', 'error']) || typeof reply.code !== 'string' || !['INVALID_SENDER', 'INVALID_REQUEST', 'PROVIDER_DISABLED', 'CATALOG_UNAVAILABLE'].includes(reply.code) || typeof reply.error !== 'string' || reply.error.length > 256) return undefined;
    return reply as LookupReply;
  }
  if (reply.ok !== true || !keysAre(value, ['ok', 'quotes', 'usdQuotes', 'demandQuotes', 'facts', 'providers']) || !Array.isArray(reply.quotes) || reply.quotes.length > MAX_LOOKUP_IDS || reply.quotes.length > requestedIds.length) return undefined;
  const providers = (value as { providers?: unknown }).providers;
  if (providers !== undefined) {
    if (!providers || typeof providers !== 'object' || Array.isArray(providers) || !keysAre(providers, ['rolimons', 'routility'])) return undefined;
    for (const name of ['rolimons', 'routility'] as const) {
      const status = (providers as Record<string, unknown>)[name] as Partial<ProviderStatus> | undefined;
      if (!status || typeof status !== 'object' || Array.isArray(status) || !keysAre(status, ['state', 'retryAt'])
        || !['disabled', 'fresh', 'stale', 'unavailable'].includes(status.state!)
        || status.retryAt !== undefined && (!Number.isSafeInteger(status.retryAt) || status.retryAt < 0)) return undefined;
    }
  }
  const facts = (value as { facts?: unknown }).facts;
  if (facts !== undefined) {
    if (!Array.isArray(facts) || facts.length > requestedIds.length || facts.length > MAX_LOOKUP_IDS) return undefined;
    const seen = new Set<string>();
    for (const f of facts) {
      if (!f || typeof f !== 'object' || Array.isArray(f) || !keysAre(f, ['assetId', 'retrievedAt', 'bestPrice', 'copies', 'premiumCopies', 'hoardShare', 'thumbnailUrl'])
        || safeAssetId(f.assetId) !== f.assetId || !requestedIds.includes(f.assetId) || seen.has(f.assetId)
        || finiteNonNegative(f.retrievedAt) === undefined || f.retrievedAt <= 0 || f.retrievedAt > Date.now() + 60_000
        || ['bestPrice', 'copies', 'premiumCopies'].some(k => f[k] !== undefined && finiteNonNegative(f[k]) === undefined)
        || f.hoardShare !== undefined && (typeof f.hoardShare !== 'number' || !Number.isFinite(f.hoardShare) || f.hoardShare <= 0 || f.hoardShare > 1)
        || f.thumbnailUrl !== undefined && routilityThumbnailUrl(f.thumbnailUrl) !== f.thumbnailUrl) return undefined;
      seen.add(f.assetId);
    }
  }
  if (reply.usdQuotes !== undefined) {
    if (!Array.isArray(reply.usdQuotes) || reply.usdQuotes.length > MAX_LOOKUP_IDS || reply.usdQuotes.length > requestedIds.length) return undefined;
    const seenUsd = new Set<string>();
    for (const raw of reply.usdQuotes) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !keysAre(raw, ['provider', 'unit', 'assetId', 'value', 'retrievedAt', 'coverage', 'freshness', 'availability', 'validation'])) return undefined;
      const q = raw as MetricObservation<number>;
      if (q.provider !== 'routility' || q.unit !== 'USD' || safeAssetId(q.assetId) !== q.assetId || !requestedIds.includes(q.assetId) || seenUsd.has(q.assetId)
        || typeof q.value !== 'number' || !Number.isFinite(q.value) || q.value < 0 || q.value > Number.MAX_SAFE_INTEGER
        || finiteNonNegative(q.retrievedAt) === undefined || q.retrievedAt <= 0 || q.retrievedAt > Date.now() + 60_000
        || q.coverage !== 'complete' || !['fresh', 'stale', 'expired'].includes(q.freshness) || q.availability !== 'available' || q.validation !== 'validated') return undefined;
      seenUsd.add(q.assetId);
    }
  }
  const seen = new Set<string>();
  if(reply.demandQuotes!==undefined){
    if(!Array.isArray(reply.demandQuotes)||reply.demandQuotes.length>requestedIds.length||reply.demandQuotes.length>MAX_LOOKUP_IDS)return undefined;
    const ids=new Set<string>();
    for(const q of reply.demandQuotes){
      if(!q||typeof q!=='object'||!keysAre(q,['provider','unit','assetId','value','retrievedAt','coverage','freshness','availability','validation'])
        ||q.provider!=='routility'||q.unit!=='ITEM_DEMAND'||!requestedIds.includes(q.assetId)||safeAssetId(q.assetId)!==q.assetId||ids.has(q.assetId)
        ||!['Terrible','Low','Normal','High','Amazing'].includes(q.value as string)||!Number.isSafeInteger(q.retrievedAt)||q.retrievedAt<=0||q.retrievedAt>Date.now()+60_000
        ||q.coverage!=='complete'||q.availability!=='available'||q.validation!=='validated'||!['fresh','stale','expired'].includes(q.freshness))return undefined;
      ids.add(q.assetId);
    }
  }
  for (const raw of reply.quotes) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !keysAre(raw, ['assetId', 'name', 'acronym', 'rap', 'estimatedValue', 'demand', 'trend', 'projected', 'rare', 'source', 'fetchedAt','observedAt'])) return undefined;
    const q = raw as LimitedQuote;
    if (safeAssetId(q.assetId) !== q.assetId || !requestedIds.includes(q.assetId) || seen.has(q.assetId)
      || typeof q.name !== 'string' || !q.name.trim() || q.name.length > 256
      || (q.acronym !== undefined && (typeof q.acronym !== 'string' || !q.acronym.trim() || q.acronym.length > 64))
      || (q.rap !== undefined && (typeof q.rap!=='number'||!Number.isFinite(q.rap)||q.rap<0||q.rap>Number.MAX_SAFE_INTEGER))
      || (q.estimatedValue !== undefined && (typeof q.estimatedValue!=='number'||!Number.isFinite(q.estimatedValue)||q.estimatedValue<0||q.estimatedValue>Number.MAX_SAFE_INTEGER))
      || !['Terrible', 'Low', 'Normal', 'High', 'Amazing', 'Unavailable'].includes(q.demand)
      || !['Lowering', 'Unstable', 'Stable', 'Raising', 'Fluctuating', 'Unavailable'].includes(q.trend)
      || !['unknown', 'projected', 'not-projected'].includes(q.projected)
      || (q.rare !== undefined && !['unknown', 'rare', 'not-rare'].includes(q.rare))
      || q.source !== QUOTE_SOURCE || finiteNonNegative(q.fetchedAt) === undefined || q.fetchedAt <= 0 || q.fetchedAt > Date.now() + 60_000
      ||(q.observedAt!==undefined&&(!Number.isSafeInteger(q.observedAt)||q.observedAt<=0||q.observedAt>q.fetchedAt))) return undefined;
    seen.add(q.assetId);
  }
  // Field and collection limits bound allocation before the serialized-size check.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_REPLY_BYTES) return undefined;
  return reply as LookupReply;
}
