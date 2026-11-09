/** Exact classic Limited copies, kept only in the native trade document.
 * Legacy trade detail and complete collectibles inventories are the evidence.
 * Catalog ownership, serials, counts and tradability cannot prove copy absence. */
import {safeAssetId, type TradeItemInput} from './core';

export const OWNERSHIP_FRESH_MS = 30_000;
export type CopyState = 'owned' | 'missing' | 'unverified';
export type TradeCopy = TradeItemInput & {userAssetId: string; ownerId: string};
export type CopyObservation = {copies: TradeCopy[]; states: CopyState[]; checkedAt: number};
export const copyIdentifier = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  return /^[1-9]\d{0,19}$/.test(text) ? text : undefined;
};
export function pendingCopies(raw: any, tradeId: string, mine: string, theirs: string, expected: readonly TradeItemInput[]): TradeCopy[] | undefined {
  if (copyIdentifier(raw?.id) !== tradeId || raw?.isActive !== true || !['Open','Pending'].includes(raw?.status)
    || !Array.isArray(raw.offers) || raw.offers.length !== 2 || mine === theirs) return;
  const copies: TradeCopy[] = [];
  for (const [side,ownerId] of [['give',mine],['receive',theirs]] as const) {
    const offers = raw.offers.filter((offer: any) => copyIdentifier(offer?.user?.id) === ownerId);
    if (offers.length !== 1 || !Array.isArray(offers[0].userAssets) || offers[0].userAssets.length > 8) return;
    for (const item of offers[0].userAssets) {
      const assetId = safeAssetId(copyIdentifier(item?.assetId)); const userAssetId = copyIdentifier(item?.id);
      if (!assetId || !userAssetId || typeof item?.name !== 'string' || !item.name.trim() || item.name.length > 256
        || copies.some(copy => copy.userAssetId === userAssetId)) return;
      copies.push({side,assetId,userAssetId,ownerId,name:item.name,quantity:1});
    }
  }
  // This is the same identified trade on both API versions. Require the full
  // side/asset multiset, including duplicate quantities, before displaying it.
  const keys = (items: readonly TradeItemInput[]) => items.flatMap(i => Array.from({length:i.quantity},()=>i.side+':'+i.assetId)).sort().join('|');
  return copies.length && keys(copies) === keys(expected) ? copies : undefined;
}
export function inventoryCopies(raw: any): {copies: Map<string,string>; cursor?: string} | undefined {
  if (!Array.isArray(raw?.data) || raw.data.length > 100) return;
  const cursor = raw.nextPageCursor == null || raw.nextPageCursor === '' ? undefined : raw.nextPageCursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(cursor))) return;
  const copies = new Map<string,string>();
  for (const item of raw.data) {
    const id = copyIdentifier(item?.userAssetId); const asset = safeAssetId(copyIdentifier(item?.assetId));
    if (!id || !asset || copies.has(id)) return;
    copies.set(id,asset);
  }
  return {copies,cursor};
}
export function copyState(observation: CopyObservation | undefined, index: number, now = Date.now()): CopyState {
  return observation && observation.checkedAt <= now && now-observation.checkedAt < OWNERSHIP_FRESH_MS
    ? observation.states[index] ?? 'unverified' : 'unverified';
}
export function ownershipLabel(state: CopyState): string {
  return state === 'missing' ? 'No longer owned' : state === 'owned' ? 'Ownership confirmed' : 'Ownership unverified';
}

/** No private copy/owner identifiers enter the DOM, exports, storage or bridge. */
export function ownershipView(observation?: CopyObservation, privacy = false, now = Date.now()): HTMLElement {
  const node = document.createElement('div'); node.className = 'w8rld-copy-ownership';
  node.setAttribute('aria-label','Exact Limited copy ownership'); node.setAttribute('role','status');
  const title = document.createElement('strong'); title.textContent = 'Exact copy ownership'; node.append(title);
  if (!observation?.copies.length) {
    const unavailable = document.createElement('small'); unavailable.textContent = 'Ownership unverified'; node.append(unavailable);
  } else for (const side of ['give','receive'] as const) {
    const list = document.createElement('ul'); list.setAttribute('aria-label',side === 'give' ? 'Giving ownership' : 'Receiving ownership');
    const heading = document.createElement('small'); heading.textContent = side === 'give' ? 'Give' : 'Receive'; node.append(heading,list);
    for (const [index,copy] of observation.copies.entries()) if(copy.side === side) {
      const row = document.createElement('li'); const state = copyState(observation,index,now); row.dataset.ownership = state;
      row.textContent = `${privacy ? 'Limited item' : copy.name} · Copy ${observation.copies.slice(0,index+1).filter(c=>c.side===side&&c.assetId===copy.assetId).length}: ${ownershipLabel(state)}`;
      list.append(row);
    }
  }
  const source = document.createElement('small'); source.textContent = 'Roblox trade copies + complete inventory · rechecked while this trade is open. Unmapped, private, incomplete or stale evidence stays unverified.';
  node.append(source); return node;
}
