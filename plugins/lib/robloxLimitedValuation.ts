/** Pure Roblox Limited valuation contracts shared by desktop and browser adapters.
 * No transport, cache, DOM, settings, Electron or account dependency.
 * Desktop compatibility and browser-strict admission policies stay explicit;
 * neither policy establishes provider access permission or a live schema.
 */
import { calculateTrade, quantityWeightedSum } from './calculatorCore';
import type { ValuationMetadata } from './valuationProvenance';

export const DESKTOP_ITEM_CACHE_MS = 30 * 60_000;

export const ROLIMONS_ENDPOINT = 'https://www.rolimons.com/itemapi/itemdetails';

/** One authoritative field layout. Field 4 is deliberately never a Value fallback. */
function rolimonsFields(row: unknown[]) {
  return { name: row[0], acronym: row[1], rap: row[2], value: row[3], demand: row[5], trend: row[6], projected: row[7], rare: row[9] };
}

export interface RolimonsItem {
  id: string;
  name: string;
  acronym: string;
  rap: number;
  value: number;
  demand: number;
  trend: number;
  observedAt?:number;
}

export interface RoutilityRow {
  id: number | string;
  value?: number;
  rap?: number;
  bestPrice?: number;
  copies?: number;
  premiumCopies?: number;
  demand?: string;
  trend?: string;
  usd?: number;
  name?: string;
  thumb?: string;
}

function numOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function demandLabel(value: number): string {
  return ({ '-1': 'N/A', 0: 'Terrible', 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Amazing' } as Record<string, string>)[String(value)] ?? 'N/A';
}

export function trendLabel(value: number): string {
  return ({ '-1': 'N/A', 0: 'Lowering', 1: 'Unstable', 2: 'Stable', 3: 'Raising', 4: 'Fluctuating' } as Record<string, string>)[String(value)] ?? 'N/A';
}

/** Rolimons array fields: name, acronym, RAP, Value, default value, demand, trend.
 * Negative/missing amounts stay unavailable (-1 for existing numeric consumers).
 * In particular field 4 (default/RAP-derived value) never replaces field 3. */
export function normalizeRolimonsItems(payload: unknown): RolimonsItem[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Rolimons catalog.');
  const raw = payload as { success?: unknown; items?: unknown };
  if (raw.success === false || !raw.items || typeof raw.items !== 'object' || Array.isArray(raw.items)) throw new Error('Invalid Rolimons catalog.');
  const amount = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : -1;
  const items = Object.entries(raw.items).flatMap(([id, row]): RolimonsItem[] => {
    if (!/^\d+$/.test(id) || !Array.isArray(row) || row.length < 4) return [];
    const fields = rolimonsFields(row);
    return [{ id, name: typeof fields.name === 'string' ? fields.name.trim() : '', acronym: typeof fields.acronym === 'string' ? fields.acronym : '',
      rap: amount(fields.rap), value: amount(fields.value), demand: numOr(fields.demand, -1), trend: numOr(fields.trend, -1) }];
  });
  if (!items.length) throw new Error('Rolimons catalog contains no supported item rows.');
  return items;
}

/** Existing desktop best-effort contract: preserve row identities, last-row wins
 * and its admission behavior. Browser ingestion uses the strict adapter below. */
export function indexRoutilityItems(payload: unknown): Map<string, RoutilityRow> {
  const rows = (payload as { items?: RoutilityRow[] }).items ?? [];
  return new Map(rows.map(row => [String(row.id), row]));
}

/** Strict browser projection: bounded canonical IDs, integer native amounts and independent coverage. */
export const EXTENSION_VERSION = '0.2.0';
export const CATALOG_LIMIT = 15000;
export const VALUE_EVEN_BAND_PCT = 5;
export const MAX_QUANTITY = 1000;
export const CATALOG_MAX_BYTES = 4 * 1024 * 1024;
export const QUOTE_FRESH_MS = 15 * 60_000;
export const QUOTE_SOURCE = 'Rolimon’s public item catalog';

export type TradeSide = 'give' | 'receive';
export type Demand = 'Terrible' | 'Low' | 'Normal' | 'High' | 'Amazing' | 'Unavailable';
export type Trend = 'Lowering' | 'Unstable' | 'Stable' | 'Raising' | 'Fluctuating' | 'Unavailable';
export type ProjectedState = 'unknown' | 'projected' | 'not-projected';

export interface TradeItemInput {
  assetId: string;
  name: string;
  thumbnailUrl?: string;
  quantity: number;
  side: TradeSide;
}

export interface LimitedQuote {
  assetId: string;
  name: string;
  acronym?: string;
  rap?: number;
  estimatedValue?: number;
  demand: Demand;
  trend: Trend;
  projected: ProjectedState;
  rare?: 'unknown' | 'rare' | 'not-rare';
  source: 'Rolimon’s public item catalog';
  fetchedAt: number;
  /** Supplied by the stored public row only; never inferred from retrieval. */
  observedAt?:number;
}

export interface PricedTradeItem extends TradeItemInput { quote?: LimitedQuote; usdQuote?: MetricObservation<number>; demandQuote?: MetricObservation<string>; }
export interface SideTotals {
  rap: number;
  rapCovered: number;
  estimatedValue: number;
  estimatedCovered: number;
  itemCount: number;
  missingEstimateCount: number;
}
export type TradeVerdict = 'favorable' | 'unfavorable' | 'approximately-even' | 'inconclusive';
export interface TradeAnalysis {
  give: SideTotals;
  receive: SideTotals;
  rapDifference?: number;
  rapPercent?: number;
  estimatedDifference?: number;
  estimatedPercent?: number;
  verdict: TradeVerdict;
  warnings: string[];
}
export interface TradeEvidence {
  componentsComplete: boolean;
  unclassifiedCount: number;
  unsupportedComponents: number;
}

export function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function safeAssetId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32 || !/^\d+$/.test(value)) return undefined;
  const id = value.replace(/^0+/, '');
  return id && (id.length < 16 || (id.length === 16 && id <= '9007199254740991')) ? id : undefined;
}

