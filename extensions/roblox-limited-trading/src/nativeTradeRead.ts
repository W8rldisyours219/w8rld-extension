/*!
 * Read-only trade discovery adapted from RoUtility (MIT).
 * Copyright (c) 2026 RoUtility
 * insane/routility-extension@403c75ed81f297e82ada6fccf084ae3fc2249def
 * src/features/trading/trades.js: ensureList (cursor paging), rawDetail, pump.
 * W8RLD: loaded native rows only, exact GET endpoints, no persisted private data,
 * no worker bridge, bounded requests, strict row/participant identity.
 * Full license: ../THIRD_PARTY_NOTICES.txt.
 */
import {safeAssetId, type TradeItemInput} from './core';
import {pendingCopies, inventoryCopies, type CopyObservation, type CopyState} from './tradeOwnership';

type Context = {url: string; userId: string | undefined};
type Entry = {id: string; partner: string; created: number};
const MAX_ROWS = 500;
const cursorOf = (raw: any): string | undefined | false => raw?.nextPageCursor == null || raw.nextPageCursor === '' ? undefined
  : typeof raw.nextPageCursor === 'string' && /^[\x21-\x7e]{1,512}$/.test(raw.nextPageCursor) ? raw.nextPageCursor : false;
export type ReadTrade = {items: TradeItemInput[]; incomplete: boolean; created: number; tradeId: string; mine: string; theirs: string};
const identifier = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v : Number.isSafeInteger(v) ? String(v) : '';
  return /^[1-9]\d{0,19}$/.test(s) ? s : undefined;
};
export function tradeReadContext(context: Context): {tab: string; userId: string} | undefined {
  try {
    const url = new URL(context.url);
    const tab = url.searchParams.get('tab') ?? 'Inbound';
    if (url.origin !== 'https://www.roblox.com' || !/^\/trades\/?$/.test(url.pathname)
      || url.username || url.password || !['Inbound','Outbound','Completed','Inactive'].includes(tab)
      || !identifier(context.userId)) return;
    return {tab, userId: context.userId!};
  } catch { return; }
}
export function parseTradeList(raw: any): Entry[] | undefined {
  if (!Array.isArray(raw?.data) || raw.data.length > 100 || cursorOf(raw) === false) return;
  const entries: Entry[] = [];
  for (const t of raw.data) {
    const id = identifier(t?.id); const partner = identifier(t?.user?.id); const created = Date.parse(t?.created);
    if (!id || !partner || !Number.isFinite(created) || created <= 0 || created > Date.now()+60_000 || entries.some(e => e.id === id)) return;
    entries.push({id, partner, created});
  }
  return entries;
}
export function parseReadTrade(raw: any, entry: Entry, userId: string): ReadTrade | undefined {
  if (identifier(raw?.tradeId) !== entry.id) return;
  const offers = [raw?.participantAOffer,raw?.participantBOffer];
  const mine = offers.filter(o => identifier(o?.user?.id) === userId);
  const theirs = offers.filter(o => identifier(o?.user?.id) === entry.partner);
  if (mine.length !== 1 || theirs.length !== 1 || mine[0] === theirs[0]) return;
  const items: TradeItemInput[] = []; let incomplete = false;
  for (const [index, offer] of [mine[0],theirs[0]].entries()) {
    if (!Array.isArray(offer.items) || offer.items.length > 8 || !Number.isSafeInteger(offer.robux) || offer.robux < 0) return;
    incomplete ||= offer.robux > 0; // Limited-only totals must never imply coverage of Robux.
    for (const item of offer.items) {
      // Roblox returns numeric targetId values; the public catalog contract
      // deliberately accepts canonical strings only. Normalize at this boundary.
      const assetId = item?.itemTarget?.itemType === 'Asset' && safeAssetId(identifier(item.itemTarget.targetId));
      if (!assetId || typeof item.itemName !== 'string' || !item.itemName.trim() || item.itemName.length > 256) return;
      items.push({side:index === 0 ? 'give' : 'receive',assetId,name:item.itemName,quantity:1});
    }
  }
  return items.length ? {items,incomplete,created:entry.created,tradeId:entry.id,mine:userId,theirs:entry.partner} : undefined;
}

// Current native .trade-sent-date uses an en-US calendar date in the browser's
// local timezone (guarded Completed page, EXT.6.5). Never parse ambiguous dates
// or turn a day label into a fabricated timestamp/age.
const nativeDate = (created: number) => new Date(created).toLocaleDateString('en-US');

/** Match the whole native ordered prefix, never a display name or nearby row.
 * Repeated partners need independent native time/date evidence. Calendar dates
 * require the complete bounded API list, so an unseen page cannot hide a tie. */
