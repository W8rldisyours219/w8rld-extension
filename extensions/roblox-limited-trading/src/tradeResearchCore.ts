import { analyzeTrade, analyzeUsdTrade, MAX_QUANTITY, safeAssetId, type PricedTradeItem } from './core';
import { freshQuote, freshUsd } from './presentation';

export function calculatorInput(give: string, receive: string): PricedTradeItem[] | undefined {
  const result: PricedTradeItem[] = [];
  for (const [side, text] of [['give', give], ['receive', receive]] as const) {
    if (text.length > 500) return;
    const lines = text.trim().split(/[\n,]+/); if (lines.length > 8) return;
    for (const line of lines) {
      const match = /^\s*([1-9]\d{0,15})(?:\s*[x×]\s*([1-9]\d{0,3}))?\s*$/.exec(line);
      const id = match && safeAssetId(match[1]); const quantity = Number(match?.[2] ?? 1);
      if (!id || quantity > MAX_QUANTITY) return;
      result.push({ side, assetId: id, name: 'Limited item', quantity });
    }
  }
  return result;
}
export interface AnonymousComparison { time: number; metrics: { name: 'RAP' | 'Value' | '$'; give: number; receive: number }[]; }
export function anonymousComparison(items: PricedTradeItem[], now = Date.now()): AnonymousComparison | undefined {
  const a = analyzeTrade(items.map(i => ({ ...i, quote: freshQuote(i, now) }))); const usd = analyzeUsdTrade(items, false, now);
  const metrics: AnonymousComparison['metrics'] = [];
  if (a.rapDifference !== undefined) metrics.push({ name: 'RAP', give: a.give.rap, receive: a.receive.rap });
  if (a.estimatedDifference !== undefined) metrics.push({ name: 'Value', give: a.give.estimatedValue, receive: a.receive.estimatedValue });
  if (usd.difference !== undefined && usd.give !== undefined && usd.receive !== undefined) metrics.push({ name: '$', give: usd.give, receive: usd.receive });
  return metrics.length ? { time: now, metrics } : undefined;
}
export function validComparison(raw: unknown): raw is AnonymousComparison {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as AnonymousComparison;
  return Object.keys(r).every(k => ['time', 'metrics'].includes(k)) && Number.isSafeInteger(r.time) && r.time > 0 && r.time <= Date.now()
    && Array.isArray(r.metrics) && r.metrics.length > 0 && r.metrics.length <= 3 && new Set(r.metrics.map(m => m?.name)).size === r.metrics.length
    && r.metrics.every(m => m && Object.keys(m).length === 3 && Object.keys(m).every(k => ['name', 'give', 'receive'].includes(k)) && ['RAP', 'Value', '$'].includes(m.name)
      && [m.give, m.receive].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER));
}

/** Public asset identities and provider observations only. Never a trade/partner ID.
 * Historical values remain historical; loading requires an explicit fresh Compare. */
export interface SavedComparison extends AnonymousComparison {
  version: 2;
  items: {assetId: string; side: 'give' | 'receive'; quantity: number}[];
  observations: {assetId: string; rap?: number; value?: number; usd?: number; rolimonsAt?: number; routilityAt?: number}[];
}
export function comparisonIdentity(record: Pick<SavedComparison, 'items'>): string {
  return record.items.map(i => `${i.side}:${i.assetId}x${i.quantity}`).sort().join('|');
}
export function savedComparison(items: PricedTradeItem[], now = Date.now()): SavedComparison | undefined {
  const metrics = anonymousComparison(items, now); if (!metrics) return;
  const grouped = new Map<string, SavedComparison['items'][number]>();
  for (const i of items) {
    const key = `${i.side}:${i.assetId}`; const old = grouped.get(key);
    grouped.set(key, {assetId:i.assetId,side:i.side,quantity:(old?.quantity ?? 0)+i.quantity});
  }
  const record: SavedComparison = {...metrics,version:2,items:[...grouped.values()].sort((a,b)=>`${a.side}:${a.assetId}`.localeCompare(`${b.side}:${b.assetId}`)),observations:[]};
  for (const i of items) {
    if (record.observations.some(o=>o.assetId===i.assetId)) continue;
    const q = freshQuote(i, now); const usd = freshUsd(i);
    record.observations.push({assetId:i.assetId,...(q ? {rap:q.rap,value:q.estimatedValue,rolimonsAt:q.fetchedAt} : {}),...(usd !== undefined && i.usdQuote ? {usd,routilityAt:i.usdQuote.retrievedAt} : {})});
  }
  return validSavedComparison(record) ? record : undefined;
}
export function validSavedComparison(raw: unknown): raw is SavedComparison {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as SavedComparison;
  if (Object.keys(r).some(k=>!['version','time','metrics','items','observations'].includes(k)) || r.version!==2 || !validComparison({time:r.time,metrics:r.metrics})
    || !Array.isArray(r.items) || r.items.length<2 || r.items.length>16 || !Array.isArray(r.observations) || r.observations.length>16) return false;
  if (!r.items.every(i=>i && Object.keys(i).length===3 && Object.keys(i).every(k=>['assetId','side','quantity'].includes(k)) && safeAssetId(i.assetId)===i.assetId
    && ['give','receive'].includes(i.side) && Number.isSafeInteger(i.quantity) && i.quantity>0 && i.quantity<=MAX_QUANTITY)
    || new Set(r.items.map(i=>`${i.side}:${i.assetId}`)).size!==r.items.length || !['give','receive'].every(s=>r.items.some(i=>i.side===s))) return false;
  const ids = new Set(r.items.map(i=>i.assetId));
  return r.observations.length===ids.size && new Set(r.observations.map(o=>o?.assetId)).size===ids.size && r.observations.every(o=>o && ids.has(o.assetId)
    && Object.keys(o).every(k=>['assetId','rap','value','usd','rolimonsAt','routilityAt'].includes(k))
    && [o.rap,o.value,o.usd].every(n=>n===undefined || typeof n==='number' && Number.isFinite(n) && n>=0 && n<=Number.MAX_SAFE_INTEGER)
    && [o.rolimonsAt,o.routilityAt].every(t=>t===undefined || Number.isSafeInteger(t) && t>0 && t<=r.time)
    && ((o.rap===undefined && o.value===undefined) || o.rolimonsAt!==undefined) && (o.usd===undefined || o.routilityAt!==undefined));
}
export function valueWarning(items: PricedTradeItem[], incomplete: boolean, threshold: number): string | undefined {
  if (incomplete) return;
  const a = analyzeTrade(items.map(i => ({ ...i, quote: freshQuote(i) })));
  if (a.estimatedPercent === undefined || a.estimatedPercent >= 0 || -a.estimatedPercent < threshold) return;
  return `Giving Value exceeds Receiving by ${(-a.estimatedPercent).toLocaleString('en-US', { maximumFractionDigits: 1 })}% of Giving. Limited items only; review every component.`;
}