export function catalogAssetId(url: string, base = 'https://www.roblox.com'): string | undefined {
  if (url.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(url)) return undefined;
  try {
    const parsed = new URL(url, base);
    if (parsed.origin !== 'https://www.roblox.com' || parsed.username || parsed.password) return undefined;
    // Encoded IDs/separators and malformed escapes are not catalog identity.
    const decoded = decodeURIComponent(parsed.pathname);
    if (/[\\\u0000-\u001f]/.test(decoded) || /%2f|%5c/i.test(parsed.pathname)) return undefined;
    const match = /^\/catalog\/(\d+)(?:\/[^/]+)?\/?$/.exec(parsed.pathname);
    return safeAssetId(match?.[1]);
  } catch { return undefined; }
}

export function supportedTradeUrl(url: string): boolean {
  if (url.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return url.length <= 2048 && parsed.origin === 'https://www.roblox.com' && !parsed.username && !parsed.password && (parsed.pathname === '/trades' || parsed.pathname.startsWith('/trades/'));
  } catch { return false; }
}

export function normalizeItems<T extends TradeItemInput>(items: readonly T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const assetId = safeAssetId(item.assetId); const quantity = finiteNonNegative(item.quantity);
    // Scanner caps each actual card at MAX_QUANTITY. Already aggregated rows
    // may contain up to 100 cards and must retain their weighted coverage.
    if (!assetId || !quantity || quantity > 100_000 || typeof item.name !== 'string' || !item.name.trim() || !['give', 'receive'].includes(item.side)) continue;
    const key = `${item.side}:${assetId}`; const prior = merged.get(key);
    if (prior) { if (prior.quantity + quantity <= 100_000) prior.quantity += quantity; }
    else merged.set(key, { ...item, assetId, name: item.name.trim(), quantity });
  }
  return [...merged.values()];
}

function labelDemand(code: unknown): Demand {
  const label = typeof code === 'number' && Number.isInteger(code) ? demandLabel(code) : 'N/A';
  return label === 'N/A' ? 'Unavailable' : label as Demand;
}
function labelTrend(code: unknown): Trend {
  const label = typeof code === 'number' && Number.isInteger(code) ? trendLabel(code) : 'N/A';
  return label === 'N/A' ? 'Unavailable' : label as Trend;
}