export function matchTradeRow(entries: Entry[], partners: (string | undefined)[], index: number, timestamps?: (number | undefined)[], dates?: (string | undefined)[], complete = false): Entry | undefined {
  if (index < 0 || index >= partners.length || partners.length > entries.length || partners.length > MAX_ROWS
    || partners.some((id,i) => !id || id !== entries[i].partner)) return;
  const entry = entries[index];
  // Independent native evidence must never contradict the ordered API prefix,
  // including a partner that occurs only once among currently visible rows.
  if (partners.some((_,i) => timestamps?.[i] !== undefined && timestamps[i] !== entries[i].created
    || dates?.[i] !== undefined && dates[i] !== nativeDate(entries[i].created))) return;
  const timestamp = timestamps?.[index];
  if (timestamp !== undefined && timestamp !== entry.created) return;
  if (entries.filter(e => e.partner === entry.partner).length === 1) return entry;
  // A repeated partner needs a unique exact native timestamp as a second
  // independent key. The returned API trade ID still owns the detail/cache.
  if (timestamps?.length === partners.length && timestamp === entry.created
    && entries.filter(e => e.partner === entry.partner && e.created === timestamp).length === 1) return entry;
  return complete && dates?.length === partners.length
    && partners.every((_,i) => dates[i] === nativeDate(entries[i].created))
    && entries.filter(e => e.partner === entry.partner && nativeDate(e.created) === dates[index]).length === 1 ? entry : undefined;
}

