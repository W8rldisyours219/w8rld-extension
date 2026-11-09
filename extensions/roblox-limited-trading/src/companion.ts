/*! Loaded inventory rendering and reseller annotations adapted from RoUtility
 * src/features/inventory/invsearch.js::render and src/core/content.js::markDeals
 * at 403c75ed81f297e82ada6fccf084ae3fc2249def. Copyright (c) 2026 RoUtility.
 * MIT; full notice in ../THIRD_PARTY_NOTICES.txt. Only visible native records;
 * W8RLD retains its own provider contracts, preferences and read-only lifecycle. */
import { analyzeTrade, catalogAssetId, MAX_QUANTITY, QUOTE_FRESH_MS, type PricedTradeItem } from './core';
import { inspectNativeTrade } from './nativeTradeDom';
import { parseLookupReply, type ItemFacts } from './protocol';
import { companionRoute, DEFAULT_PREFERENCES, PREFERENCE_KEY, readPreferences, type Preferences } from './preferences';
import { emitContentDiagnostic } from './diagnostics';
import { demandBySide, displayNumber, freshQuote, freshUsd, inheritSurface, itemTags, itemValues, ownedRegion, ownedSelector, signedNumber, usdAmount, usdExact } from './presentation';
import { ageLabel, exactRobux, exactTimestamp, publicFacts, transactionSummary, visible, visibleTransactions } from './visibleData';
import { differenceNode, hoverPosition, itemPriceAnchor, itemResearch, itemPreviewBody, avatarValueTiles, listMetrics, tradeRowMetrics, tradeSideItems, tradeDemandComparison, metricAmount, metricDifference, previewPosition, similarItemCard, limitedSearchRow, publicSearchRow } from './nativeUi';
import { itemComparison, itemSellersAnchor } from './itemComparison';
import { nativeTradeList, tradeIndicatorAnchor, placeCardValues, cardTagsAnchor, portfolioAnchor, loadedItemMatches } from './nativeAdaptation';
import { startNativeSearch } from './nativeSearch';
import { tradeCalculator } from './tradeResearch';
import { localEnhancements } from './localEnhancements';
import { publicFactUi } from './publicFactUi';
import { displayUsd, visibleUsdSubtotal, usdDescription } from './usdDisplay';
import { parseSuggestions, type PublicSuggestion } from './publicSearch';
import { createNativeTradeReader, type ReadTrade } from './nativeTradeRead';
import {OWNERSHIP_FRESH_MS, ownershipView, type CopyObservation} from './tradeOwnership';
import { createNativeAvatarReader, type EquippedAvatar } from './nativeAvatarRead';
import { avatarShortcut, currentAvatarSection, trailerPreference } from './pagePreferences';
import {itemHistoryView} from './itemHistory';
import {proofImageIcon,dollarIcon,nativeRobuxIcon} from './nativeIcons';
import {memberQuery,parseMemberReply} from './publicFacts';
import {displayValue,displayValueTrade} from './valuation';
import { comparableUsd } from './similarPrice';