/** Strict parser for Rolimon’s documented-in-app public item-details shape. */
export function parseRolimonsCatalog(payload: unknown, fetchedAt: number): Map<string, LimitedQuote> {
  const result = new Map<string, LimitedQuote>();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload as { success?: unknown }).success !== true || finiteNonNegative(fetchedAt) === undefined || fetchedAt <= 0) return result;
  const rows = (payload as { items?: unknown })?.items;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return result;
  // Reject oversized catalogs as a whole; never present a truncated catalog as complete.
  if (Object.keys(rows).length > CATALOG_LIMIT) return result;
  for (const [rawId, rawRow] of Object.entries(rows as Record<string, unknown>)) {
    if (!Array.isArray(rawRow) || rawRow.length < 7 || rawRow.length > 32 || typeof rawRow[0] !== 'string' || rawRow[0].length > 256) continue;
    const fields = rolimonsFields(rawRow);
    const assetId = safeAssetId(rawId); const name = (fields.name as string).trim();
    if (!assetId || !name) continue;
    // Canonical-key collisions are ambiguous, not a last-row-wins identity.
    if (result.has(assetId)) { result.delete(assetId); return new Map(); }
    const rap = finiteNonNegative(fields.rap); const estimatedValue = finiteNonNegative(fields.value);
    result.set(assetId, {
      assetId, name, ...(rap === undefined ? {} : { rap }), ...(estimatedValue === undefined || estimatedValue === 0 ? {} : { estimatedValue }),
      ...(typeof fields.acronym === 'string' && fields.acronym.trim() && fields.acronym.length <= 64 ? { acronym: fields.acronym.trim() } : {}),
      demand: labelDemand(fields.demand), trend: labelTrend(fields.trend),
      // Verified public catalog positions 7/9: 1 is flagged, -1 is not flagged.
      // Missing, boolean, zero and future codes remain unknown, never inferred.
      projected: fields.projected === 1 ? 'projected' : fields.projected === -1 ? 'not-projected' : 'unknown',
      ...(fields.rare === 1 ? { rare: 'rare' as const } : fields.rare === -1 ? { rare: 'not-rare' as const } : {}),
      source: QUOTE_SOURCE, fetchedAt,
    });
  }
  return result;
}

/** Bounded UTF-8 fixture/future transport contract, checked before JSON parsing. */
export function parseCatalogText(text: string, fetchedAt: number): Map<string, LimitedQuote> {
  if (text.length > CATALOG_MAX_BYTES || new TextEncoder().encode(text).byteLength > CATALOG_MAX_BYTES) throw new Error('Catalog response too large.');
  return parseRolimonsCatalog(JSON.parse(text), fetchedAt);
}

function blankTotals(items: readonly PricedTradeItem[]): SideTotals {
  const total: SideTotals = { rap: 0, rapCovered: 0, estimatedValue: 0, estimatedCovered: 0, itemCount: 0, missingEstimateCount: 0 };
  for (const item of items) {
    total.itemCount += item.quantity;
    const quote = item.quote?.assetId === item.assetId ? item.quote : undefined;
    // Stored native metrics retain provider precision. Item quantities stay
    // whole; decimal Value/RAP is independent from that quantity contract.
    const native = (amount: unknown): amount is number => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER;
    const rap = native(quote?.rap) ? quote.rap : undefined, value = native(quote?.estimatedValue) ? quote.estimatedValue : undefined;
    if (rap !== undefined && native(quantityWeightedSum(total.rap, rap, item.quantity))) { total.rap = quantityWeightedSum(total.rap, rap, item.quantity); total.rapCovered += item.quantity; }
    if (value !== undefined && native(quantityWeightedSum(total.estimatedValue, value, item.quantity))) { total.estimatedValue = quantityWeightedSum(total.estimatedValue, value, item.quantity); total.estimatedCovered += item.quantity; }
    else total.missingEstimateCount += item.quantity;
  }
  return total;
}