export function createNativeTradeReader(context: () => Context, fetcher: typeof fetch = fetch) {
  let epoch = 0; let list: {entries: Entry[]; at: number; tab: string; cursor?: string; cursors: Set<string>} | undefined;
  let active = false; let cooldown = 0; let windowAt = 0; let requests = 0;
  let binding: string | undefined;
  const controllers = new Set<AbortController>();
  const details = new Map<string,{at:number; value:ReadTrade}>();
  const counts = {requests:0,cacheHits:0,failures:0};
  function cancel() {epoch++;for(const c of controllers)c.abort();controllers.clear();active=false;}
  function reset() {cancel();list=undefined;details.clear();binding=undefined;}
  const fail = () => { counts.failures++; cooldown = Math.max(cooldown, Date.now()+60_000); };
  async function read(kind: 'list' | 'detail' | 'legacy' | 'inventory', value: string, cursor?: string): Promise<any> {
    const current = tradeReadContext(context());
    if (!current || Date.now() < cooldown || kind === 'list' && value !== current.tab
      || kind === 'detail' && !list?.entries.some(e => e.id === value)
      || kind === 'legacy' && (!['Inbound','Outbound'].includes(current.tab) || !details.has(value))
      || kind === 'inventory' && (!['Inbound','Outbound'].includes(current.tab)
        || ![...details.values()].some(d => d.value.mine === value || d.value.theirs === value))) return;
    if (Date.now() - windowAt >= 60_000) {windowAt = Date.now();requests = 0;}
    if (requests >= 60) return;
    requests++;counts.requests++;
    const controller = new AbortController();controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true;controller.abort();},8000);
    // No caller URL, headers, body or method can enter this capability.
    const url = kind === 'list'
      ? `https://trades.roblox.com/v1/trades/${current.tab}?sortOrder=Desc&limit=100${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`
      : kind === 'legacy' ? `https://trades.roblox.com/v1/trades/${value}`
      : kind === 'inventory' ? `https://inventory.roblox.com/v1/users/${value}/assets/collectibles?sortOrder=Asc&limit=100${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`
      : `https://trades.roblox.com/v2/trades/${value}`;
    try {
      const response = await fetcher(url,{method:'GET',credentials:'include',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      if (!response.ok) {
        counts.failures++;
        const header = response.headers.get('Retry-After'); const seconds = Number(header);
        const retry = seconds > 0 && Number.isFinite(seconds) ? seconds*1000 : header ? Date.parse(header)-Date.now() : 0;
        cooldown = Math.max(cooldown, Date.now()+Math.max(60_000,Number.isFinite(retry) ? retry : 0));
        return;
      }
      if (!response.headers.get('content-type')?.includes('application/json') || !response.body) { fail(); return; }
      const reader = response.body.getReader(); const decoder = new TextDecoder();let text = '';let bytes = 0;
      while (true) {const part = await reader.read();if(part.done)break;bytes += part.value.byteLength;if(bytes > 256*1024){controller.abort();fail();return;}text += decoder.decode(part.value,{stream:true});}
      text += decoder.decode();
      return JSON.parse(text.replace(/"(id|tradeId|userAssetId|assetId)"\s*:\s*(\d{15,})/g,'"$1":"$2"'));
    } catch {if(!controller.signal.aborted || timedOut)fail();return;}
    finally {clearTimeout(timer);controllers.delete(controller);}
  }
  return {
    async load(partners: (string | undefined)[], index: number, timestamps?: (number | undefined)[], dates?: (string | undefined)[]): Promise<ReadTrade | undefined> {
      const startUrl = context().url; const current = tradeReadContext(context());
      const nextBinding = current ? current.userId+'\0'+startUrl : undefined;
      if (binding !== nextBinding) {reset();binding=nextBinding;}
      const start = epoch;
      if (!current || active || Date.now() < cooldown || !partners.length || partners.length > MAX_ROWS || index < 0 || index >= partners.length) return;
      active = true;
      try {
        if (!list || list.tab !== current.tab || Date.now()-list.at >= 60_000) {
          list = undefined;
        }
        // Adapt ensureList's lazy cursor walk, bounded to the currently loaded
        // native prefix. Never crawl unshown history or accept a caller cursor.
        while (!list || list.entries.length < partners.length && list.cursor) {
          const page = await read('list',current.tab,list?.cursor);
          if (start !== epoch || context().url !== startUrl || tradeReadContext(context())?.userId !== current.userId) return;
          const entries = parseTradeList(page); const cursor = cursorOf(page);
          if (!entries || cursor === false || list && entries.some(e => list!.entries.some(old => old.id === e.id))
            || cursor && list?.cursors.has(cursor) || list && list.entries.length+entries.length > MAX_ROWS
            || cursor && !entries.length) { if (page !== undefined) fail(); list = undefined; return; }
          const cursors: Set<string> = list?.cursors ?? new Set(); if (cursor) cursors.add(cursor);
          list = {entries:[...(list?.entries ?? []),...entries],at:list?.at ?? Date.now(),tab:current.tab,cursor,cursors};
          if (!cursor) break;
        }
        if (!list) return;
        const entry = matchTradeRow(list.entries,partners,index,timestamps,dates,!list.cursor);if (!entry) return;
        const cached = details.get(entry.id);
        if (cached && Date.now()-cached.at < 60_000) {counts.cacheHits++;return cached.value;}
        const raw = await read('detail',entry.id);
        if (start !== epoch || context().url !== startUrl || tradeReadContext(context())?.userId !== current.userId) return;
        const result = parseReadTrade(raw,entry,current.userId);
        if (result) {for(const [id,cached] of details)if(Date.now()-cached.at >= 60_000)details.delete(id);details.delete(entry.id);details.set(entry.id,{at:Date.now(),value:result});if(details.size > 40)details.delete(details.keys().next().value!);}
        else if (raw !== undefined) fail();
        return result;
      } finally {if(start === epoch)active = false;}
    },
    async ownership(detail: ReadTrade): Promise<CopyObservation | undefined> {
      const startUrl = context().url; const current = tradeReadContext(context()); const start = epoch;
      // Only a detail admitted by the exact native row reader can confer this
      // capability. No caller URL, arbitrary user ID or completed-history crawl.
      if (!current || !['Inbound','Outbound'].includes(current.tab) || current.userId !== detail.mine
        || details.get(detail.tradeId)?.value !== detail) return;
      const valid = () => start === epoch && context().url === startUrl && tradeReadContext(context())?.userId === detail.mine;
      const started = Date.now(); const raw = await read('legacy',detail.tradeId);
      if (!valid()) return;
      const copies = pendingCopies(raw,detail.tradeId,detail.mine,detail.theirs,detail.items);
      if (!copies) return;
      const states: CopyState[] = copies.map(()=> 'unverified');
      for (const ownerId of [detail.mine,detail.theirs]) {
        const inventory = new Map<string,string>(); const cursors = new Set<string>(); let cursor: string | undefined;
        let complete = false; let coherent = true;
        // Cap each inventory to five pages. A larger/private/truncated inventory
        // cannot supply negative ownership evidence, even for an unseen copy.
        for (let page=0;page<5;page++) {
          const raw = await read('inventory',ownerId,cursor); if(!valid())return;
          const parsed = inventoryCopies(raw); if(!parsed){coherent=false;break;}
          if ([...parsed.copies].some(([id])=>inventory.has(id)) || parsed.cursor && cursors.has(parsed.cursor)
            || parsed.cursor && !parsed.copies.size) {coherent=false;break;}
          for(const [id,asset]of parsed.copies)inventory.set(id,asset);
          cursor=parsed.cursor;if(!cursor){complete=true;break;}cursors.add(cursor);
        }
        if(copies.some(copy=>copy.ownerId===ownerId&&inventory.has(copy.userAssetId)&&inventory.get(copy.userAssetId)!==copy.assetId))coherent=false;
        for(const [index,copy]of copies.entries())if(copy.ownerId===ownerId && coherent && complete) {
          const asset=inventory.get(copy.userAssetId);
          states[index]=asset===copy.assetId?'owned':asset===undefined&&complete?'missing':'unverified';
        }
      }
      // Age starts before the first response. A slow multi-page result cannot
      // present a fresh-looking confirmation by stamping only its finish time.
      return valid() ? {copies,states,checkedAt:started} : undefined;
    },
    reset, cancel,
    retryAt: () => Math.max(cooldown, requests >= 60 ? windowAt + 60_000 : 0),
    stats: () => ({...counts,active,cacheEntries:details.size}),
  };
}