const OWNER = Symbol.for('w8rld.roblox.companion.lifecycle');
type TradeView = { items: PricedTradeItem[]; fingerprint: string; context: number; incomplete: boolean; time: number; expiresAt: number; created?: number; thumbnails?: Map<string, HTMLCanvasElement>; thumbnailFacts?: Map<string,ItemFacts> };
const tradeExpiry = (items: PricedTradeItem[], time: number, facts: readonly ItemFacts[] = []) => Math.min(time + QUOTE_FRESH_MS, ...facts.filter(f => !!f.thumbnailUrl).map(f => f.retrievedAt + QUOTE_FRESH_MS), ...items.flatMap(item => {
  const quote = freshQuote(item); const usd = freshUsd(item);
  return [...(quote ? [quote.fetchedAt + QUOTE_FRESH_MS] : []), ...(usd !== undefined && item.usdQuote ? [item.usdQuote.retrievedAt + QUOTE_FRESH_MS] : []),...(item.demandQuote?[item.demandQuote.retrievedAt+QUOTE_FRESH_MS]:[])];
}));
type Region = { node: HTMLElement; key: string };
export interface CompanionLifecycle {
  dispose(): void;
  trade(items: PricedTradeItem[], ready: boolean, incomplete: boolean, facts?: readonly ItemFacts[]): void;
  stats(): { scans: number; commits: number; requests: number; regions: number; timer: boolean; pending: boolean };
}
const own = (node: Node) => !!(node instanceof Element ? node : node.parentElement)?.closest(ownedSelector);
const fingerprint = (row: HTMLElement) => {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, { acceptNode: n => own(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let value = ''; for (let node = walker.nextNode(); node && value.length < 1024; node = walker.nextNode()) value += node.textContent ?? '';
  // Native virtualized rows may retain the same visible partner name while
  // changing their canonical profile link. Never carry a preview across that
  // identity change, even when all text happens to be identical.
  return JSON.stringify([value.slice(0, 1024), [...row.querySelectorAll<HTMLAnchorElement>('a.avatar-card-link')].map(n => n.getAttribute('href')),
    [...row.querySelectorAll('time[datetime]')].filter(n=>!own(n)).map(n=>n.getAttribute('datetime'))]);
};
const safeImage = (card: HTMLElement): HTMLCanvasElement | undefined => {
  const image = card.querySelector('img'); if (!image) return;
  try {
    const u = new URL(image.currentSrc || image.src);
    if (u.protocol !== 'https:' || !/(^|\.)rbxcdn\.com$/.test(u.hostname) || u.username || u.password || u.search || u.hash) return;
    if (!image.complete || !image.naturalWidth) return;
    // Copy already rendered pixels to a local canvas. No new image request,
    // credential-bearing CDN request, pixel readback or image export is needed.
    const copy = document.createElement('canvas'); copy.width = 32; copy.height = 32; copy.setAttribute('aria-hidden', 'true');
    const context = copy.getContext('2d'); if (!context) return; context.drawImage(image, 0, 0, 32, 32); return copy;
  } catch { return; }
};
function stopActions(node: HTMLElement) {
  for (const event of ['click', 'dblclick', 'auxclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup']) node.addEventListener(event, e => e.stopPropagation());
}

/** Native rows/cards remain the owners. Viewed trades and explicitly previewed
 * trades live in this document's memory only; no private account store or poll. */
export function startCompanion(extension: any, onPreferences: (value: Preferences) => void): CompanionLifecycle {
  const owners = globalThis as unknown as Record<symbol, CompanionLifecycle | undefined>; owners[OWNER]?.dispose();
  let disposed = false; let suspended = false; let enabled = true; let generation = 0; let route = location.href;
  let preferences: Preferences = { ...DEFAULT_PREFERENCES }; let timer: number | undefined; let settingsRevision = 0;
  let preferencesLoaded = false;
  let pending = false; let lookupKey = ''; let priced: PricedTradeItem[] = []; let facts: ItemFacts[] = [];
  let list: HTMLElement | undefined; let rowList: HTMLElement | undefined; let listCleanup: (() => void) | undefined;
  let tradeViews = new WeakMap<HTMLElement, TradeView>();
  let nativeDetails = new WeakMap<HTMLElement,ReadTrade>();
  type OwnershipRead = {context:number; fingerprint:string; observation?:CopyObservation; pending:boolean; nextAt:number};
  let ownershipReads = new WeakMap<HTMLElement,OwnershipRead>(); let ownershipTimer:number|undefined;
  type RowLoad = { fingerprint: string; context: number; attempts: number; state: 'queued' | 'loading' | 'ready' | 'unavailable'; promise: Promise<boolean>; done: (ready: boolean) => void };
  const rowLoads = new Map<HTMLElement, RowLoad>();
  const rowLookupCancels = new Set<() => void>();
  let rowPump = false; let rowRetryTimer: number | undefined; let rowExpiryTimer: number | undefined;
  let focusTradeRow: ((row: HTMLElement, keyboard?: boolean) => void) | undefined;
  let quoteExpiry: number | undefined;
  let expiredLookupKey = '';
  let tradeContext = 0; let contextRows: HTMLElement[] = []; let contextPrints: string[] = [];
  // Adapt invsearch's query/sort/shown state across native card/quote updates.
  let inventoryState = {query:'',sort:'Name',limited:false,shown:20};
  const refreshTools = new WeakMap<HTMLElement, () => void>();
  let memberNode:HTMLElement|undefined;let cancelMember=()=>{};
  let previewRequest = 0;
  let previewClose = 'initial';
  let loadingPreview:{row:HTMLElement;fingerprint:string;request:number}|undefined;
  const tradeReader = createNativeTradeReader(() => ({url:location.href,userId:document.querySelector<HTMLMetaElement>('meta[name="user-data"]')?.dataset.userid}));
  const avatarReader = createNativeAvatarReader(() => ({url:location.href,userId:document.querySelector<HTMLMetaElement>('meta[name="user-data"]')?.dataset.userid,editor:!!document.querySelector('#avatar-web-app .left-wrapper')}));
  let equippedAvatar:EquippedAvatar|undefined;let avatarReadKey='';let avatarState='loading';let avatarExpiry:number|undefined;
  const regions = new Map<HTMLElement, Region>(); const cleanups: (() => void)[] = [];
  const masks = new Map<HTMLElement, { attribute: string | null; title: string | null; aria: string | null }>();
  const serials = new Set<HTMLElement>(); const trailers = trailerPreference();
  let avatarResume: ReturnType<typeof avatarShortcut>;
  let historyView: ReturnType<typeof itemHistoryView> | undefined;
  let avatarResumeHost: HTMLElement | undefined; let avatarResumeKey = '';
  const count = { scans: 0, commits: 0, requests: 0 };
  const sentAlerts = new Set<string>();
  let rememberedSection = '';
  const catalogRequests = new WeakMap<HTMLElement, number>(); let catalogPending = 0;
  const catalogExpiry = new WeakMap<HTMLElement, number>();
  let proofUrl: string | undefined;
  let hoverTimer: number | undefined;
  let itemHoverTimer: number | undefined;
  const catalogTimers = new Set<number>();
  let lookupTimer: number | undefined; let retryTimer: number | undefined; let lookupSerial = 0; let lookupAttempts = 0; let lookupAt = 0;
  let lookupState: 'loading' | 'ready' | 'partial' | 'unavailable' = 'loading';
  let lookupRetryAt = 0;
  let observedMain: Element | undefined;
  let itemStarted = performance.now();
  const itemTimeline: { event: string; ms: number }[] = [];
  const markItem = (event: string) => { if (companionRoute(location.href) === 'item' && itemTimeline.length < 32) itemTimeline.push({ event, ms: Math.round(performance.now() - itemStarted) }); };
  let itemPreview: { node: HTMLElement; target: HTMLElement; assetId: string; description: string | null; expiry: number } | undefined;
  let comparison: ReturnType<typeof itemComparison> | undefined;
  let tradePriced: PricedTradeItem[] = [];
  let calculator: ReturnType<typeof tradeCalculator> | undefined;
  const localTools = localEnhancements();
  const publicInfo = publicFactUi(extension);
  let openPreview: { node: HTMLElement; row: HTMLElement; fingerprint: string; context: number; describedBy: string | null; view?: TradeView; expiry: number; inlineList?: HTMLElement; reserve?: string } | undefined;
  const observer = new MutationObserver(records => {
    if (records.every(r => own(r.target) || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(own))) return;
    schedule();
  });
  const locator = new MutationObserver(() => schedule());
  const socialObserver = new MutationObserver(records => { if (records.some(r => !own(r.target))) schedule(); });
  let socialRoot: HTMLElement | undefined;
  function listen(target: EventTarget, event: string, fn: EventListener) { target.addEventListener(event, fn); cleanups.push(() => target.removeEventListener(event, fn)); }
  function observe() {
    observer.disconnect(); locator.disconnect();
    if (disposed || suspended || !enabled || !companionRoute(location.href)) return;
    const main = document.querySelector('main') ?? document.body;
    observedMain = main;
    observer.observe(main, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'href', 'src', 'hidden', 'inert', 'aria-hidden', 'aria-busy', 'aria-selected', 'aria-label', 'data-quantity', 'data-asset-id', 'data-serial-number', 'data-item-status', 'datetime', 'title'] });
    for (let n = main.parentElement; n; n = n.parentElement) locator.observe(n, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-busy'] });
  }
  function clearRegions() { for (const r of regions.values()) r.node.remove(); regions.clear(); if (proofUrl) URL.revokeObjectURL(proofUrl); proofUrl = undefined; }
  function clearMasks() {
    for (const [n, original] of masks) {
      n.removeAttribute('data-w8rld-mask');
      if (original.title !== null) n.setAttribute('title', original.title);
      if (original.aria !== null) n.setAttribute('aria-label', original.aria); else n.removeAttribute('aria-label');
      if (original.attribute !== null) n.setAttribute('data-w8rld-mask', original.attribute);
    }
    masks.clear(); for (const n of serials) n.removeAttribute('data-w8rld-serial-hidden'); serials.clear();
  }
  function reset(keepReviewedTrades = false) {
    cancelMember();memberNode=undefined;cancelMember=()=>{};
    historyView?.dispose();historyView=undefined;
    trailers.dispose(); avatarResume?.dispose(); avatarResume = undefined; avatarResumeHost?.remove(); avatarResumeHost = undefined; avatarResumeKey = '';
    socialObserver.disconnect(); socialRoot = undefined;
    // Preference-only reconciliation retains the reviewed row's admitted
    // detail alongside its valuation view, while cancelling outstanding work.
    if(keepReviewedTrades)tradeReader.cancel();else{tradeReader.reset();nativeDetails = new WeakMap();}
    ownershipReads = new WeakMap();
    if(ownershipTimer!==undefined)clearTimeout(ownershipTimer);ownershipTimer=undefined;
    for (const cancel of rowLookupCancels) cancel(); rowLookupCancels.clear();
    for (const load of rowLoads.values()) load.done(false); rowLoads.clear(); rowPump = false;
    if (rowRetryTimer !== undefined) clearTimeout(rowRetryTimer); rowRetryTimer = undefined;
    if (rowExpiryTimer !== undefined) clearTimeout(rowExpiryTimer); rowExpiryTimer = undefined;
    avatarReader.reset();equippedAvatar=undefined;avatarReadKey='';avatarState='loading';
    if(avatarExpiry!==undefined)clearTimeout(avatarExpiry);avatarExpiry=undefined;
    publicInfo.reset();
    calculator?.dispose(); calculator = undefined; localTools.update();
    nativeSearch.setEnabled(false);
    comparison?.dispose(); comparison = undefined;
    closePreview('reset'); closeItemPreview();
    if (itemHoverTimer !== undefined) clearTimeout(itemHoverTimer); itemHoverTimer = undefined;
    for (const timer of catalogTimers) clearTimeout(timer); catalogTimers.clear(); catalogPending = 0;
    lookupSerial++; pending = false; lookupAttempts = 0; lookupAt = 0;
    lookupState = 'loading'; lookupRetryAt = 0; itemTimeline.length = 0; itemStarted = performance.now();
    if (lookupTimer !== undefined) clearTimeout(lookupTimer); lookupTimer = undefined;
    if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined;
    if (quoteExpiry !== undefined) clearTimeout(quoteExpiry); quoteExpiry = undefined; expiredLookupKey = '';
    generation++; lookupKey = ''; priced = []; tradePriced = []; facts = []; if (!keepReviewedTrades) { tradeViews = new WeakMap(); contextRows = []; contextPrints = []; tradeContext++; inventoryState = {query:'',sort:'Name',limited:false,shown:20}; } sentAlerts.clear(); clearRegions(); clearMasks();
    listCleanup?.(); listCleanup = undefined; list = undefined; rowList = undefined;
  }
  function region(anchor: HTMLElement, key: string, create: () => HTMLElement, after = false) {
    const old = regions.get(anchor);
    if (old?.node.isConnected && old.key === key) { inheritSurface(old.node, anchor); return old.node; }
    old?.node.remove(); const node = create(); inheritSurface(node, anchor);
    // Passive row metrics belong to native trade navigation. Only owned
    // interactive tools isolate their events from surrounding native controls.
    if (!node.classList.contains('w8rld-trade-row-metrics')) stopActions(node);
    if (after) anchor.after(node); else anchor.append(node);
    regions.set(anchor, { node, key }); count.commits++; return node;
  }
  function schedule() { if (!disposed && !suspended && timer === undefined) timer = window.setTimeout(() => {
    timer = undefined;
    try { scan(); } catch { emitContentDiagnostic(extension, { code: 'W8RLD-EXT-NAVIGATION-001', status: 'failed', enabled: 'yes', page: 'unknown' }); }
  }, 120); }
  function currentRows(): HTMLElement[] { return rowList ? [...rowList.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n.matches('.trade-row')) : []; }
  function syncTradeContext() {
    const rows = currentRows(); const prints = rows.map(fingerprint);
    // An unchanged row can represent another trade after a prefix is reordered,
    // paged or recycled. Cache validity belongs to the whole verified native
    // prefix, including element identity, rather than to a partner's text alone.
    const stablePrefix = rows.length >= contextRows.length && contextRows.every((n,i) => n === rows[i] && contextPrints[i] === prints[i]);
    if (!stablePrefix) {
      tradeContext++; tradeReader.reset();
      for (const load of rowLoads.values()) load.done(false); rowLoads.clear();
    }
    // Native infinite scrolling appends a page without changing the admitted
    // prefix. Its existing row identities and in-flight reads remain valid.
    contextRows = rows; contextPrints = prints;
    return tradeContext;
  }
  function repairList() {
    const scope = document.querySelector<HTMLElement>('main > .content > #trades-web-app.trades-container .trade-row-list');
    const native = scope && nativeTradeList(scope); const next = native?.scroll;
    if (!next || !visible(next)) { listCleanup?.(); listCleanup = undefined; list = undefined; rowList = undefined; syncTradeContext(); return; }
    rowList = native.rows;
    if (next !== list) {
      listCleanup?.(); closePreview(); list = next;
      const priorAttribute = next.getAttribute('data-w8rld-scroll'); const priorMax = next.style.getPropertyValue('--w8rld-list-max');
      const priorTab = next.getAttribute('tabindex');
      let keyboardFrame: number | undefined;
      next.dataset.w8rldScroll = ''; if (!next.hasAttribute('tabindex')) next.tabIndex = 0;
      // Shared focus-only navigation for keys and search results. As in the
      // pinned upstream navigation, keep the destination visible, but retain
      // W8RLD's no-selection rule and wait for this scroll before previewing.
      focusTradeRow = (target, keyboard = false) => {
        if (keyboardFrame !== undefined) cancelAnimationFrame(keyboardFrame);
        keyboardFrame = requestAnimationFrame(() => {
          keyboardFrame = undefined;
          if (disposed || suspended || !enabled || keyboard && !preferences.tradeKeyboard || next !== list
            || !target.isConnected || document.activeElement !== target) return;
          if (preferences.tradePreviews) showPreview(target);
        });
        target.focus({ preventScroll: true });
        const r = target.getBoundingClientRect(); const box = next.getBoundingClientRect();
        if (r.bottom > box.bottom) next.scrollTop += r.bottom - box.bottom; else if (r.top < box.top) next.scrollTop -= box.top - r.top;
      };
      const keyboard = (event: KeyboardEvent) => {
        if (!preferences.tradeKeyboard || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
          || event.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !(event.target instanceof Element)
          || event.target.closest('input,textarea,select,[contenteditable],[role="textbox"],button,a,[data-w8rld-owned]')) return;
        // RoUtility onTradeKeys: skip filtered rows and yield to native dialogs.
        // Focus-only navigation keeps every native trade action untouched.
        if ([...document.querySelectorAll<HTMLElement>('[role="dialog"],.modal.in')].some(visible)) return;
        const rows = currentRows().filter(visible); const focused = event.target.closest<HTMLElement>('.trade-row');
        if (event.target !== next && !focused) return;
        const index = focused ? rows.indexOf(focused) : -1;
        const destination = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length-1 : index<0 ? event.key==='ArrowUp'?rows.length-1:0 : index+(event.key==='ArrowDown'?1:-1);
        const target = rows[Math.max(0, Math.min(rows.length - 1, destination))];
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        focusTradeRow?.(target, true);
      };
      next.addEventListener('keydown', keyboard);
      const reveal = (event: Event) => {
        if (!preferences.tradePreviews || !(event.target instanceof Element)) return;
        if (event.type === 'focusin' && keyboardFrame !== undefined) return;
        const row = event.target.closest<HTMLElement>('.trade-row');
        if (!row || event instanceof MouseEvent && event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
        if (hoverTimer !== undefined) clearTimeout(hoverTimer);
        if (event.type === 'focusin') showPreview(row);
        else hoverTimer = window.setTimeout(() => { hoverTimer = undefined; showPreview(row); }, 160);
      };
      next.addEventListener('focusin', reveal); next.addEventListener('mouseover', reveal);
      const leave = (event: Event) => {
        if (hoverTimer !== undefined) clearTimeout(hoverTimer); hoverTimer = undefined;
        const related = (event as FocusEvent).relatedTarget;
        const row = event.target instanceof Element ? event.target.closest('.trade-row') : undefined;
        if (!(related instanceof Node) || !row?.contains(related)) closePreview('leave');
      };
      next.addEventListener('mouseout', leave); next.addEventListener('focusout', leave);
      const scrolled = () => closePreview('scroll');
      next.addEventListener('scroll', scrolled, { passive: true });
      listCleanup = () => {
        focusTradeRow = undefined;
        if (keyboardFrame !== undefined) cancelAnimationFrame(keyboardFrame);
        closePreview('list-cleanup');
        next.removeEventListener('keydown', keyboard);
        next.removeEventListener('focusin', reveal); next.removeEventListener('mouseover', reveal);
        next.removeEventListener('mouseout', leave); next.removeEventListener('focusout', leave); next.removeEventListener('scroll', scrolled);
        if (priorAttribute === null) next.removeAttribute('data-w8rld-scroll'); else next.setAttribute('data-w8rld-scroll', priorAttribute);
        if (priorMax) next.style.setProperty('--w8rld-list-max', priorMax); else next.style.removeProperty('--w8rld-list-max');
        if (priorTab === null) next.removeAttribute('tabindex'); else next.setAttribute('tabindex', priorTab);
      };
    }
    // Native desktop list is 610px tall even when its bottom is below the
    // viewport. Bound that same container to the actual available space.
    const max = `${Math.max(120, Math.min(innerHeight - 16, Math.floor(innerHeight - next.getBoundingClientRect().top - 16)))}px`;
    if (next.style.getPropertyValue('--w8rld-list-max') !== max) next.style.setProperty('--w8rld-list-max', max);
    syncTradeContext();
  }
  function tradeMetrics(view: TradeView) {
    const metrics = tradeRowMetrics(view.items, view.incomplete, preferences);
    return { metrics, text: metrics.map(m => `${m.label} ${metricDifference(m)}`).join(' · ') };
  }
  function preview(view: TradeView, row: HTMLElement) {
    const node = ownedRegion('Trade preview, Limited items only'); node.classList.add('w8rld-trade-preview');
    const m = { metrics: [...listMetrics(view.items, view.incomplete, 'rap-value', preferences), ...listMetrics(view.items, view.incomplete, 'rap-usd', preferences).filter(metric => metric.key === 'usd')] };
    const demand = demandBySide(view.items, view.incomplete, preferences);
    for (const side of ['give', 'receive'] as const) {
      const line = document.createElement('div'); line.className = 'w8rld-preview-side';
      // RoUtility previewSide's compact heading and side-total layout.
      const head = document.createElement('div'); head.className = 'w8rld-preview-head';
      const heading = document.createElement('strong'); heading.textContent = side === 'give' ? 'Giving' : 'Receiving'; head.append(heading); line.append(head);
      line.append(tradeSideItems(view.items,side,preferences,view.thumbnailFacts,view.thumbnails,true));
      for (const metric of m.metrics) {
        const total = document.createElement('span'); total.className = 'w8rld-preview-total'; total.textContent = `${metric.label} ${metricAmount(metric, metric[side], preferences.compactNumbers)}`; total.title = `${metric.label} ${metricAmount(metric, metric[side])}`; total.setAttribute('aria-label', total.title); head.append(total);
      }
      if (preferences.itemDemand) {
        const rating = document.createElement('small'); rating.className = 'w8rld-preview-demand';
        rating.textContent = `Demand ${demand[side].value}`; rating.title = demand[side].detail;
        line.append(rating);
      }
      node.append(line);
    }
    const difference = document.createElement('div'); difference.className = 'w8rld-preview-differences'; difference.append(...m.metrics.map(m => differenceNode(m, preferences.compactNumbers)));
    if (difference.children.length) node.append(difference);
    if(pendingTradeTab())node.append(ownershipView(ownershipReads.get(row)?.observation,preferences.privacyMode));
    return node;
  }
  function closePreview(reason = 'dismiss') {
    previewClose = reason;
    previewRequest++;
    loadingPreview=undefined;
    // Dismissing a hover must not abort the list's shared read-only row queue.
    if (hoverTimer !== undefined) clearTimeout(hoverTimer); hoverTimer = undefined;
    removePreview();
  }
  function removePreview() {
    if (!openPreview) return;
    const { node, row, describedBy, inlineList, reserve, expiry } = openPreview; clearTimeout(expiry); node.remove();
    if (inlineList) { if (reserve) inlineList.style.setProperty('--w8rld-preview-space', reserve); else inlineList.style.removeProperty('--w8rld-preview-space'); }
    if (describedBy === null) row.removeAttribute('aria-describedby'); else row.setAttribute('aria-describedby', describedBy);
    openPreview = undefined;
  }
  function showPreview(row: HTMLElement) {
    const context = syncTradeContext();
    const view = tradeViews.get(row);
    if (!list || !view || view.context !== context || view.fingerprint !== fingerprint(row) || Date.now() >= view.expiresAt || !visible(row)) {
      if(list&&loadingPreview?.row===row&&loadingPreview.fingerprint===fingerprint(row)&&visible(row))return;
      closePreview('new-preview');
      if (list && enabled && preferences.tradeList && preferences.tradePreviews && visible(row)) void loadUnopenedPreview(row);
      return;
    }
    // Catalog replies can beat native thumbnail decoding. Refresh only missing
    // pixels for the currently selected, recognized offer; cached other rows
    // must never borrow this trade's images. No request or pixel readback.
    if (!preferences.privacyMode && row.classList.contains('selected')) {
      const native = inspectNativeTrade(document);
      if (native.status === 'PASS') for (const card of native.sides.flatMap(s => s.cards)) {
        if (!view.items.some(i => i.assetId === card.item.assetId) || view.thumbnails?.has(card.item.assetId)) continue;
        const copy = safeImage(card.node);
        if (copy) (view.thumbnails ??= new Map()).set(card.item.assetId, copy);
        else if (card.node.querySelector('img')?.complete) emitContentDiagnostic(extension, { code: 'W8RLD-EXT-THUMBNAIL-001', status: 'unavailable', enabled: 'yes', page: 'trades' });
      }
    }
    if (openPreview?.row === row && openPreview.view === view) return;
    closePreview('replace');
    mountTradePreview(row, preview(view,row), view);
    checkOwnership(row);schedule();
  }
  function mountTradePreview(row: HTMLElement, node: HTMLElement, view?: TradeView) {
    if (!list) return;
    removePreview();
    node.id = 'w8rld-trade-preview'; node.setAttribute('role', 'tooltip'); inheritSurface(node, row);
    node.style.visibility = 'hidden';
    node.style.width = `${Math.min(320, innerWidth - 16, Math.max(240, list.clientWidth - 16))}px`;
    // Fixed owned tooltip has no focusable controls and cannot change list size.
    document.body.append(node);
    const bounds = node.getBoundingClientRect();
    const protectedNodes = [...document.querySelectorAll<HTMLElement>('main button,main input,main select,main textarea,main [role="button"]:not(.trade-row)')].filter(n => !own(n) && visible(n));
    const position = previewPosition(row.getBoundingClientRect(), list.getBoundingClientRect(), bounds.width, bounds.height,
      { width: innerWidth, height: innerHeight }, protectedNodes.map(n => n.getBoundingClientRect()));
    const reserve = list.style.getPropertyValue('--w8rld-preview-space');
    if (!position) {
      // A single inline alternative outside the scrolling rows. Its own native
      // flow reserves space; it cannot overlay another row or its scrollbar.
      node.classList.add('w8rld-preview-inline'); list.after(node); node.style.width = '';
      list.style.setProperty('--w8rld-preview-space', `${Math.ceil(node.getBoundingClientRect().height) + 16}px`);
    } else { node.style.left = `${position.left}px`; node.style.top = `${position.top}px`; }
    node.style.visibility = '';
    const describedBy = row.getAttribute('aria-describedby'); row.setAttribute('aria-describedby', [describedBy, node.id].filter(Boolean).join(' '));
    const expiry = window.setTimeout(() => { if(view)tradeViews.delete(row); closePreview(); if(view)schedule(); }, view ? Math.max(1, view.expiresAt - Date.now()) : 28_000);
    openPreview = { node, row, fingerprint: fingerprint(row), context: syncTradeContext(), describedBy, view, expiry, ...(!position ? {inlineList:list,reserve} : {}) };
  }
  function previewStatus(row: HTMLElement, loading: boolean) {
    const node = ownedRegion('Trade preview status'); node.classList.add('w8rld-trade-preview','w8rld-preview-status');
    node.setAttribute('aria-busy', String(loading));
    const status = document.createElement('small'); status.setAttribute('role','status');
    status.textContent = loading ? 'Loading trade preview…' : 'No verified preview is available for this row. Move away and return to retry.';
    node.append(status); mountTradePreview(row,node);
  }
  async function loadUnopenedPreview(row: HTMLElement) {
    // Focus can move from a row into its native link while the same hover read
    // is pending. Join that identity instead of invalidating the only response.
    const print=fingerprint(row);
    if(loadingPreview?.row===row&&loadingPreview.fingerprint===print)return;
    const request = ++previewRequest;
    loadingPreview={row,fingerprint:print,request};
    previewStatus(row,true);
    const ready = await queueTradeRow(row, true);
    if (loadingPreview?.request !== request || fingerprint(row) !== print) return;
    loadingPreview = undefined;
    if (ready) showPreview(row); else if (visible(row)) {
      emitContentDiagnostic(extension, { code: 'W8RLD-EXT-PREVIEW-001', status: 'unavailable', enabled: 'yes', page: 'trades' });
      previewStatus(row,false);
    }
  }
  // RoUtility trades.js::pump/loadDetail: one bounded queue shared by passive
  // annotations and previews. Private details stay in this document's memory.
  function queueTradeRow(row: HTMLElement, priority = false): Promise<boolean> {
    const context = syncTradeContext(); const print = fingerprint(row);
    const view = tradeViews.get(row);
    if (view?.context === context && view.fingerprint === print && Date.now() < view.expiresAt) return Promise.resolve(true);
    const old = rowLoads.get(row);
    if (old?.context === context && old.fingerprint === print) {
      if (priority && old.state === 'queued') { rowLoads.delete(row); const rest = [...rowLoads]; rowLoads.clear(); rowLoads.set(row,old); for (const [n,v] of rest) rowLoads.set(n,v); }
      return old.promise;
    }
    let done!: (ready: boolean) => void;
    const promise = new Promise<boolean>(resolve => { done = resolve; });
    const load: RowLoad = {fingerprint:print,context,attempts:0,state:'queued',promise,done};
    rowLoads.set(row,load); void pumpTradeRows(); return promise;
  }
  async function pumpTradeRows() {
    if (rowPump || disposed || suspended || !enabled || !preferences.tradeList || companionRoute(location.href) !== 'trades') return;
    const version = generation; rowPump = true;
    try {
      for (const [row,load] of rowLoads) {
        if (version !== generation || disposed || suspended || !enabled || !preferences.tradeList) return;
        if (load.state !== 'queued') continue;
        if (!row.isConnected || load.context !== syncTradeContext() || fingerprint(row) !== load.fingerprint) { load.done(false); rowLoads.delete(row); continue; }
        const retryAt = tradeReader.retryAt();
        if (Date.now() < retryAt) {
          if (rowRetryTimer === undefined) rowRetryTimer = window.setTimeout(() => { rowRetryTimer = undefined; void pumpTradeRows(); }, retryAt-Date.now());
          break;
        }
        load.state = 'loading'; load.attempts++;
        const ready = await loadTradeRow(row);
        if (version !== generation || rowLoads.get(row) !== load) return;
        // A genuine server cooldown leaves a finite queued job, rather than
        // caching a transient failure forever or polling the endpoint.
        if (!ready && load.attempts < 2 && Date.now() < tradeReader.retryAt()) { load.state = 'queued'; break; }
        load.state = ready ? 'ready' : 'unavailable'; load.done(ready); schedule();
      }
    } finally {
      if (version === generation) {
        rowPump = false;
        if ([...rowLoads.values()].some(load => load.state === 'queued') && rowRetryTimer === undefined) {
          const retryAt = tradeReader.retryAt();
          if (retryAt > Date.now()) rowRetryTimer = window.setTimeout(() => { rowRetryTimer = undefined; void pumpTradeRows(); }, retryAt-Date.now());
          else void pumpTradeRows();
        }
      }
    }
  }
  async function loadTradeRow(row: HTMLElement): Promise<boolean> {
    const version = generation; const url = location.href;
    const context = syncTradeContext();
    const rows = currentRows(); const prints = rows.map(fingerprint); const index = rows.indexOf(row);
    const partners = rows.map(n => {
      const links = n.querySelectorAll<HTMLAnchorElement>('a.avatar-card-link[href]');
      if (links.length !== 1) return undefined;
      const link = new URL(links[0].href);
      return link.origin === 'https://www.roblox.com' ? /^\/users\/([1-9]\d{0,19})\/profile\/?$/.exec(link.pathname)?.[1] : undefined;
    });
    const stillCurrent = () => !disposed && !suspended && enabled && preferences.tradeList
      && version === generation && url === location.href && row.isConnected
      && context === syncTradeContext()
      && currentRows().length >= rows.length && rows.every((n,i) => currentRows()[i] === n && fingerprint(n) === prints[i]);
    const timestamps = rows.map(n => {
      // Owned trade-age labels are derived from an earlier API reply, not an
      // independent native key for disambiguating repeated partners.
      const times = [...n.querySelectorAll('time[datetime]')].filter(t => !own(t));
      const raw = times[0]?.getAttribute('datetime');
      return times.length === 1 && visible(times[0]) && raw?.includes('T') ? exactTimestamp(raw) : undefined;
    });
    const dates = rows.map(n => {
      // Observed native calendar labels are independent of our API-derived age.
      // The reader requires a fully matching prefix and a unique partner/day
      // across its complete list; absent/localized/ambiguous labels stay refused.
      const labels = [...n.querySelectorAll<HTMLElement>('.trade-sent-date')].filter(t => !own(t) && visible(t));
      return labels.length === 1 && !labels[0].children.length ? labels[0].textContent?.trim() : undefined;
    });
    const detail = await tradeReader.load(partners,index,timestamps,dates);
    if (!detail || !stillCurrent()) return false;
    nativeDetails.set(row,detail);
    const ids = [...new Set(detail.items.map(i => i.assetId))]; count.requests++;
    return new Promise(resolve => {
    let settled = false;
    const cancel = () => finish(undefined);
    const finish = (raw: unknown) => {
      if (settled) return; settled = true; clearTimeout(timeout); catalogTimers.delete(timeout);
      rowLookupCancels.delete(cancel);
      if (!stillCurrent()) { resolve(false); return; }
      const reply = parseLookupReply(raw,ids); if (!reply?.ok) { resolve(false); return; }
      const items = detail.items.map(i => ({...i,quote:reply.quotes.find(q => q.assetId === i.assetId),usdQuote:reply.usdQuotes?.find(q => q.assetId === i.assetId),demandQuote:reply.demandQuotes?.find(q=>q.assetId===i.assetId)}));
      if (!items.some(i => freshQuote(i) || freshUsd(i) !== undefined)) { resolve(false); return; }
      const time = Date.now();
      const thumbnailFacts = new Map((reply.facts ?? []).filter(f => !!f.thumbnailUrl && f.retrievedAt <= time && time - f.retrievedAt < QUOTE_FRESH_MS).map(f => [f.assetId,f]));
      tradeViews.set(row,{items,fingerprint:prints[index],context,incomplete:detail.incomplete,time,expiresAt:tradeExpiry(items,time,[...thumbnailFacts.values()]),created:detail.created,thumbnailFacts});
      resolve(true);
    };
    const timeout = window.setTimeout(() => finish(undefined),10_000); catalogTimers.add(timeout);
    rowLookupCancels.add(cancel);
    try {extension.runtime.sendMessage({type:'w8rld:limited-lookup',assetIds:ids},(raw:unknown) => {const error=extension.runtime.lastError;finish(error ? undefined : raw);});}catch{finish(undefined);}
    });
  }
  const pendingTradeTab = () => ['Inbound','Outbound'].includes(new URL(location.href).searchParams.get('tab') ?? 'Inbound');
  function checkOwnership(row: HTMLElement) {
    const detail=nativeDetails.get(row);if(!detail||!pendingTradeTab()||document.visibilityState==='hidden')return;
    const context=tradeContext;const print=fingerprint(row);const old=ownershipReads.get(row);
    if(old?.context===context&&old.fingerprint===print&&(old.pending||Date.now()<old.nextAt))return;
    const state:OwnershipRead={context,fingerprint:print,pending:true,nextAt:Date.now()+OWNERSHIP_FRESH_MS};
    ownershipReads.set(row,state);
    if(openPreview?.row===row){removePreview();showPreview(row);}
    void tradeReader.ownership(detail).then(observation=>{
      if(disposed||suspended||ownershipReads.get(row)!==state||context!==syncTradeContext()||print!==fingerprint(row))return;
      state.pending=false;state.observation=observation;state.nextAt=Math.max(Date.now()+1000,(observation?.checkedAt??Date.now())+OWNERSHIP_FRESH_MS,tradeReader.retryAt());
      if(openPreview?.row===row){removePreview();showPreview(row);}schedule();
    });
  }
  function closeItemPreview() {
    if (!itemPreview) return;
    const { node, target, description, expiry } = itemPreview; clearTimeout(expiry); node.remove();
    if (description === null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', description);
    itemPreview = undefined;
  }
  function showItemPreview(target: HTMLElement) {
    closeItemPreview();
    const card = target.closest<HTMLElement>('.item-card-container,.trade-item-card');
    const link = target.closest<HTMLAnchorElement>('a[href*="/catalog/"]');
    const id = link && catalogAssetId(link.getAttribute('href') ?? '', document.baseURI);
    const item = id && [...tradePriced, ...priced].find(i => i.assetId === id);
    if (!enabled || !preferences.itemPreviews || !card || !item || !visible(card) || !freshQuote(item) && freshUsd(item) === undefined) return;
    closePreview('item-hover');
    const node = ownedRegion('Limited item preview'); node.id = 'w8rld-item-preview'; node.classList.add('w8rld-item-preview'); node.setAttribute('role', 'tooltip');
    const fact = facts.find(f => f.assetId === item.assetId && f.retrievedAt <= Date.now() && Date.now()-f.retrievedAt < QUOTE_FRESH_MS);
    node.append(itemPreviewBody(item, fact, preferences, preferences.privacyMode ? undefined : safeImage(card)));
    inheritSurface(node, card); node.style.visibility = 'hidden'; document.body.append(node);
    const rect = card.getBoundingClientRect(); const size = node.getBoundingClientRect();
    const controls = [...document.querySelectorAll<HTMLElement>('main button,main input,main select,main textarea')].filter(n => !own(n) && visible(n)).map(n => n.getBoundingClientRect());
    const position = hoverPosition(rect,size.width,size.height,{width:innerWidth,height:innerHeight},controls,true);
    if (!position) { node.remove(); return; }
    node.style.left = `${position.left}px`; node.style.top = `${position.top}px`; node.style.visibility = '';
    const description = target.getAttribute('aria-describedby'); target.setAttribute('aria-describedby', [description, node.id].filter(Boolean).join(' '));
    const times = [freshQuote(item)?.fetchedAt,freshUsd(item) === undefined ? undefined : item.usdQuote?.retrievedAt,fact?.retrievedAt].filter((t): t is number => t !== undefined);
    const expiry = window.setTimeout(closeItemPreview,Math.max(0,Math.min(...times)+QUOTE_FRESH_MS-Date.now()));
    itemPreview = { node, target, assetId:item.assetId, description, expiry };
  }
  function enhanceTradeList() {
    repairList(); if (!list) return;
    if(ownershipTimer!==undefined)clearTimeout(ownershipTimer);ownershipTimer=undefined;
    const ownershipDeadlines:number[]=[];
    for (const [row,load] of rowLoads) if (!row.isConnected || load.context !== tradeContext || load.fingerprint !== fingerprint(row)) { load.done(false); rowLoads.delete(row); }
    for (const row of currentRows()) {
      const view = tradeViews.get(row);
      if (view && (view.context !== tradeContext || view.fingerprint !== fingerprint(row) || Date.now() >= view.expiresAt)) { tradeViews.delete(row); if (openPreview?.row === row) closePreview('expired-view'); }
      const known = tradeViews.get(row);
      const reviewOwnership=pendingTradeTab()&&(row.classList.contains('selected')||openPreview?.row===row);
      if(reviewOwnership){checkOwnership(row);const status=ownershipReads.get(row);if(status&&!status.pending)ownershipDeadlines.push(status.nextAt);}
      if (preferences.tradeList) void queueTradeRow(row);
      const load = rowLoads.get(row);
      const timestamps = [...row.querySelectorAll<HTMLElement>('time[datetime]')].filter(n => !own(n) && visible(n));
      const time = (timestamps.length === 1 ? exactTimestamp(timestamps[0].getAttribute('datetime')) : undefined) ?? known?.created;
      const showAge = preferences.tradeAge && time !== undefined;
      const metrics = preferences.tradeList && known ? tradeMetrics(known).metrics : [];
      if (!metrics.length && !showAge && !preferences.tradeList) { const old = regions.get(row); old?.node.remove(); regions.delete(row); continue; }
      const ownership=reviewOwnership?ownershipReads.get(row):undefined;
      const indicator = region(row, JSON.stringify([preferences, known, time, load?.state,ownership]), () => {
        const node = ownedRegion('Read-only trade observations'); node.classList.add('w8rld-trade-row-metrics');
        if (preferences.tradeList && !known) {
          const status = document.createElement('small'); status.setAttribute('role','status');
          status.textContent = load?.state === 'loading' || load?.state === 'queued' ? 'Loading W/L…' : 'W/L unavailable'; node.append(status);
          if (load?.state === 'unavailable' || load?.state === 'ready') {
            const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry W/L';
            retry.addEventListener('click', event => { event.stopPropagation(); rowLoads.delete(row); void queueTradeRow(row,true); schedule(); }); node.append(retry);
          }
        }
        if(preferences.tradeList&&known){
          const items=document.createElement('div');items.className='w8rld-row-items';
          for(const side of ['give','receive'] as const)items.append(tradeSideItems(known.items,side,preferences,known.thumbnailFacts,known.thumbnails));
          node.append(items);
        }
        const differences=document.createElement('div');differences.className='w8rld-row-differences';differences.append(...metrics.map(m=>differenceNode(m,preferences.compactNumbers)));if(differences.children.length)node.append(differences);
        if(preferences.tradeList&&known){const demand=tradeDemandComparison(known.items,known.incomplete,preferences);if(demand)node.append(demand);}
        if (showAge && time !== undefined) { const age = document.createElement('time'); age.dateTime = new Date(time).toISOString(); age.textContent = ageLabel(time); age.title = new Date(time).toLocaleString(); node.append(age); }
        if(reviewOwnership)node.append(ownershipView(ownership?.observation,preferences.privacyMode));
        return node;
      });
      const anchor = tradeIndicatorAnchor(row); if (indicator.parentElement !== anchor) anchor.append(indicator);
    }
    if(ownershipDeadlines.length&&document.visibilityState!=='hidden')ownershipTimer=window.setTimeout(()=>{ownershipTimer=undefined;schedule();},Math.max(1,Math.min(...ownershipDeadlines)-Date.now()));
    if (rowExpiryTimer !== undefined) clearTimeout(rowExpiryTimer); rowExpiryTimer = undefined;
    const expiry = Math.min(...currentRows().flatMap(row => { const view = tradeViews.get(row); return view ? [view.expiresAt] : []; }));
    if (Number.isFinite(expiry)) rowExpiryTimer = window.setTimeout(() => { rowExpiryTimer = undefined; schedule(); }, Math.max(1,expiry-Date.now()));
    if (preferences.tradeSearch && list.parentElement) region(list.parentElement, `trade-search:${preferences.privacyMode}`, () => {
      const node = ownedRegion('Search reviewed trades'); node.classList.add('w8rld-search');
      const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Find item in reviewed trades'; input.setAttribute('aria-label', 'Search reviewed trades by item name, acronym or asset ID'); input.maxLength = 100;
      const status = document.createElement('small'); status.textContent = 'Partial history · only trades you view in this tab. Native rows remain available.';
      const results = document.createElement('div'); results.setAttribute('role', 'status');
      input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase(); results.replaceChildren(); if (!query) return;
        const matches = currentRows().filter(row => {
          const view = tradeViews.get(row); const player = preferences.tradePlayerSearch && !preferences.privacyMode ? row.querySelector<HTMLElement>('.text-lead') : undefined;
          return !!player && visible(player) && !!player.innerText.toLowerCase().includes(query)
            || view?.fingerprint === fingerprint(row) && view.items.some(i => loadedItemMatches(query, {...i,acronym:freshQuote(i)?.acronym}));
        });
        for (const [i, row] of matches.slice(0, 20).entries()) { const button = document.createElement('button'); button.type = 'button'; button.textContent = `Focus matching trade ${i + 1}`; button.addEventListener('click', () => { if (row.isConnected && visible(row)) focusTradeRow?.(row); }); results.append(button); }
        if (!matches.length) results.textContent = 'No matches in reviewed, loaded trades.';
      }); node.append(input, status, results); return node;
    });
  }
  function lookupRetry() {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Refresh item values';
    button.addEventListener('click', () => { expiredLookupKey = ''; lookupAt = 0; lookupAttempts = 0; lookupRetryAt = 0; lookupState = 'loading'; schedule(); });
    return button;
  }
  function lookup(items: PricedTradeItem[]) {
    const ids = [...new Set(items.map(i => i.assetId))].sort().slice(0, 100); const key = ids.join(',');
    if (key === expiredLookupKey) return;
    if (!ids.length || pending || key === lookupKey && Date.now() - lookupAt < QUOTE_FRESH_MS) return;
    if (key !== lookupKey) {
      if (quoteExpiry !== undefined) clearTimeout(quoteExpiry); quoteExpiry = undefined; expiredLookupKey = '';
      priced = []; facts = [];
      lookupAttempts = 0; lookupAt = 0; lookupRetryAt = 0; lookupKey = key; lookupState = 'loading'; markItem('asset-discovered');
    }
    if (lookupAttempts >= 3 || retryTimer !== undefined || Date.now() < lookupRetryAt) return;
    pending = true; lookupAttempts++; const serial = ++lookupSerial;
    const version = generation; const url = location.href; count.requests++;
    markItem('worker-request');
    const done = (raw: unknown) => {
      if (serial !== lookupSerial || !pending) return;
      pending = false; if (lookupTimer !== undefined) clearTimeout(lookupTimer); lookupTimer = undefined;
      if (disposed || suspended || version !== generation || url !== location.href) { schedule(); return; }
      markItem('worker-response');
      const reply = parseLookupReply(raw, ids);
      let retryDelay = lookupAttempts * 1000;
      let retry = true;
      if (reply?.ok === true) {
        markItem('reply-admitted');
        const statuses = reply.providers && Object.values(reply.providers);
        const failures = statuses?.filter(s => s.state === 'stale' || s.state === 'unavailable') ?? [];
        retry = failures.length > 0;
        lookupState = retry ? 'partial' : 'ready';
        // Use evidence age, not receipt time, for the content-side cache.
        const times = [...reply.quotes.map(q => q.fetchedAt), ...(reply.usdQuotes ?? []).map(q => q.retrievedAt), ...(reply.facts ?? []).map(f => f.retrievedAt)];
        lookupAt = retry ? 0 : Math.min(Date.now(), ...times);
        if (!retry) lookupAttempts = 0;
        else retryDelay = Math.max(1000, Math.min(...failures.map(s => Math.max(Date.now() + 1000, s.retryAt ?? Date.now() + 60_000))) - Date.now());
        priced = items.map(i => ({ ...i, quote: reply.quotes.find(q => q.assetId === i.assetId), usdQuote: reply.usdQuotes?.find(q => q.assetId === i.assetId), demandQuote:reply.demandQuotes?.find(q=>q.assetId===i.assetId) }));
        facts = reply.facts ?? [];
        if (quoteExpiry !== undefined) clearTimeout(quoteExpiry); quoteExpiry = undefined;
        const evidenceTimes = [...times, ...(reply.demandQuotes ?? []).map(q => q.retrievedAt)]
          .filter(at => at <= Date.now() && Date.now() - at < QUOTE_FRESH_MS);
        if (evidenceTimes.length) quoteExpiry = window.setTimeout(() => {
          quoteExpiry = undefined;
          if (disposed || suspended || version !== generation || lookupKey !== key) return;
          // Withdraw this snapshot once; expiry must not become idle polling.
          expiredLookupKey = key; priced = []; facts = []; lookupState = 'unavailable';
          if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined;
          closeItemPreview(); schedule();
        }, Math.max(1, Math.min(...evidenceTimes) + QUOTE_FRESH_MS - Date.now()));
        markItem('content-cache-update');
        if (!priced.some(p => freshQuote(p) || freshUsd(p) !== undefined)) lookupState = 'unavailable';
      } else lookupState = 'unavailable';
      // At most two automatic retries. Provider deadlines survive worker restart
      // and are never replaced with rapid content-message retries.
      lookupRetryAt = retry ? Date.now() + Math.max(lookupAttempts >= 3 ? 60_000 : 0, retryDelay) : 0;
      if (retry && lookupAttempts < 3 && retryDelay <= 2_147_483_647) retryTimer = window.setTimeout(() => { retryTimer = undefined; schedule(); }, retryDelay);
      schedule();
    };
    lookupTimer = window.setTimeout(() => done(undefined), 12_000);
    try { extension.runtime.sendMessage({ type: 'w8rld:limited-lookup', assetIds: ids }, (raw: unknown) => { const error = extension.runtime.lastError; done(error ? undefined : raw); }); }
    catch { done(undefined); }
  }
  function cardItems(main: HTMLElement) {
    // Shared native card class observed on the current marketplace and trade
    // layout. Unknown inventory/avatar/profile layouts simply add nothing.
    // Count every admitted visible copy. The provider lookup retains its own
    // 100-ID bound; truncating here silently understated coverage denominators.
    const cards = [...main.querySelectorAll<HTMLElement>('.item-card-container')].filter(n => !own(n) && !n.closest('.trade-list-detail-offer') && visible(n));
    return cards.flatMap(node => {
      const anchors = [...node.querySelectorAll<HTMLAnchorElement>('a[href*="/catalog/"]')];
      const ids = anchors.map(a => catalogAssetId(a.getAttribute('href') ?? '', document.baseURI));
      const assetId = ids[0]; const name = node.querySelector<HTMLElement>('.item-card-name')?.textContent?.trim();
      if (!assetId || ids.some(id => id !== assetId) || !name || name.length > 256) return [];
      const rawQuantity = node.getAttribute('data-quantity');
      const quantity = rawQuantity === null ? 1 : /^[1-9]\d{0,3}$/.test(rawQuantity) ? Number(rawQuantity) : undefined;
      if (quantity === undefined || quantity > MAX_QUANTITY) return [];
      return [{ node, item: { assetId, name, quantity, side: 'give' as const } }];
    });
  }
  function cancelCatalog(node: HTMLElement) {
    catalogRequests.set(node, (catalogRequests.get(node) ?? 0) + 1);
    const expiry = catalogExpiry.get(node);
    if (expiry !== undefined) { clearTimeout(expiry); catalogTimers.delete(expiry); catalogExpiry.delete(node); }
  }
  function catalogResults(node: HTMLElement, request: { query: string } | { nearAssetId: string }) {
    cancelCatalog(node);
    const token = (catalogRequests.get(node) ?? 0) + 1; catalogRequests.set(node, token);
    if (catalogPending >= 2) { node.textContent = 'Please wait for current catalog searches.'; return; }
    const version = generation; count.requests++; catalogPending++;
    node.textContent = 'Loading public Limited catalog…';
    let settled = false;
    const finish = (raw: any, error = false) => {
      if (settled) return; settled = true; clearTimeout(timeout); catalogTimers.delete(timeout);
      if (version === generation) catalogPending--;
      if (disposed || version !== generation || token !== catalogRequests.get(node) || !node.isConnected) return;
      const ids = Array.isArray(raw?.quotes) && raw.quotes.length <= 20 ? raw.quotes.map((q: any) => q?.assetId) : [];
      const reply = !error && parseLookupReply(raw, ids);
      node.replaceChildren();
      const unavailable = (text = 'No supported catalog results. Value or source data may be unavailable.') => {
        node.replaceChildren(); const status = document.createElement('span'); status.setAttribute('role', 'status'); status.textContent = text; node.append(status);
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.addEventListener('click', () => catalogResults(node, request)); node.append(retry);
      };
      if (!reply || !reply.ok || !reply.quotes.length) { unavailable(); return; }
      const comparables = 'nearAssetId' in request;
      const evidenceTimes: number[] = [];
      if(comparables){
        const current=priced.find(p=>p.assetId===request.nearAssetId);
        if(!current?.usdQuote||comparableUsd(current.usdQuote,request.nearAssetId)===undefined){unavailable('Current USD estimate expired. Refresh item values.');return;}
        evidenceTimes.push(current.usdQuote.retrievedAt);
      }
      for (const q of reply.quotes.filter(q => !!freshQuote({assetId:q.assetId,name:q.name,side:'give',quantity:1,quote:q})
        && (!comparables || q.assetId !== request.nearAssetId && comparableUsd(reply.usdQuotes?.find(u=>u.assetId===q.assetId),q.assetId) !== undefined)).slice(0, comparables ? 10 : node.closest('.w8rld-native-search') ? 3 : 20)) {
        const fact = reply.facts?.find(f => f.assetId === q.assetId && f.retrievedAt <= Date.now() && Date.now() - f.retrievedAt < QUOTE_FRESH_MS);
        const item:PricedTradeItem={assetId:q.assetId,name:q.name,side:'give',quantity:1,quote:q,usdQuote:reply.usdQuotes?.find(u=>u.assetId===q.assetId),demandQuote:reply.demandQuotes?.find(u=>u.assetId===q.assetId)};
        evidenceTimes.push(q.fetchedAt);
        if (freshUsd(item) !== undefined && (comparables || preferences.showUsd) && item.usdQuote) evidenceTimes.push(item.usdQuote.retrievedAt);
        if (fact) evidenceTimes.push(fact.retrievedAt);
        if (comparables) {
          const card = [...document.querySelectorAll<HTMLElement>('.item-card-container')].find(c => [...c.querySelectorAll<HTMLAnchorElement>('a[href*="/catalog/"]')].some(a => catalogAssetId(a.href) === q.assetId));
          const image = card && safeImage(card);
          node.append(similarItemCard(item,fact,preferences,image));continue;
        }
        const result=limitedSearchRow(item,fact,preferences);
        node.append(result);
      }
      {
        if (!node.children.length) { unavailable(); return; }
        // Clear the entire row at the earliest independent evidence expiry;
        // a fresh explicit retry can recover through a restarted MV3 worker.
        const expiresAt = Math.min(...evidenceTimes) + QUOTE_FRESH_MS;
        const expiry = window.setTimeout(() => {
          catalogTimers.delete(expiry); catalogExpiry.delete(node);
          if (version === generation && token === catalogRequests.get(node) && node.isConnected) unavailable(`${comparables ? 'Comparable' : 'Limited'} values expired. Retry for current data.`);
        }, Math.max(0, expiresAt - Date.now()));
        catalogExpiry.set(node, expiry); catalogTimers.add(expiry);
      }
    };
    const timeout = window.setTimeout(() => finish(undefined, true), 12_000); catalogTimers.add(timeout);
    try { extension.runtime.sendMessage({ type: 'w8rld:catalog-search', ...request }, (raw: unknown) => finish(raw, !!extension.runtime.lastError)); }
    catch { finish(undefined, true); }
  }
  function readEquippedAvatar(main:HTMLElement,cards:ReturnType<typeof cardItems>) {
    const userId=document.querySelector<HTMLMetaElement>('meta[name="user-data"]')?.dataset.userid;
    if(!userId || !portfolioAnchor(main,'avatar')){
      avatarReader.reset();equippedAvatar=undefined;avatarReadKey='';avatarState='unavailable';
      if(avatarExpiry!==undefined)clearTimeout(avatarExpiry);avatarExpiry=undefined;return;
    }
    // Native equipped-marker changes invalidate the complete snapshot. Category
    // navigation may replace these cards; reads remain bounded by the reader.
    const key=JSON.stringify([userId,cards.map(c=>c.item)]);
    if(key===avatarReadKey)return;
    avatarReader.reset();avatarReadKey=key;equippedAvatar=undefined;avatarState='loading';
    if(avatarExpiry!==undefined)clearTimeout(avatarExpiry);avatarExpiry=undefined;
    const version=generation;
    void avatarReader.load().then(result=>{
      if(disposed||suspended||version!==generation||key!==avatarReadKey||companionRoute(location.href)!=='avatar')return;
      equippedAvatar=result;avatarState=result?'ready':'unavailable';
      if(result)avatarExpiry=window.setTimeout(()=>{
        avatarExpiry=undefined;equippedAvatar=undefined;avatarState='expired';schedule();
      },60_000);
      schedule();
    });
  }
  function enhanceItems(main: HTMLElement, kind: ReturnType<typeof companionRoute>) {
    let cards = kind === 'marketplace' && !preferences.marketplace ? [] : cardItems(main);
    // The current native editor marks equipped cards explicitly. Category
    // inventory is not proof of wearing; never sum unequipped inventory here.
    if(kind==='avatar'){
      cards=cards.filter(c=>[...c.node.querySelectorAll('.item-card-equipped')].some(n=>visible(n)&&(!n.hasAttribute('data-item-status')||n.getAttribute('data-item-status')==='equipped')));
      readEquippedAvatar(main,cards);
    }
    let items = kind==='avatar'&&equippedAvatar ? equippedAvatar.items : cards.map(c => c.item);
    const id = kind === 'item' ? catalogAssetId(location.href) : undefined;
    const heading = [...main.querySelectorAll<HTMLElement>('h1')].filter(visible);
    if (id) items = [{ assetId: id, name: 'Limited item', quantity: 1, side: 'give' }];
    lookup(items);
    const seen = new Set<HTMLElement>();
    for (const { node, item } of cards) {
      const p = priced.find(i => i.assetId === item.assetId); if (!p?.quote && !p?.usdQuote) continue;
      const tagHost = cardTagsAnchor(node);
      if (tagHost && preferences.itemFlags && itemTags(p).length) {
        seen.add(tagHost); region(tagHost, `tags:${JSON.stringify(p.quote)}`, () => {
          const tags = ownedRegion('Limited item classifications'); tags.classList.add('w8rld-card-tags'); tags.append(...itemTags(p)); return tags;
        });
      }
      seen.add(node); const annotation = region(node, JSON.stringify([p, preferences.itemFlags, !!tagHost]), () => {
        const nativePrice = [...node.querySelectorAll<HTMLElement>('.item-card-price')].find(n=>!own(n));
        // Shared card price classes also represent asking prices. Only an
        // explicit RAP label proves that this generic card already shows RAP;
        // the separately verified completed-trade contract is handled there.
        const nativeRap = !!nativePrice && visible(nativePrice)
          && /\brap\b|recent average price/i.test(`${nativePrice.getAttribute('aria-label') ?? ''} ${nativePrice.textContent ?? ''}`);
        const result = itemValues(p, preferences.itemFlags && !tagHost, nativeRap, false, preferences);
        const acquired = node.querySelector('time[datetime][aria-label="Acquired"]');
        const date = preferences.acquisitionDates && acquired && visible(acquired) ? exactTimestamp(acquired.getAttribute('datetime')) : undefined;
        if (date !== undefined) { const line = document.createElement('time'); line.dateTime = new Date(date).toISOString(); line.textContent = `Owned since ${new Date(date).toISOString().slice(0, 10)}`; line.title = `Acquisition timestamp · ${ageLabel(date)}`; result.append(line); }
        return result;
      });
      placeCardValues(node, annotation);
    }
    if (id && heading.length) {
      const p = priced.find(i => i.assetId === id); const q = p && freshQuote(p);
      // Current native item pages also contain recommendation headings. Bind
      // only the unique heading matching this canonical asset's provider name.
      const nativeIdentity = main.querySelector('#favorites-button')?.getAttribute('data-asset-id') === id;
      const marker = main.querySelector('#favorites-button')?.getAttribute('data-asset-id');
      const matches = heading.filter(n => (!marker || nativeIdentity) && (q ? n.textContent?.trim() === q.name : nativeIdentity && !!n.closest('.item-details-info-content')));
      const title = matches[0];
      if (p && (q || freshUsd(p) !== undefined) && matches.length === 1 && !title.closest('a,button,form,[role="button"]')) {
        const price = itemPriceAnchor(main, title, visible); const anchor = price.summary;
        if(preferences.itemFlags&&itemTags(p).length){
          seen.add(title);region(title,`flags:${q?.fetchedAt}:${q?.projected}:${q?.rare}`,()=>{const badges=ownedRegion('Limited item classifications');badges.classList.add('w8rld-item-identity-tags');badges.append(...itemTags(p));return badges;},true);
        }
        const estimate = displayUsd(p, preferences); const usd = estimate.value; const usdInline = preferences.showUsd && !!price.usd && usd !== undefined;
        if (price.usd && usdInline) {
          seen.add(price.usd); region(price.usd, `usd:${usd}`, () => {
            const node = ownedRegion('USD estimate'); node.classList.add('w8rld-price-usd');
            const value = document.createElement('span'); value.textContent = usdAmount(usd!, {symbol:false,compact:preferences.compactNumbers}); value.title = `Unrounded ${usdExact(usd!)}`; node.setAttribute('aria-label', value.title); node.append(dollarIcon(),value);
            if(estimate.method==='rap-estimate'){const label=document.createElement('small');label.textContent='RAP estimate';node.append(label);}
            node.dataset.usdMethod = estimate.method; node.title = usdDescription(estimate.method, preferences.usdPerThousandRobux); return node;
          }, true);
        }
        seen.add(anchor); const research=region(anchor, JSON.stringify([p, facts, preferences, price.nativePrice]), () => {
          const fact = facts.find(f => f.assetId === id && f.retrievedAt <= Date.now() && Date.now() - f.retrievedAt < QUOTE_FRESH_MS);
          const labels=[...main.querySelectorAll<HTMLElement>('.item-details-info-content .item-details-section > .item-info-row-container > .row-label')]
            .filter(n=>visible(n)&&!n.closest('[data-w8rld-owned]')).map(n=>(n.textContent??'').trim().replace(/:$/,''));
          const node = itemResearch(p, fact, false, usdInline, price.nativePrice, preferences, labels);
          return node;
        }, true);
        if(preferences.showUsd&&(!historyView||historyView.node.parentElement!==research)){historyView?.dispose();historyView=itemHistoryView(extension,id,comparableUsd(p.usdQuote,id));research.append(historyView.node);}
        const nativeSellers = itemSellersAnchor(main, visible);
        // RoUtility content.js::markDeals, limited to visible exact native asks.
        if (nativeSellers && preferences.lowestListing && q?.rap && q.rap > 0) {
          for (const row of nativeSellers.querySelectorAll<HTMLElement>('li.reseller-item')) {
            const prices = row.querySelectorAll<HTMLElement>('.resale-info .reseller-price-container');
            if (prices.length !== 1 || !visible(prices[0]) || prices[0].querySelector('a,button,input,select,form') || prices[0].closest('a,button,form,[role="button"]')) continue;
            const leaves = prices[0].querySelectorAll<HTMLElement>('.text-robux');
            const askNode = leaves.length === 1 ? leaves[0] : !prices[0].children.length ? prices[0] : undefined;
            const ask = askNode && visible(askNode) ? exactRobux(askNode.innerText) : undefined;
            if (ask === undefined || ask < 0) continue;
            const percent = (ask-q.rap)/q.rap*100; seen.add(prices[0]);
            region(prices[0], `reseller:${ask}:${q.rap}:${q.fetchedAt}`, () => {
              const note = ownedRegion('Reseller asking price versus RAP'); note.classList.add('w8rld-reseller-comparison','font-caption-body');
              note.textContent = percent === 0 ? 'At RAP' : `${Math.abs(percent).toLocaleString('en-US',{maximumFractionDigits:1})}% ${percent < 0 ? 'under' : 'over'} RAP`;
              note.title = `Asking price R$ ${ask.toLocaleString('en-US')}; RAP R$ ${q.rap!.toLocaleString('en-US')}. Listing, not a completed sale.`; return note;
            }, true);
          }
        }
        const targetUsd = comparableUsd(p.usdQuote, id);
        const sellers = preferences.similarItems && targetUsd !== undefined && targetUsd > 0 ? nativeSellers : undefined;
        if (sellers) {
          seen.add(sellers);
          const section = region(sellers, `similar:${id}:${p.usdQuote!.retrievedAt}`, () => {
            comparison?.dispose(); const node = ownedRegion('Similar Price');
            comparison = itemComparison(node, results => catalogResults(results, { nearAssetId: id }),
              cancelCatalog);
            return node;
          }, true);
          if (sellers.nextElementSibling !== section) sellers.after(section);
        } else { comparison?.dispose(); comparison = undefined; }
        if (!itemTimeline.some(t => t.event === 'visible')) markItem('visible');
      } else if (matches.length === 1 && nativeIdentity && !title.closest('a,button,form,[role="button"]')) {
        const price = itemPriceAnchor(main, title, visible);
        // Best Price is the observed Limited layout. Never put status text in
        // purchase controls or construct a replacement for missing native DOM.
        if (price.usd) {
          comparison?.dispose(); comparison = undefined;
          seen.add(price.summary); region(price.summary, `item-status:${lookupState}`, () => {
            const node = ownedRegion('Item values'); node.classList.add('w8rld-item-status'); node.setAttribute('role', 'status');
            node.textContent = lookupState === 'loading' ? 'Loading item values…' : expiredLookupKey ? 'Item values expired. ' : 'Item values unavailable.';
            if (expiredLookupKey) node.append(lookupRetry()); return node;
          }, true);
        }
      }
    }
    if ((kind === 'inventory' || kind === 'profile' || kind === 'avatar') && (items.length || kind==='avatar'&&!!avatarReadKey)) {
      const nativeAnchor = portfolioAnchor(main, kind);
      const anchor = nativeAnchor ?? main; seen.add(anchor);
      const summary = region(anchor, JSON.stringify([items, priced, preferences, kind,kind==='avatar'&&avatarState,kind==='avatar'&&equippedAvatar?.retrievedAt]), () => {
        const node = ownedRegion(kind==='avatar'?'Visible equipped Limited values':'Visible Limited inventory research'); node.classList.add('w8rld-search', 'w8rld-portfolio-totals');node.dataset.portfolioScope=kind==='avatar'?'equipped':'visible';
        if(kind==='avatar') {
          const heading=document.createElement('div');heading.className='text-label content-default w8rld-avatar-values-head';heading.textContent='Equipped values';node.append(heading);
          node.dataset.equippedSource=equippedAvatar?'native-avatar':'visible-cards';
          if(!equippedAvatar&&avatarReadKey){
            const status=document.createElement('small');status.setAttribute('role','status');status.textContent=avatarState==='loading'?'Loading equipped items…':avatarState==='expired'?'Equipped values expired.':'Equipped items unavailable.';node.append(status);
            if(avatarState!=='loading'){const retry=document.createElement('button');retry.type='button';retry.className='text-link';retry.textContent='Retry';retry.addEventListener('click',()=>{avatarReadKey='';schedule();});node.append(retry);}
          }
          if(equippedAvatar&&!items.length){const empty=document.createElement('small');empty.textContent='No equipped items.';node.append(empty);return node;}
        }
        const covered = items.map(item => { const p = priced.find(i => i.assetId === item.assetId); return { ...item, quote: p && freshQuote(p), usdQuote: p?.usdQuote,demandQuote:p?.demandQuote }; });
        const matched = covered.filter(i=>i.quote || displayUsd(i,preferences).value!==undefined);
        const totals = analyzeTrade(covered).give;
        const valuation=displayValueTrade(covered,false,preferences);const valueTotals=valuation.give;
        const estimate = visibleUsdSubtotal(covered, preferences); const usd = estimate.value;
        const values = document.createElement('dl'); values.className = 'w8rld-profile-values';
        // Adapt upstream profile.js::pillSet's adjacent native summary pills,
        // retaining W8RLD's visible-only scope and independent copy coverage.
        const scope = kind === 'profile' ? 'Visible' : 'Total';
        if (kind === 'profile') node.classList.add('w8rld-profile-summary');
        for (const [key, name, value, shown, count, total] of [['rap', `${scope} RAP`, totals.rapCovered ? displayNumber(totals.rap, preferences.compactNumbers) : 'N/A', preferences.showRap, totals.rapCovered, totals.itemCount],
          ['value', `${scope} ${valuation.label}`, valueTotals.covered ? displayNumber(valueTotals.value, preferences.compactNumbers) : 'N/A', preferences.showValue, valueTotals.covered, totals.itemCount],
          ['usd', kind === 'profile' ? 'Visible USD estimate' : 'Total $', usd === undefined || usd > Number.MAX_SAFE_INTEGER ? 'N/A' : usdAmount(usd, { symbol: false, compact:preferences.compactNumbers }), preferences.showUsd, estimate.covered, estimate.total]] as const) {
          if (!shown) continue;
          const metric = document.createElement('div'); const title = document.createElement('dt'); title.textContent = `${name} `;
          metric.dataset.metric = key;
          const amount = document.createElement('dd');if(value!=='N/A')amount.append(key==='usd'?dollarIcon():nativeRobuxIcon());amount.append(document.createTextNode(`${value} `));metric.append(title, amount);
          if (kind === 'profile') {
            const coverage = document.createElement('small'); coverage.textContent = `${count}/${total} visible copies`;
            metric.append(coverage); metric.title = count ? `${name}: partial subtotal from ${count} of ${total} visible copies. Unseen inventory is not included.`
              : `${name}: no fresh provider observations for these visible copies${pending ? '; loading values' : ''}.`;
          }
          if (key === 'usd' && usd !== undefined) metric.title = `${metric.title} Unrounded subtotal: ${usdExact(usd)}.`;
          values.append(metric);
        }
        const label = document.createElement('small'); label.textContent = kind==='avatar'&&equippedAvatar
          ? `RAP ${totals.rapCovered}/${totals.itemCount} · ${valuation.label} ${valueTotals.covered}/${totals.itemCount} · $ ${estimate.covered}/${estimate.total} equipped items covered.`
          : `Partial · ${matched.length}/${cards.length} visible cards matched. RAP ${totals.rapCovered}/${totals.itemCount}; ${valuation.label} ${valueTotals.covered}/${totals.itemCount}; $ ${estimate.covered}/${estimate.total} visible copies covered. ${kind==='avatar'?'Visible equipped items only; other worn items unverified.':'Visible copies only; unseen inventory unverified.'}`;
        label.title=`${valuation.description} Curated ${valueTotals.curatedCovered}; RAP estimated ${valueTotals.rapCovered}. RAP and dollar estimates retain independent coverage.`;
        values.setAttribute('aria-label', [preferences.showRap ? `${scope} RAP ${totals.rapCovered ? totals.rap.toLocaleString('en-US') + ' R$' : 'N/A'}` : '', preferences.showValue ? `${scope} ${valuation.label} ${valueTotals.covered ? valueTotals.value.toLocaleString('en-US') + ' R$' : 'N/A'}` : '', preferences.showUsd ? `${scope} USD estimate unrounded ${usd === undefined ? 'N/A' : usdExact(usd)}` : '', 'Partial visible coverage.'].filter(Boolean).join('; '));values.hidden=!values.children.length; values.dataset.usdMethod = estimate.method; values.title = usdDescription(estimate.method, preferences.usdPerThousandRobux); node.append(values, label);
        if (expiredLookupKey) { const status = document.createElement('small'); status.setAttribute('role','status'); status.textContent = 'Item values expired. '; status.append(lookupRetry()); node.append(status); }
        if (kind === 'avatar') { const tiles = avatarValueTiles(covered, facts, preferences); if (tiles) node.append(tiles); }
        if (kind!=='avatar' && (preferences.inventorySearch || preferences.inventorySort || preferences.inventoryLimitedFilter)) {
          const search = document.createElement('input'); search.type = 'search'; search.maxLength = 100; search.placeholder = 'Search visible items'; search.setAttribute('aria-label', 'Search visible inventory by name, acronym or asset ID'); search.hidden = !preferences.inventorySearch;
          const limited = document.createElement('input'); limited.type = 'checkbox'; limited.setAttribute('aria-label', 'Limiteds only');
          const limitedLabel = document.createElement('label'); limitedLabel.textContent = 'Limiteds only '; limitedLabel.hidden = !preferences.inventoryLimitedFilter; limitedLabel.append(limited);
          const sort = document.createElement('select'); sort.setAttribute('aria-label', 'Order local results'); sort.hidden = !preferences.inventorySort;
          for (const text of ['Name', 'RAP', 'Value', '$']) { const option = document.createElement('option'); option.textContent = text; sort.append(option); }
          search.value = inventoryState.query; sort.value = inventoryState.sort; limited.checked = inventoryState.limited;
          const results = document.createElement('div');
          const resultStatus = document.createElement('small'); resultStatus.className = 'w8rld-inventory-status'; resultStatus.setAttribute('role','status');
          const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Show more visible items';
          const update = () => {
            const query = search.value.trim().toLowerCase();
            const matching = cards.filter(c => { const p = priced.find(i => i.assetId === c.item.assetId); const q = p && freshQuote(p); return (!limited.checked || !!q) && loadedItemMatches(query,{...c.item,acronym:q?.acronym}); });
            const value = (id: string) => { const p = priced.find(i => i.assetId === id); return sort.value === 'RAP' ? freshQuote(p ?? { assetId: id, name: '', side: 'give', quantity: 1 })?.rap : sort.value === 'Value' ? p && displayValue(p,preferences).value : p && displayUsd(p, preferences).value; };
            matching.sort((a, b) => sort.value === 'Name' ? a.item.name.localeCompare(b.item.name) : (value(b.item.assetId) ?? -1) - (value(a.item.assetId) ?? -1) || a.item.name.localeCompare(b.item.name));
            results.replaceChildren(...matching.slice(0, inventoryState.shown).map(c => { const a = document.createElement('a'); a.href = `/catalog/${c.item.assetId}`; a.textContent = preferences.privacyMode ? 'Limited item' : c.item.name; return a; }));
            resultStatus.textContent = `${Math.min(inventoryState.shown,matching.length)} of ${matching.length} matching visible cards.`; more.hidden = matching.length <= inventoryState.shown;
            if (!matching.length) results.textContent = 'No matching visible items.';
          };
          const change = () => { inventoryState = {query:search.value,sort:sort.value,limited:limited.checked,shown:20}; update(); };
          search.addEventListener('input', change); sort.addEventListener('change', change); limited.addEventListener('change', change);
          more.addEventListener('click', () => { inventoryState.shown += 20; update(); });
          if (kind === 'profile') {
            const tools = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Search visible items';
            tools.append(summary, search, limitedLabel, sort, resultStatus, results, more); node.append(tools);
          } else node.append(search, limitedLabel, sort, resultStatus, results, more);
          update();
        }
        return node;
      }, !!nativeAnchor&&kind!=='avatar');
      if (nativeAnchor&&kind==='avatar') { if(summary.parentElement!==nativeAnchor)nativeAnchor.append(summary); }
      else if (nativeAnchor) { if (nativeAnchor.nextElementSibling !== summary) nativeAnchor.after(summary); }
      else if (main.firstElementChild !== summary) main.prepend(summary);
    }
    if (comparison && !seen.has(comparison.host.previousElementSibling as HTMLElement)) { comparison.dispose(); comparison = undefined; }
    for (const [anchor, r] of regions) if (!seen.has(anchor)) { r.node.remove(); regions.delete(anchor); }
    if(historyView&&!historyView.node.isConnected){historyView.dispose();historyView=undefined;}
    observeAlerts();
  }
  function observeAlerts() {
    const p = priced.find(i => i.assetId === preferences.alertAssetId); if (!p) return;
    const q = freshQuote(p); const value = preferences.alertMetric === 'rap' ? q?.rap : preferences.alertMetric === 'value' ? q?.estimatedValue : p.usdQuote?.freshness === 'fresh' ? p.usdQuote.value : undefined;
    for (const kind of ['price', 'market'] as const) if ((kind === 'price' ? preferences.priceAlerts && value !== undefined && value >= preferences.alertThreshold : preferences.marketAlerts && value !== undefined)) {
      const key = `${kind}:${p.assetId}:${value}`; if (sentAlerts.has(key)) continue; sentAlerts.add(key);
      try { extension.runtime.sendMessage({ type: 'w8rld:notify', kind, assetId: p.assetId }, () => { void extension.runtime.lastError; }); } catch { /* Notification remains optional. */ }
    }
  }
  function privacy(main: HTMLElement) {
    if (!preferences.privacyMode && masks.size) clearMasks();
    if (!preferences.hideSerials && !preferences.privacyMode) { for (const n of serials) n.removeAttribute('data-w8rld-serial-hidden'); serials.clear(); }
    const serialText = (n: HTMLElement) => {
      const text = n.textContent?.trim() ?? '';
      const serial = n.hasAttribute('data-serial-number') && /^#?\d+$/.test(text)
        || /^Serial\s*:?\s*#\d+$/i.test(text) || /^serial(?: number)?$/i.test(n.getAttribute('aria-label') ?? '') && /^#?\d+$/.test(text);
      return !n.children.length && serial && !own(n) && !!n.closest('.item-card-container,.trade-item-card');
    };
    for (const n of serials) if (!n.isConnected || !serialText(n)) { n.removeAttribute('data-w8rld-serial-hidden'); serials.delete(n); }
    if (preferences.hideSerials || preferences.privacyMode) for (const n of main.querySelectorAll<HTMLElement>('.item-card-container :is(span,div),.trade-item-card :is(span,div)')) {
      if (visible(n) && serialText(n)) { n.dataset.w8rldSerialHidden = ''; serials.add(n); }
    }
    if (!preferences.privacyMode) return;
    const candidates = [
      ...(preferences.maskNames ? [...main.querySelectorAll<HTMLElement>('a[href*="/users/"],.trade-row .text-lead')] : []),
      // Pinned RoUtility streamer selector, confirmed in the disposable current
      // Roblox header. Mask the visible leaf; never inspect its balance value.
      ...(preferences.maskBalances ? [...document.querySelectorAll<HTMLElement>('#navbar-robux #nav-robux-amount'), ...main.querySelectorAll<HTMLElement>('[data-robux-balance]')] : []),
    ].slice(0, 300);
    for (const n of candidates) {
      if (!visible(n) || n.querySelector('input,button') || own(n)) continue;
      if (masks.has(n) && n.hasAttribute('data-w8rld-mask')) continue;
      masks.set(n, { attribute: n.getAttribute('data-w8rld-mask'), title: n.getAttribute('title'), aria: n.getAttribute('aria-label') });
      n.dataset.w8rldMask = ''; if (n.hasAttribute('title')) n.removeAttribute('title'); n.setAttribute('aria-label', 'Hidden in privacy mode');
    }
  }
  function enhanceSemanticFacts(main: HTMLElement, kind: ReturnType<typeof companionRoute>) {
    const allowed = kind === 'profile' ? ['followers', 'following', 'created', 'join date'] : kind === 'community' ? ['members', 'created', 'role', 'rank', 'description']
      : kind === 'experience' ? ['visits', 'active', 'players', 'updated', 'avatar type', 'created', 'store items'] : ['renewal date', 'subscription cost', 'savings'];
    const anchor = main.querySelector<HTMLElement>('dl'); if (!anchor) return;
    const rows = publicFacts(main, allowed);
    if (!rows.length) { regions.get(anchor)?.node.remove(); regions.delete(anchor); return; }
    region(anchor, JSON.stringify([rows, preferences.privacyMode]), () => { const node = ownedRegion('Visible public information'); for (const row of rows) { const span = document.createElement('span'); span.textContent = `${row.label}: ${preferences.privacyMode ? 'Hidden' : row.value}`; node.append(span); } return node; }, true);
  }
  function enhanceFriends(main: HTMLElement, members = false) {
    // RoUtility communities.js::placeFinder anchors to Roblox's Members
    // RoUtility placeFinder/findRow native placement. Loaded filtering remains;
    // Enter resolves an exact public user and role with optional anonymous GETs.
    const modals = members ? [...document.querySelectorAll<HTMLElement>('.user-list-modal-content')].filter(n => visible(n) && n.querySelector('.user-list-modal-title-bar-title')?.textContent?.trim() === 'Members') : [];
    const modal = modals.length === 1 ? modals[0] : undefined;
    const nativeFilter = modal?.querySelector<HTMLElement>('.filter-selector-container');
    const lists = modal && nativeFilter ? [modal] : [...main.querySelectorAll<HTMLElement>('ul,[role="list"]')].filter(n => visible(n) && !own(n) && n.children.length <= 200 && [...n.children].some(c => c.querySelector('a[href*="/users/"][href*="/profile"]')));
    const anchor = nativeFilter ?? lists[0];
    for (const [previous, entry] of regions) if (refreshTools.has(entry.node) && (lists.length !== 1 || previous !== anchor)) { entry.node.remove(); regions.delete(previous); }
    if (socialRoot !== modal) { socialObserver.disconnect(); socialRoot = modal; if (modal) socialObserver.observe(modal, {childList:true,subtree:true,characterData:true}); }
    if (lists.length !== 1) return;
    const list = lists[0]; if ([...list.querySelectorAll('a[href*="/users/"][href*="/profile"]')].filter(n => !own(n)).length > 200) return;
    const tools = region(anchor, `friends-search:${preferences.privacyMode}:${preferences.friendFilters}:${members}`, () => {
      const node = ownedRegion('Search loaded public friends'); const input = document.createElement('input'); input.type = 'search'; input.maxLength = 100; input.setAttribute('aria-label', 'Search loaded friend list'); input.placeholder = 'Search loaded friends'; const results = document.createElement('div');results.className='w8rld-member-results';
      if (members) { node.classList.add('w8rld-member-search');node.setAttribute('aria-label', 'Search loaded public community members'); input.setAttribute('aria-label', 'Search loaded community members'); input.placeholder = 'Search loaded members'; }
      const filter = document.createElement('select'); filter.setAttribute('aria-label', 'Loaded friend status'); filter.hidden = members || !preferences.friendFilters;
      for (const label of ['All', 'Online', 'In Experience', 'Offline']) { const option = document.createElement('option'); option.textContent = label; filter.append(option); }
      const status=document.createElement('small');status.setAttribute('role','status');
      let publicMode=false;let memberVersion=0;let memberPending=false;let memberTimer:number|undefined;
      const more=document.createElement('button');more.type='button';more.textContent='Show more loaded results';more.hidden=true;let shown=20;let lastQuery='';
      const update = () => { if(publicMode||input.matches(':focus')&&input.dataset.w8rldComposing==='true')return; const query = input.value.trim().toLowerCase();if(query!==lastQuery){shown=20;lastQuery=query;}
        const unique=new Map<string,HTMLAnchorElement>();
        for(const n of list.querySelectorAll<HTMLAnchorElement>('a[href*="/users/"][href*="/profile"]')) {
          if(own(n)||!visible(n)||!n.textContent?.trim())continue;
          try{const u=new URL(n.href);if(u.origin===location.origin&&/^\/users\/[1-9]\d*\/profile\/?$/.test(u.pathname)&&!u.search&&!u.hash&&!unique.has(u.pathname))unique.set(u.pathname,n);}catch{/* Unknown identity is not a result. */}
        }
        const links = [...unique.values()].filter(n => {
        const card = n.closest('.avatar-card,li'); const statuses = card && [...card.querySelectorAll<HTMLElement>('.avatar-card-label')].filter(visible).map(l => l.innerText.trim());
        const haystack=`${n.textContent?.trim().toLowerCase()} ${new URL(n.href).pathname.split('/')[2]}`;
        return query.split(/\s+/).every(word=>haystack.includes(word)) && (filter.selectedIndex === 0 || !!statuses?.includes(filter.value));
      });
        const active=!!query||!!filter.selectedIndex;more.hidden=!active||links.length<=shown;
        const key=JSON.stringify([active,shown,preferences.privacyMode,links.map(n=>[n.pathname,n.textContent])]);
        if(results.dataset.resultKey!==key){results.dataset.resultKey=key;results.replaceChildren(...(active?links.slice(0,shown).map(n=>{const a=document.createElement('a');a.className='user-item-clickable text-body-medium';a.href=new URL(n.href).pathname;a.textContent=preferences.privacyMode?'Public profile':n.textContent?.trim()??'';return a;}):[]));if(active&&!links.length)results.textContent='No matching loaded public records.';}
        status.textContent=active?`${Math.min(shown,links.length)} of ${links.length} matching loaded public members.`:members&&!unique.size?'Loading native public members…':'';
      };
      const cancel=()=>{memberVersion++;publicMode=false;node.removeAttribute('aria-busy');if(memberTimer!==undefined){clearTimeout(memberTimer);catalogTimers.delete(memberTimer);memberTimer=undefined;}if(memberPending)try{extension.runtime.sendMessage({type:'w8rld:community-member-cancel'},()=>{void extension.runtime.lastError;});}catch{/* Navigation teardown. */}memberPending=false;};
      const changed=()=>{cancel();delete results.dataset.resultKey;update();};
      const lookup=()=>{
        const query=memberQuery(input.value);const groupId=/^\/(?:communities|groups)\/([1-9]\d*)(?:\/[^/]+)?\/?$/.exec(location.pathname)?.[1];
        if(!members||!query||!groupId||preferences.privacyMode){status.textContent=preferences.privacyMode?'Public lookup is paused in Privacy mode.':'Enter an exact username or canonical user ID.';return;}
        cancel();const version=memberVersion,url=location.href;publicMode=true;memberPending=true;more.hidden=true;results.replaceChildren();status.textContent='Checking public membership…';node.setAttribute('aria-busy','true');
        const finish=(raw:unknown)=>{if(!memberPending||version!==memberVersion)return;if(raw===undefined)try{extension.runtime.sendMessage({type:'w8rld:community-member-cancel'},()=>{void extension.runtime.lastError;});}catch{/* Timeout cancellation. */}memberPending=false;node.removeAttribute('aria-busy');if(memberTimer!==undefined){clearTimeout(memberTimer);catalogTimers.delete(memberTimer);memberTimer=undefined;}
          if(disposed||!enabled||!preferences.communitySearch||!node.isConnected||!visible(node)||location.href!==url||memberQuery(input.value)!==query)return;
          const reply=parseMemberReply(raw,groupId,query);results.replaceChildren();
          if(!reply){status.textContent='Public lookup unavailable. Grant member access in Extension Settings or try again shortly.';return;}
          if(!reply.user){status.textContent='No exact public username found. Try the canonical user ID.';return;}
          // Native findRow names + role hierarchy; no invented headshot or rank.
          const a=document.createElement('a');a.className='user-item-clickable w8rld-member-public';a.href=`/users/${reply.user.id}/profile`;
          const names=document.createElement('div');names.className='grow-1 clip text-truncate-split';const name=document.createElement('div');name.className='text-title-medium user-item-display-name-row';name.textContent=reply.user.displayName;
          const username=document.createElement('span');username.className='text-body-medium';username.textContent='@'+reply.user.name;names.append(name,username);
          const role=document.createElement('span');role.className='text-label-medium w8rld-member-role';role.textContent=reply.user.role?`${reply.user.role.name} · Rank ${reply.user.role.rank}`:'No public membership reported';a.append(names,role);results.append(a);status.textContent='Public membership checked; native member list preserved.';
          memberTimer=window.setTimeout(()=>{cancel();results.replaceChildren();delete results.dataset.resultKey;status.textContent='Public membership observation expired. Press Enter to check again.';},Math.max(0,60000-(Date.now()-reply.retrievedAt)));catalogTimers.add(memberTimer);
        };
        memberTimer=window.setTimeout(()=>finish(undefined),10000);catalogTimers.add(memberTimer);
        try{extension.runtime.sendMessage({type:'w8rld:community-member',groupId,query},(raw:unknown)=>{const error=extension.runtime.lastError;finish(error?undefined:raw);});}catch{finish(undefined);}
      };
      input.addEventListener('compositionstart',()=>{cancel();input.dataset.w8rldComposing='true';});input.addEventListener('compositionend',()=>{delete input.dataset.w8rldComposing;changed();});
      input.addEventListener('input',changed);filter.addEventListener('change',changed);more.addEventListener('click',()=>{shown+=20;update();});
      node.addEventListener('keydown',event=>{if(event.isComposing||input.dataset.w8rldComposing==='true')return;const links=[...results.querySelectorAll('a')];const index=links.indexOf(document.activeElement as HTMLAnchorElement);if(event.key==='Enter'&&event.target===input&&members){event.preventDefault();lookup();}else if(event.key==='Escape'){event.preventDefault();input.value='';changed();input.focus();}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){const next=event.target===input?(event.key==='ArrowDown'?0:links.length-1):index+(event.key==='ArrowDown'?1:-1);if(links[next]){event.preventDefault();links[next].focus();links[next].scrollIntoView({block:'nearest'});}}});
      const note = document.createElement('small'); note.textContent = members?'Filter loaded members, or press Enter for exact public username/ID membership and rank. Optional member access is required; private data is unavailable.':'Loaded visible records only. Use native scrolling to load more.';
      if(members){const field=document.createElement('div');field.className='foundation-web-input w8rld-member-field';const icon=document.createElement('span');icon.className='icon icon-regular-magnifying-glass';icon.setAttribute('aria-hidden','true');field.append(icon,input);node.append(field);memberNode=node;cancelMember=()=>{cancel();node.removeAttribute('aria-busy');results.replaceChildren();delete results.dataset.resultKey;update();};}else node.append(input);
      node.append(filter, note, status, results, more); refreshTools.set(node, update); return node;
    }, true);
    refreshTools.get(tools)?.();
  }
  function enhanceTransactions(main: HTMLElement) {
    const table = [...main.querySelectorAll('table')].find(t => visibleTransactions(t) !== undefined); if (!table) return;
    const rows = visibleTransactions(table)!; region(table, JSON.stringify([rows, preferences.privacyMode]), () => {
      const node = ownedRegion('Local transaction analysis'); const search = document.createElement('input'); search.type = 'search'; search.maxLength = 100; search.setAttribute('aria-label', 'Search visible transactions');
      const filter = document.createElement('select'); filter.setAttribute('aria-label', 'Transaction status');
      for (const text of ['All', 'Completed', 'Pending / unknown']) { const option = document.createElement('option'); option.textContent = text; filter.append(option); }
      const output = document.createElement('div'); output.setAttribute('role', 'status');
      const update = () => { const q = search.value.trim().toLowerCase(); const matched = rows.filter(r => [r.description, r.item, r.creator, r.experience].some(t => t?.toLowerCase().includes(q)) && (filter.selectedIndex === 0 || filter.selectedIndex === 1 ? filter.selectedIndex === 0 || !r.pending : r.pending)); const t = transactionSummary(matched);
        output.replaceChildren(); if (!t) { output.textContent = 'Totals unavailable: arithmetic limit exceeded.'; return; }
        const summary = document.createElement('p'); summary.textContent = preferences.privacyMode ? 'Transaction amounts hidden in privacy mode.' : `Partial · ${matched.length} loaded records · Completed net ${signedNumber(t.net)} R$ · Spending ${t.spent.toLocaleString()} R$ · Pending / unknown ${signedNumber(t.pending)} R$`; output.append(summary);
        if (!preferences.privacyMode) for (const [label, groups] of [['Month', t.months], ['Item', t.byItem], ['Creator', t.byCreator], ['Experience', t.byExperience]] as const) for (const [key, amount] of groups) { const n = document.createElement('small'); n.textContent = `${label} ${key}: ${amount.toLocaleString()} R$ spent`; output.append(n); }
      }; search.addEventListener('input', update); filter.addEventListener('change', update); node.append(search, filter, output); update(); return node;
    }, true);
  }
  function proof(view: TradeView) {
    const native = inspectNativeTrade(document); const anchor = native.sides.find(s => s.side === 'receive')?.total; if (!anchor) return;
    region(anchor, `proof:${JSON.stringify([view.items, preferences.privacyMode])}`, () => {
      const node = ownedRegion('Local trade proof'); const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Create proof image'; button.prepend(proofImageIcon()); const result = document.createElement('span');
      button.addEventListener('click', () => {
        const lines = ['W8RLD · Limited item comparison', 'Provider observations, not verified settlement', ...(['give', 'receive'] as const).flatMap(side => [side === 'give' ? 'GIVING' : 'RECEIVING', ...view.items.filter(i => i.side === side).map(i => `${preferences.privacyMode ? 'Limited item' : i.name} ×${i.quantity}`)]), tradeMetrics(view).text, 'Partial components · excludes unverified Robux', new Date().toISOString()];
        const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = Math.min(6000, 120 + lines.length * 30); const ctx = canvas.getContext('2d'); if (!ctx) return;
        ctx.fillStyle = '#171719'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#f1f1f2'; ctx.font = '18px system-ui'; lines.forEach((line, i) => ctx.fillText(line.slice(0, 110), 28, 40 + i * 30, 940));
        canvas.toBlob(blob => { if (!blob || disposed || !node.isConnected) return; if (proofUrl) URL.revokeObjectURL(proofUrl); proofUrl = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = proofUrl; link.download = 'w8rld-limited-comparison.png'; link.textContent = 'Save proof PNG'; result.replaceChildren(link); }, 'image/png');
      }); node.append(button, result); return node;
    }, true);
  }
  function scan() {
    if (disposed || suspended) return;
    if(memberNode&&!memberNode.isConnected){cancelMember();memberNode=undefined;cancelMember=()=>{};}
    if (comparison && !comparison.host.isConnected) { comparison.dispose(); comparison = undefined; }
    count.scans++;
    if (route !== location.href) { route = location.href; reset(); observe(); }
    if (openPreview && (!openPreview.row.isConnected || !visible(openPreview.row) || openPreview.context !== syncTradeContext() || openPreview.fingerprint !== fingerprint(openPreview.row))) closePreview('identity');
    if (itemPreview && (!itemPreview.target.isConnected || !visible(itemPreview.target) || catalogAssetId(itemPreview.target.getAttribute('href') ?? '',document.baseURI) !== itemPreview.assetId)) closeItemPreview();
    if (!enabled) { localTools.update(); return; }
    for (const [anchor, r] of regions) if (!anchor.isConnected || !visible(anchor)) { r.node.remove(); regions.delete(anchor); }
    const kind = companionRoute(location.href); const main = document.querySelector<HTMLElement>('main');
    if (kind !== 'avatar') rememberedSection = '';
    nativeSearch.setEnabled(enabled && preferences.smartSearch && !!kind);
    if (!main || !kind) { reset(); return; }
    localTools.update(preferences);
    publicInfo.update(preferences, main, kind);
    if (kind === 'trades' && preferences.tradeCalculator && inspectNativeTrade(document).status === 'PASS') {
      const roots = main.querySelectorAll<HTMLElement>('.trades-list-detail');
      if (roots.length === 1 && !calculator?.node.isConnected) { calculator?.dispose(); calculator = tradeCalculator(extension, preferences); inheritSurface(calculator.node, roots[0]); roots[0].append(calculator.node); }
    } else { calculator?.dispose(); calculator = undefined; }
    // Roblox may replace main first and mount its item subtree later. Follow
    // the new root before that later mutation, while retaining cached quotes.
    if (main !== observedMain) observe();
    if (kind === 'item' && main.querySelector('.item-details-info-content h1') && !itemTimeline.some(t => t.event === 'native-dom-ready')) markItem('native-dom-ready');
    if (kind === 'trades') enhanceTradeList();
    if (kind === 'item' && preferences.itemPages || kind === 'marketplace' && (preferences.marketplace || preferences.smartSearch) || kind === 'inventory' && preferences.inventory || kind === 'profile' && preferences.profileTotals || kind === 'avatar' && preferences.avatar) enhanceItems(main, kind);
    if (kind === 'profile' && preferences.profileFacts || kind === 'community' && preferences.communityFacts || kind === 'experience' && preferences.experienceFacts || kind === 'subscription' && preferences.subscriptionInfo) enhanceSemanticFacts(main, kind);
    if (kind === 'friends' && preferences.friendsSearch) enhanceFriends(main);
    if (kind === 'community' && preferences.communitySearch) enhanceFriends(main, true);
    if (kind === 'transactions' && preferences.transactions) enhanceTransactions(main);
    if (kind === 'avatar' && preferences.rememberAvatarSection) {
      const section = currentAvatarSection(main) ?? (/^#!\/[a-z-]+(?:\/[a-z-]+){0,3}$/.test(location.hash) ? location.hash : undefined);
      // Keep the saved destination on initial load. Only subsequent native
      // section changes replace it, so a default landing section cannot erase it.
      const shouldSave = section && section !== preferences.avatarSection && section !== rememberedSection && (rememberedSection || !preferences.avatarSection);
      rememberedSection = section ?? '';
      if (shouldSave) {
        rememberedSection = section;
        try { extension.runtime.sendMessage({ type: 'w8rld:remember-avatar', section }, () => { void extension.runtime.lastError; }); } catch { /* Optional shortcut. */ }
      }
      const destination = preferences.avatarSection && section !== preferences.avatarSection ? preferences.avatarSection : '';
      if (avatarResumeKey !== destination || avatarResumeHost && !avatarResumeHost.isConnected) {
        avatarResume?.dispose(); avatarResumeHost?.remove(); avatarResumeKey = destination;
        avatarResume = destination ? avatarShortcut(destination) : undefined;
        if (avatarResume) { avatarResumeHost = ownedRegion('Last viewed avatar section'); avatarResumeHost.append(avatarResume.node); main.prepend(avatarResumeHost); }
      }
    }
    trailers.update(kind === 'experience' ? main : undefined, preferences.trailerAutoplay);
    privacy(main);
  }
  async function settings() {
    const revision = ++settingsRevision; const next = await readPreferences(extension);
    if (disposed || revision !== settingsRevision) return;
    const changed = JSON.stringify(preferences) !== JSON.stringify(next);
    preferences = next;
    if (changed) reset(next.tradeList);
    if (changed || !preferencesLoaded) { onPreferences(next); observe(); schedule(); }
    preferencesLoaded = true;
  }
  const storageChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && PREFERENCE_KEY in changes) void settings();
    if (area === 'sync' && 'enabled' in changes) { enabled = changes.enabled.newValue !== false; reset(); observe(); schedule(); }
  };
  extension.storage.onChanged.addListener(storageChanged); cleanups.push(() => extension.storage.onChanged.removeListener(storageChanged));
  const invalidate = (message: unknown, sender: { id?: string }) => {
    if (sender?.id === extension.runtime.id && message && typeof message === 'object' && !Array.isArray(message)
      && Object.keys(message).length === 1 && (message as { type?: unknown }).type === 'w8rld:public-facts-changed') { cancelMember();publicInfo.reset(); nativeSearch.clear(); sentAlerts.clear(); schedule(); return; }
    if (sender?.id === extension.runtime.id && message && typeof message === 'object' && !Array.isArray(message)
      && Object.keys(message).length === 1 && (message as { type?: unknown }).type === 'w8rld:preferences-changed') void settings();
  };
  extension.runtime.onMessage?.addListener(invalidate); cleanups.push(() => extension.runtime.onMessage?.removeListener(invalidate));
  const closePreviews = () => { closePreview(); closeItemPreview(); if (itemHoverTimer !== undefined) clearTimeout(itemHoverTimer); itemHoverTimer = undefined; };
  listen(window, 'resize', () => { closePreviews(); schedule(); });
  listen(window, 'scroll', () => {
    // An in-flow narrow preview must stay readable while the native document
    // scrolls. Reflowing the list here would move the preview during that scroll.
    if (openPreview?.inlineList) { closeItemPreview(); return; }
    closePreviews(); if (list) repairList();
  });
  document.addEventListener('scroll', closeItemPreview, true); cleanups.push(() => document.removeEventListener('scroll', closeItemPreview, true));
  listen(window, 'blur', closePreviews);
  // Roblox's Members dialog handles Escape in capture. Consume Escape only
  // while focus is inside our search, before it can dismiss native members.
  const memberEscape=(event:KeyboardEvent)=>{
    if(event.key!=='Escape'||event.isComposing||!preferences.communitySearch||!(event.target instanceof Element))return;
    const tools=event.target.closest<HTMLElement>('.w8rld-member-search');
    const input=tools?.querySelector<HTMLInputElement>('input[type="search"]');
    if(!tools||!input||!visible(tools))return;
    event.preventDefault();event.stopImmediatePropagation();input.value='';refreshTools.get(tools)?.();input.focus();
  };
  window.addEventListener('keydown',memberEscape,true);cleanups.push(()=>window.removeEventListener('keydown',memberEscape,true));
  const revealItem = (event: Event) => {
    if (!enabled || !preferences.itemPreviews) return;
    if (!(event.target instanceof Element) || own(event.target)) return;
    const target = event.target.closest<HTMLElement>('a[href*="/catalog/"]');
    if (!target || !target.closest('.item-card-container,.trade-item-card') || (event as MouseEvent).relatedTarget instanceof Node && target.contains((event as MouseEvent).relatedTarget as Node)) return;
    if (itemHoverTimer !== undefined) clearTimeout(itemHoverTimer);
    if (event.type === 'focusin') showItemPreview(target);
    else itemHoverTimer = window.setTimeout(() => { itemHoverTimer = undefined; showItemPreview(target); }, 160);
  };
  const leaveItem = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('a[href*="/catalog/"]'); if (!target || !target.closest('.item-card-container,.trade-item-card')) return;
    const related = (event as MouseEvent).relatedTarget; if (related instanceof Node && target.contains(related)) return;
    if (itemHoverTimer !== undefined) clearTimeout(itemHoverTimer); itemHoverTimer = undefined; closeItemPreview();
  };
  listen(document, 'mouseover', revealItem); listen(document, 'focusin', revealItem); listen(document, 'mouseout', leaveItem); listen(document, 'focusout', leaveItem);
  const escapePreview = (event: KeyboardEvent) => { if (event.key === 'Escape') closePreviews(); };
  document.addEventListener('keydown', escapePreview, true); cleanups.push(() => document.removeEventListener('keydown', escapePreview, true));
  const routeChanged = () => { if (route !== location.href) { reset(); route = location.href; observe(); } schedule(); };
  listen(window, 'popstate', routeChanged); listen(window, 'hashchange', routeChanged);
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation; if (navigation) listen(navigation, 'currententrychange', routeChanged);
  listen(window, 'focus', () => {
    // A later explicit return to this page can recover an exhausted failure;
    // idle pages never start another retry cycle on their own.
    if ((lookupState === 'unavailable' || lookupState === 'partial') && !pending && Date.now() >= lookupRetryAt) lookupAttempts = 0;
    routeChanged(); void settings();
  });
  listen(document,'visibilitychange',()=>schedule());
  listen(window, 'pagehide', (event => { if ((event as PageTransitionEvent).persisted) { suspended = true; reset(); observer.disconnect(); locator.disconnect(); } else lifecycle.dispose(); }) as EventListener);
  listen(window, 'pageshow', () => { if (suspended) { suspended = false; observe(); schedule(); void settings(); } });
  function loadSearch(results: HTMLElement, query: string) {
    const people = ownedRegion('Public players and experiences'); const limiteds = ownedRegion('Limited suggestions');
    results.replaceChildren(people, limiteds); catalogResults(limiteds, { query });
    if (preferences.privacyMode) return;
    const friends: PublicSuggestion[] = [];
    if (companionRoute(location.href) === 'friends') for (const card of document.querySelectorAll<HTMLElement>('main .avatar-card')) {
      if (!visible(card) || own(card)) continue;
      const link = card.querySelector<HTMLAnchorElement>('a[href]'); if (!link) continue;
      const u = new URL(link.href); const id = u.origin === location.origin && /^\/users\/([1-9]\d{0,15})\/profile\/?$/.exec(u.pathname)?.[1];
      const name = link.innerText.trim(); if (id && name && name.length <= 100 && name.toLowerCase().includes(query.toLowerCase())) friends.push({kind:'player',id,name});
      if (friends.length >= 4) break;
    }
    const draw = (suggestions: PublicSuggestion[]) => {
      if (!people.isConnected) return;
      people.replaceChildren(); const rows = [...friends, ...suggestions].filter((r, i, all) => all.findIndex(s => s.id === r.id && s.kind === r.kind) === i).slice(0, 6);
      for (const r of rows) {
        people.append(publicSearchRow(r,friends.some(f => f.id === r.id && r.kind === 'player')));
      }
    };
    draw([]); let settled = false; const version = generation;
    const finish = (raw: any) => { if (settled) return; settled = true; clearTimeout(timeout); catalogTimers.delete(timeout);
      if (disposed || version !== generation || !people.isConnected) return;
      const suggestions = raw?.ok === true && parseSuggestions(raw.suggestions); if (suggestions) draw(suggestions);
    };
    const timeout = window.setTimeout(() => finish(undefined), 10_000); catalogTimers.add(timeout);
    try { extension.runtime.sendMessage({type:'w8rld:public-search',query}, (raw: unknown) => { const error = extension.runtime.lastError; finish(error ? undefined : raw); }); }
    catch { finish(undefined); }
  }
  const nativeSearch = startNativeSearch(loadSearch, results => { cancelCatalog(results); for (const node of results.querySelectorAll<HTMLElement>('[data-w8rld-owned]')) cancelCatalog(node); });
  const lifecycle: CompanionLifecycle = {
    trade(items, ready, incomplete, facts = []) {
      if (disposed || !enabled || companionRoute(location.href) !== 'trades') return;
      tradePriced = ready ? items : [];
      if (!ready) {
        repairList(); closePreview('detail-refresh');
        for (const row of currentRows().filter(n => n.classList.contains('selected'))) tradeViews.delete(row);
        for (const [anchor, region] of regions) if (region.node.getAttribute('aria-label') === 'Local trade proof') { region.node.remove(); regions.delete(anchor); }
        if (proofUrl) URL.revokeObjectURL(proofUrl); proofUrl = undefined;
        enhanceTradeList(); return;
      }
      if (!(preferences.tradeList || preferences.tradeProof)) return;
      repairList(); const selected = currentRows().filter(n => n.classList.contains('selected'));
      if (selected.length !== 1 || inspectNativeTrade(document).status !== 'PASS') return;
      const thumbnails = new Map<string, HTMLCanvasElement>();
      if (!preferences.privacyMode) for (const card of inspectNativeTrade(document).sides.flatMap(s => s.cards).slice(0, 12)) { const copy = safeImage(card.node); if (copy) thumbnails.set(card.item.assetId, copy); }
      const time = Date.now();
      const thumbnailFacts=new Map(facts.filter(f=>items.some(i=>i.assetId===f.assetId)&&!!f.thumbnailUrl&&f.retrievedAt<=time&&time-f.retrievedAt<QUOTE_FRESH_MS).map(f=>[f.assetId,f]));
      const view = { items, fingerprint: fingerprint(selected[0]), context: tradeContext, incomplete, time, expiresAt: tradeExpiry(items,time,[...thumbnailFacts.values()]), thumbnails, thumbnailFacts };
      tradeViews.set(selected[0], view); enhanceTradeList(); if (preferences.tradeProof) proof(view);
    },
    stats: () => ({ ...count, regions: regions.size, timer: timer !== undefined, pending, nativeTrades: tradeReader.stats(), preview: {open:!!openPreview,loading:!!loadingPreview,lastClose:previewClose}, item: { state: lookupState, timeline: itemTimeline.slice() } }),
    dispose() { if (disposed) return; disposed = true; settingsRevision++; if (timer !== undefined) clearTimeout(timer); timer = undefined; observer.disconnect(); locator.disconnect(); reset(); nativeSearch.dispose(); localTools.dispose(); cleanups.splice(0).forEach(fn => fn()); if (owners[OWNER] === lifecycle) delete owners[OWNER]; },
  };
  owners[OWNER] = lifecycle;
  void extension.storage.sync.get({ enabled: true }).then((s: any) => { if (!disposed) { enabled = s?.enabled !== false; observe(); schedule(); } }).catch(() => {});
  void settings(); return lifecycle;
}