/** Never assigns a value verdict from partial estimates or RAP alone. */
export function analyzeTrade(items: readonly PricedTradeItem[], evidence?: TradeEvidence): TradeAnalysis {
  const normalized = normalizeItems(items);
  const give = blankTotals(normalized.filter((item) => item.side === 'give'));
  const receive = blankTotals(normalized.filter((item) => item.side === 'receive'));
  const warnings: string[] = [];
  const completeComponents = evidence?.componentsComplete === true && evidence.unclassifiedCount === 0 && evidence.unsupportedComponents === 0;
  if (!completeComponents) warnings.push('Incomplete comparison: Limited items only. Robux and other components are not fully verified; research required. No reliable verdict.');
  if (evidence?.unclassifiedCount) warnings.push(`${evidence.unclassifiedCount} unclassified item cards/links excluded from totals.`);
  warnings.push('Informational comparison; no automated trading decision.');
  if (!give.itemCount || !receive.itemCount) warnings.push('Both trade sides must be identified before an analysis is available.');
  if (give.rapCovered !== give.itemCount || receive.rapCovered !== receive.itemCount) warnings.push('RAP is unavailable for one or more items; RAP totals are partial.');
  const completeEstimate = give.itemCount > 0 && receive.itemCount > 0 && give.estimatedCovered === give.itemCount && receive.estimatedCovered === receive.itemCount;
  if (!completeEstimate) warnings.push('Value coverage is incomplete; no reliable verdict is shown.');
  const identified = !evidence?.unclassifiedCount;
  const rapDifference = identified && give.itemCount > 0 && receive.itemCount > 0 && give.rapCovered === give.itemCount && receive.rapCovered === receive.itemCount ? receive.rap - give.rap : undefined;
  const rap = rapDifference === undefined ? {} : { rapDifference, ...(give.rap > 0 ? { rapPercent: rapDifference / give.rap * 100 } : {}) };
  if (!identified || !completeEstimate) return { give, receive, ...rap, verdict: 'inconclusive', warnings };
  const estimatedDifference = receive.estimatedValue - give.estimatedValue;
  if (give.estimatedValue <= 0) return { give, receive, ...rap, estimatedDifference, verdict: 'inconclusive', warnings };
  const estimatedPercent = (estimatedDifference / give.estimatedValue) * 100;
  const verdict: TradeVerdict = !completeComponents ? 'inconclusive' : Math.abs(estimatedPercent) <= VALUE_EVEN_BAND_PCT ? 'approximately-even' : estimatedPercent > 0 ? 'favorable' : 'unfavorable';
  return { give, receive, ...rap, estimatedDifference, estimatedPercent, verdict, warnings };
}

export function formatRobux(value: number | undefined): string { return value === undefined ? 'Unavailable' : `R$ ${Math.round(value).toLocaleString('en-US')}`; }

export function formatCoverage(totals: SideTotals, field: 'rap' | 'estimatedValue'): string {
  const covered = field === 'rap' ? totals.rapCovered : totals.estimatedCovered;
  if (!covered) return `Unavailable · 0/${totals.itemCount} items`;
  return `${covered < totals.itemCount ? 'Known ' : ''}${formatRobux(totals[field])} · ${covered}/${totals.itemCount} items`;
}

/** Browser-only evidence projection. No ownership, accounting or quote store. */

export type MarketProvider = 'rolimons' | 'routility' | 'roblox-native';
export type MarketUnit = 'ROBLOX_RAP' | 'ROLIMONS_VALUE' | 'ROUTILITY_VALUE' | 'USD' | 'ITEM_DEMAND' | 'ITEM_TREND' | 'ROBUX_ASK';
export interface MetricObservation<T = number | string> {
  provider: MarketProvider;
  unit: MarketUnit;
  assetId: string;
  value?: T;
  /** Retrieval time is never substituted for a provider observation time. */
  retrievedAt: number;
  observedAt?: number;
  coverage: 'complete' | 'missing';
  freshness: 'fresh' | 'stale' | 'expired' | 'unknown';
  availability: 'available' | 'unavailable' | 'unsupported' | 'invalid';
  validation: 'validated' | 'invalid' | 'unsupported';
}

