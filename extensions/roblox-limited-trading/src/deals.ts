/** Read-only catalog asks. One identity per asset; never a seller/order promise. */
import { QUOTE_FRESH_MS, type LimitedQuote } from './core';
import type { RoutilityQuote } from './providers/routility';
export interface DealFilters { maxPrice: number; minDiscount: number; basis: 'value' | 'rap'; sort: 'price' | 'discount' | 'reference'; projection: 'all' | 'exclude-known' | 'known-clear'; offset: number; }
export interface Deal { assetId: string; name: string; price: number; priceAt: number; referenceAt?: number; value?: number; rap?: number; discount?: number; projected: LimitedQuote['projected']; thumbnailUrl?: string; fresh: boolean; }
export function validDealFilters(f: DealFilters): boolean {
  return !!f && Object.keys(f).length === 6 && Number.isSafeInteger(f.maxPrice) && f.maxPrice > 0 && f.maxPrice <= Number.MAX_SAFE_INTEGER
    && Number.isFinite(f.minDiscount) && f.minDiscount >= 0 && f.minDiscount <= 100 && ['value','rap'].includes(f.basis)
    && ['price','discount','reference'].includes(f.sort) && ['all','exclude-known','known-clear'].includes(f.projection)
    && Number.isSafeInteger(f.offset) && f.offset >= 0 && f.offset <= 15000;
}
const fresh = (at: number, now: number) => Number.isSafeInteger(at) && at > 0 && at <= now && now - at < QUOTE_FRESH_MS;
export function selectDeals(asks: RoutilityQuote[], references: LimitedQuote[], f: DealFilters, now = Date.now()) {
  const refs = new Map(references.map(q => [q.assetId, q])); const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const q of asks) { if (seen.has(q.assetId)) duplicates.add(q.assetId); seen.add(q.assetId); }
  const rows: Deal[] = [];
  if (!validDealFilters(f)) return { rows, total: 0, more: false };
  for (const q of asks) {
    const ref = refs.get(q.assetId), price = q.bestPrice.value;
    // Only independently recognized Limited identities; invalid, zero/off-sale and duplicate asks are refused.
    if (duplicates.has(q.assetId) || !ref || q.bestPrice.availability !== 'available' || !Number.isSafeInteger(price) || price! <= 0 || price! > f.maxPrice) continue;
    const projected = fresh(ref.fetchedAt, now) ? ref.projected : 'unknown';
    if (f.projection === 'exclude-known' && projected === 'projected' || f.projection === 'known-clear' && projected !== 'not-projected') continue;
    const basis = f.basis === 'value' ? ref.estimatedValue : ref.rap;
    const discount = fresh(q.retrievedAt, now) && fresh(ref.fetchedAt, now) && basis !== undefined && basis > 0 ? (basis - price!) / basis * 100 : undefined;
    if (discount!==undefined && discount<f.minDiscount || (f.minDiscount > 0 || f.sort === 'discount') && discount===undefined) continue;
    if (f.sort === 'reference' && basis === undefined) continue;
    rows.push({ assetId: q.assetId, name: ref.name, price: price!, priceAt: q.retrievedAt, referenceAt: ref.fetchedAt, value: ref.estimatedValue, rap: ref.rap, discount, projected, thumbnailUrl: q.thumbnailUrl, fresh: fresh(q.retrievedAt,now) && fresh(ref.fetchedAt,now) });
  }
  rows.sort((a,b) => (f.sort === 'price' ? a.price-b.price : f.sort === 'discount' ? b.discount!-a.discount! : (f.basis==='value'?b.value!-a.value!:b.rap!-a.rap!)) || Number(a.assetId)-Number(b.assetId));
  return { rows: rows.slice(f.offset, f.offset + 40), total: rows.length, more: f.offset + 40 < rows.length };
}
