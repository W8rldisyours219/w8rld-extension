/** Display estimates are separate from provider quotes and saved observations.
 * Owner-defined conversion: USD = RAP / 1000 * dollars per 1000 Robux.
 * Never synthesize a Routility quote or mix valuation methods in a difference.
 */
import { analyzeUsdTrade, QUOTE_FRESH_MS, type PricedTradeItem } from './core';
import type { Preferences } from './preferences';
type UsdPreferences = Pick<Preferences, 'usdFallback' | 'usdPerThousandRobux'>;
export function freshUsd(item: PricedTradeItem): number | undefined {
  const u = item.usdQuote;
  return u?.assetId === item.assetId && u.provider === 'routility' && u.unit === 'USD' && u.availability === 'available'
    && u.validation === 'validated' && u.freshness === 'fresh' && u.retrievedAt <= Date.now() && Date.now() - u.retrievedAt < QUOTE_FRESH_MS ? u.value : undefined;
}
export function displayUsd(item: PricedTradeItem, preferences?: UsdPreferences): { value?: number; method: 'routility' | 'rap-estimate' | 'unavailable' } {
  const observed = freshUsd(item);
  if (observed !== undefined) return { value: observed, method: 'routility' };
  const q = item.quote; const rate = preferences?.usdPerThousandRobux;
  if (preferences?.usdFallback === 'rap' && rate && Number.isFinite(rate) && rate > 0 && rate <= 1e6
    && q?.assetId === item.assetId && q.fetchedAt <= Date.now() && Date.now() - q.fetchedAt < QUOTE_FRESH_MS
    && q.rap !== undefined && Number.isFinite(q.rap) && q.rap >= 0) {
    const value = q.rap / 1000 * rate;
    if (Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER) return { value, method: 'rap-estimate' };
  }
  return { method: 'unavailable' };
}
export function displayUsdTrade(items: readonly PricedTradeItem[], incomplete: boolean, preferences?: UsdPreferences) {
  const observed = analyzeUsdTrade(items, incomplete);
  if (preferences?.usdFallback !== 'rap' || observed.covered === observed.total && observed.total > 0) return { ...observed, method: 'routility' as const };
  const rows = items.map(item => ({ item, ...displayUsd(item, preferences) }));
  const methods = new Set(rows.filter(r => r.value !== undefined).map(r => r.method));
  // Existing provider values always win. A comparison with mixed methods has
  // no USD totals/difference; the individual item estimates remain available.
  const common = methods.size === 1 && methods.has('rap-estimate');
  const covered = rows.reduce((n, r) => n + (r.value === undefined ? 0 : r.item.quantity), 0);
  const total = items.reduce((n, i) => n + i.quantity, 0);
  const side = (side: 'give' | 'receive') => {
    const selected = rows.filter(r => r.item.side === side);
    if (!common || incomplete || !selected.length || selected.some(r => r.value === undefined)) return;
    const value = selected.reduce((n, r) => n + r.value! * r.item.quantity, 0);
    return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
  };
  const give = side('give'); const receive = side('receive');
  const difference = give === undefined || receive === undefined ? undefined : receive - give;
  return { give, receive, difference, percent: difference === undefined || !give ? undefined : difference / give * 100,
    covered, total, stale: false, method: common ? 'rap-estimate' as const : methods.size > 1 ? 'mixed' as const : 'unavailable' as const };
}
export const usdDescription = (method: string, rate?: number) => method === 'rap-estimate'
  ? `RAP conversion estimate: RAP ÷ 1,000 × ${rate} USD. Not a market price.`
  : method === 'mixed' ? 'Mixed USD methods; no comparable difference. Provider estimates retained on items.'
  : 'Routility USD estimate; not guaranteed sale proceeds.';

/** A portfolio may show an explicitly partial subtotal. Trade comparisons still
 * require full same-method coverage through displayUsdTrade above. */
export function visibleUsdSubtotal(items: readonly PricedTradeItem[], preferences?: UsdPreferences) {
  const rows = items.map(item=>({item,...displayUsd(item,preferences)}));
  const methods = new Set(rows.filter(r=>r.value!==undefined).map(r=>r.method));
  const covered = rows.reduce((sum,r)=>sum+(r.value===undefined?0:r.item.quantity),0);
  const total = items.reduce((sum,i)=>sum+i.quantity,0);
  const amount = rows.reduce((sum,r)=>sum+(r.value??0)*r.item.quantity,0);
  return {value:covered>0 && methods.size===1 && Number.isFinite(amount) && amount<=Number.MAX_SAFE_INTEGER ? amount : undefined,covered,total,
    method:methods.size>1?'mixed':methods.has('routility')?'routility':methods.has('rap-estimate')?'rap-estimate':'unavailable'};
}