export function observation<T>(provider: MarketProvider, assetId: string, unit: MarketUnit, value: T | undefined, retrievedAt: number, now: number,
  availability: MetricObservation<T>['availability'] = value === undefined ? 'unavailable' : 'available'): MetricObservation<T> {
  const validTime = Number.isSafeInteger(retrievedAt) && retrievedAt > 0 && retrievedAt <= now;
  const age = validTime ? now - retrievedAt : Infinity;
  const validIdentity = safeAssetId(assetId) === assetId;
  const validValue = typeof value === 'number'
    ? Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && (['USD','ROLIMONS_VALUE','ROBLOX_RAP'].includes(unit) || Number.isSafeInteger(value))
    : typeof value === 'string' && !!value.trim() && value.length <= 64;
  if (availability === 'available' && !validValue) availability = 'invalid';
  if (!validIdentity || !validTime) availability = 'invalid';
  return { provider, unit, assetId, ...(availability === 'available' ? { value } : {}), retrievedAt,
    coverage: availability === 'available' ? 'complete' : 'missing',
    freshness: !validTime ? 'unknown' : age >= 24 * 60 * 60_000 ? 'expired' : age >= QUOTE_FRESH_MS ? 'stale' : 'fresh',
    availability, validation: availability === 'invalid' ? 'invalid' : availability === 'unsupported' ? 'unsupported' : 'validated' };
}

/** Existing worker quotes retain their Rolimon's identity, never native RAP. */
export function rolimonsMetricEvidence(quote: LimitedQuote, now = Date.now()) {
  const dated=(metric:MetricObservation<number>)=>Number.isSafeInteger(quote.observedAt)&&quote.observedAt!>0&&quote.observedAt!<=quote.fetchedAt?{...metric,observedAt:quote.observedAt}:metric;
  return {
    rap: dated(observation('rolimons', quote.assetId, 'ROBLOX_RAP', quote.rap, quote.fetchedAt, now)),
    value: dated(observation('rolimons', quote.assetId, 'ROLIMONS_VALUE', quote.estimatedValue, quote.fetchedAt, now)),
    demand: observation('rolimons', quote.assetId, 'ITEM_DEMAND', quote.demand === 'Unavailable' ? undefined : quote.demand, quote.fetchedAt, now),
    trend: observation('rolimons', quote.assetId, 'ITEM_TREND', quote.trend === 'Unavailable' ? undefined : quote.trend, quote.fetchedAt, now),
    usd: observation<number>('rolimons', quote.assetId, 'USD', undefined, quote.fetchedAt, now, 'unsupported'),
  };
}

/** Public desktop catalog schema. `usd` is Routility's item-level USD estimate,
 * cross-checked against its public catalog/21070012 USD Value display.
 * No exchange conversion, sale-price guarantee or fallback to Rolimon's.
 */

export const ROUTILITY_ENDPOINT = 'https://routility.io/api/public/items';
export interface RoutilityQuote {
  assetId: string;
  name?: string;
  provider: 'routility';
  retrievedAt: number;
  value: MetricObservation<number>;
  rap: MetricObservation<number>;
  bestPrice: MetricObservation<number>;
  demand: MetricObservation<string>;
  trend: MetricObservation<string>;
  usd: MetricObservation<number>;
  copies?: number;
  premiumCopies?: number;
  /** Public provider share only when explicitly marked hoarded; never a count. */
  hoardShare?: number;
  thumbnailUrl?: string;
}

/** Public image URL observed in Routility's thumb field; never an asset-ID URL guess. */
export function routilityThumbnailUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) return;
  try {
    const url = new URL(value);
    if (url.origin === 'https://tr.rbxcdn.com' && !url.username && !url.password && !url.search && !url.hash
      && /^\/(?:\d+DAY-)?[a-f0-9]{32}\/\d{1,4}\/\d{1,4}\/[A-Za-z]+\/(?:Png|Webp)\/noFilter$/.test(url.pathname)) return url.href;
  } catch { /* Unsupported image metadata is omitted independently. */ }
}

