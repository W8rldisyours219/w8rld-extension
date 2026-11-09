/** Pure as-of valuation. No transport, current-price fallback or inferred dates. */
import { quantityWeightedSum } from './calculatorCore';
export interface HistoricalObservation { assetId: string; at: number; source: string; value?: number | null; rap?: number | null; }
export interface HistoricalItem { assetId: string; name: string; quantity: number; side: 'give' | 'receive'; }
const validAmount = (amount: unknown): amount is number => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER;
export const historicalPolicy = 'UTC end of selected day (23:59:59.999); latest recorded observation at or before cutoff, independently per metric. No current fallback. Difference = Receiving − Giving; percentage basis = Giving.';
export function historicalCutoff(date: string, now = Date.now()): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const start = Date.parse(date + 'T00:00:00.000Z');
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date || date > new Date(now).toISOString().slice(0, 10)) return;
  // Today means as of now, never the future portion of this UTC day.
  return Math.min(start + 86400000 - 1, now);
}
export function validHistoricalObservation(o: HistoricalObservation, now = Date.now()): boolean {
  return !!o && /^[1-9]\d{0,15}$/.test(o.assetId) && Number(o.assetId) <= Number.MAX_SAFE_INTEGER
    && Number.isSafeInteger(o.at) && o.at > 0 && o.at <= now && typeof o.source === 'string' && o.source.length > 0 && o.source.length <= 160
    && [o.value, o.rap].every(n => n === undefined || n === null || validAmount(n))
    && (o.value !== undefined || o.rap !== undefined);
}
export function historicalTrade(items: HistoricalItem[], observations: HistoricalObservation[], cutoff: number, now = Date.now()) {
  const valid = Number.isSafeInteger(cutoff) && cutoff > 0 && cutoff <= now;
  const rows = items.map(item => {
    const matches = valid ? observations.filter(o => o.assetId === item.assetId && validHistoricalObservation(o, now) && o.at <= cutoff) : [];
    const metric = (key: 'value' | 'rap') => {
      const sorted = matches.filter(o => o[key] !== undefined).sort((a,b) => b.at - a.at);
      const first = sorted[0];
      // Conflicting observations at an identical effective time are ambiguous.
      if (!first || first[key]===null || sorted.some(o => o.at === first.at && o[key] !== first[key])) return;
      return { amount: first[key]!, at: first.at, source: first.source };
    };
    return { ...item, value: metric('value'), rap: metric('rap') };
  });
  const metrics = (['value', 'rap'] as const).map(key => {
    const side = (name: 'give' | 'receive') => {
      const selected = rows.filter(r => r.side === name); let total = 0, covered = 0, copies = 0;
      for (const row of selected) {
        if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 1000) return { total: 0, covered: 0, copies: 0, complete: false };
        copies += row.quantity;
        if (row[key]) { total = quantityWeightedSum(total, row[key]!.amount, row.quantity); covered += row.quantity; }
      }
      return { total, covered, copies, complete: selected.length > 0 && copies === covered && validAmount(total) };
    };
    const give = side('give'), receive = side('receive');
    const difference = valid && give.complete && receive.complete ? receive.total - give.total : undefined;
    return { key, give, receive, difference, percent: difference !== undefined && give.total > 0 ? difference / give.total * 100 : undefined };
  });
  return { valid, cutoff, rows, metrics };
}