export function parseRoutilityCatalogText(text: string, retrievedAt: number): Map<string, RoutilityQuote> {
  if (text.length > CATALOG_MAX_BYTES || new TextEncoder().encode(text).byteLength > CATALOG_MAX_BYTES) throw new Error('Catalog response too large.');
  const payload: unknown = JSON.parse(text);
  const result = new Map<string, RoutilityQuote>();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload as { success?: unknown }).success === false || !Number.isSafeInteger(retrievedAt) || retrievedAt <= 0) return result;
  const rows = (payload as { items?: unknown }).items;
  if (!Array.isArray(rows) || rows.length > CATALOG_LIMIT) return result;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const raw = row as Record<string, unknown>;
    const id = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) && raw.id > 0 ? String(raw.id) : raw.id;
    const assetId = safeAssetId(id);
    if (!assetId || (typeof id === 'string' && assetId !== id)) continue;
    if (result.has(assetId)) return new Map();
    if (raw.name !== undefined && (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 256)) continue;
    const numeric = (key: string, unit: 'ROUTILITY_VALUE' | 'ROBLOX_RAP' | 'ROBUX_ASK') => {
      const amount = finiteNonNegative(raw[key]);
      return observation('routility', assetId, unit, amount, retrievedAt, retrievedAt,
        raw[key] === undefined || raw[key] === null ? 'unavailable' : amount === undefined ? 'invalid' : 'available');
    };
    const label = (key: string, unit: 'ITEM_DEMAND' | 'ITEM_TREND') => {
      const value = typeof raw[key] === 'string' && raw[key].trim() && (raw[key] as string).length <= 64 ? (raw[key] as string).trim() : undefined;
      // Verified public demand vocabulary matches these qualitative categories.
      // Numeric 1–5 normalization remains an explicit W8RLD display policy;
      // trend vocabulary is still unsupported here.
      const supported=unit==='ITEM_DEMAND'&&['Terrible','Low','Normal','High','Amazing'].includes(value??'');
      return observation('routility', assetId, unit, value, retrievedAt, retrievedAt, supported?'available':value===undefined?'unavailable':'unsupported');
    };
    const usd = typeof raw.usd === 'number' && Number.isFinite(raw.usd) && raw.usd >= 0 && raw.usd <= Number.MAX_SAFE_INTEGER ? raw.usd : undefined;
    result.set(assetId, { assetId, ...(raw.name ? { name: raw.name as string } : {}), provider: 'routility', retrievedAt,
      ...(routilityThumbnailUrl(raw.thumb) ? { thumbnailUrl: routilityThumbnailUrl(raw.thumb) } : {}),
      ...(finiteNonNegative(raw.copies) === undefined ? {} : { copies: raw.copies as number }),
      ...(finiteNonNegative(raw.premiumCopies) === undefined ? {} : { premiumCopies: raw.premiumCopies as number }),
      ...(raw.hoarded === true && typeof raw.hoardShare === 'number' && Number.isFinite(raw.hoardShare) && raw.hoardShare > 0 && raw.hoardShare <= 1 ? {hoardShare:raw.hoardShare} : {}),
      value: numeric('value', 'ROUTILITY_VALUE'), rap: numeric('rap', 'ROBLOX_RAP'), bestPrice: numeric('bestPrice', 'ROBUX_ASK'),
      demand: label('demand', 'ITEM_DEMAND'), trend: label('trend', 'ITEM_TREND'),
      usd: observation<number>('routility', assetId, 'USD', usd, retrievedAt, retrievedAt,
        raw.usd === undefined || raw.usd === null ? 'unavailable' : usd === undefined ? 'invalid' : 'available') });
  }
  return result;
}

/** Coverage projection over the existing market-neutral calculator, not a new
 * valuation model. Only independently sourced, current Routility USD is admitted.
 */
export function analyzeUsdTrade(items: readonly PricedTradeItem[], incomplete = false, now = Date.now()) {
  const normalized = normalizeItems(items);
  let covered = 0; let total = 0; let stale = false;
  const entries = (side: TradeSide) => normalized.filter(item => item.side === side).map(item => {
    total += item.quantity;
    const quote = item.usdQuote;
    const current = quote && quote.assetId === item.assetId && quote.provider === 'routility' && quote.unit === 'USD'
      && quote.availability === 'available' && quote.validation === 'validated'
      ? observation('routility', item.assetId, 'USD', quote.value, quote.retrievedAt, now) : undefined;
    if (current?.freshness === 'stale' || current?.freshness === 'expired') stale = true;
    const value = current?.availability === 'available' && current.freshness === 'fresh' ? current.value : undefined;
    if (value !== undefined) covered += item.quantity;
    return { name: item.name, quantity: item.quantity, ...(value === undefined ? {} : { metrics: [{ key: 'usd', label: 'USD', value }] }) };
  });
  const result = calculateTrade('roblox-limiteds', entries('give'), entries('receive'));
  const give = result.give.totals[0]?.value; const receive = result.get.totals[0]?.value;
  const complete = !incomplete && result.give.entries.length > 0 && result.get.entries.length > 0
    && covered === total && give !== undefined && receive !== undefined
    && Number.isFinite(give) && Number.isFinite(receive) && Math.max(give, receive) <= Number.MAX_SAFE_INTEGER;
  const difference = complete ? result.differences[0]?.value : undefined;
  return { covered, total, stale, give, receive, difference, percent: difference !== undefined && give! > 0 ? difference / give! * 100 : undefined };
}

export interface RolimonsItemObservation {
  item?: RolimonsItem;
  value: ValuationMetadata;
  rap: ValuationMetadata;
  refreshFailed: boolean;
}

/** Exact ID only. Expired data remains inspectable with explicit stale provenance. */
export interface RolimonsCacheSnapshot {
  items: readonly RolimonsItem[]; checkedAt: number; expiresAt: number; fixture: boolean;
}

/** Pure projection over the existing desktop cache; owns no retrieval or storage. */
export function projectRolimonsCacheObservation(assetId: string, itemsCache: RolimonsCacheSnapshot | null, refreshFailed: boolean, now: number): RolimonsItemObservation {
  const item = itemsCache?.items.find((row) => row.id === assetId);
  const checked = itemsCache?.checkedAt;
  const checkedAt = typeof checked === 'number' && Number.isFinite(checked) && checked >= 0 && checked <= now && Number.isFinite(new Date(checked).getTime()) ? new Date(checked).toISOString() : undefined;
  const metadata = (field: 'value' | 'rap'): ValuationMetadata => {
    const available = item !== undefined && Number.isFinite(item[field]) && item[field] >= 0;
    return {
      unit: { kind: 'non-monetary', code: field === 'value' ? 'ROLIMONS_VALUE' : 'ROBLOX_RAP' },
      category: 'provider-valuation', origin: itemsCache?.fixture ? 'fixture' : 'provider',
      availability: available ? 'available' : 'unavailable', source: 'Rolimons itemdetails',
      ...(itemsCache ? { ...(checkedAt ? { checkedAt } : {}), freshnessTtlMs: DESKTOP_ITEM_CACHE_MS, fixture: itemsCache.fixture } : {}),
      ...(checkedAt&&Number.isSafeInteger(item?.observedAt)&&item!.observedAt!>0&&item!.observedAt!<=checked!?{observedAt:new Date(item!.observedAt!).toISOString()}:{}),
      freshness: !available ? 'unavailable' : refreshFailed || itemsCache!.expiresAt <= now ? 'stale' : !checkedAt ? 'unknown' : 'cached',
      coverage: item ? 'partial' : 'unknown',
      note: refreshFailed ? 'Refresh failed; last successful retrieval retained. Source observation time is not supplied.'
        : !itemsCache ? 'Provider has not been loaded.' : !item ? 'Asset not present in the provider catalog.'
        : !available ? `Provider does not supply ${field === 'value' ? 'Rolimons Value' : 'RAP'} for this asset.` : 'Source observation time is not supplied.',
    };
  };
  return { item, value: metadata('value'), rap: metadata('rap'), refreshFailed };
}

