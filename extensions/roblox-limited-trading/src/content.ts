/*! Trade thumbnail classifications adapt RoUtility core/ui.js::cardTags,
 * Copyright (c) 2026 RoUtility, MIT; see ../THIRD_PARTY_NOTICES.txt.
 * The existing verified card boundary and annotation lifecycle remain owners. */
import { analyzeTrade, catalogAssetId, formatCoverage, MAX_QUANTITY, normalizeItems, supportedTradeUrl, type PricedTradeItem, type TradeEvidence, type TradeItemInput, type TradeSide } from './core';
import { parseLookupReply, type ItemFacts } from './protocol';
import { emitContentDiagnostic } from './diagnostics';
import { displayUsdTrade, usdDescription } from './usdDisplay';
import { inspectNativeTrade } from './nativeTradeDom';
import { rolimonsMetricEvidence } from './marketEvidence';
import { companionRoute, DEFAULT_PREFERENCES, type Preferences } from './preferences';
import { displayNumber, demandBySide, signedPercent, itemValues, itemTags, ownedRegion, inheritSurface, ownedSelector, usdAmount, usdExact } from './presentation';
import { startCompanion } from './companion';
import { startNativeSettings } from './nativeSettings';
import { valueWarning } from './tradeResearchCore';
import { placeCardValues, cardTagsAnchor } from './nativeAdaptation';
import {displayValueTrade} from './valuation';

// Stable lifecycle ID retained; one comparison sits after the verified Give total.
const ROOT_ID = 'w8rld-roblox-limited-overlay';
const GIVE_ID = 'w8rld-roblox-limited-give';
const REFRESH_DELAY_MS = 300;
const REQUEST_DEADLINE_MS = 12_000;
const MAX_PENDING = 2;
const MAX_ANCHORS = 600;
const MAX_ITEMS = 100;
const OWNER = Symbol.for('w8rld.roblox.limited.lifecycle');
// Version identifies our fixture contract, never a discovered live Roblox API.
export const TRADE_DOM_CONTRACT = { version: 'synthetic-v1', liveVerified: false } as const;
type Snapshot = { key: string; route: string; items: TradeItemInput[]; roots: HTMLElement[]; anchors?: Record<TradeSide, HTMLElement>; supported: boolean; valid: boolean; evidence: TradeEvidence };
export interface LifecycleStats {
  mutationCallbacks: number; refreshAttempts: number; workerMessages: number; renderCommits: number; storageReads: number;
  activeTimers: number; activeObservers: number; activeListeners: number; pendingRequests: number;
}
export interface ContentLifecycle { dispose(): void; stats(): LifecycleStats; setPreferences(value: Preferences): void; }

// Bounded synthetic/semantic contracts, not claimed live Roblox CSS selectors.
// Never search a common ancestor's first descendant heading.
function sideLabel(text: string | null): TradeSide | undefined {
  const label = text?.trim().toLowerCase();
  if (['you give', 'your offer', 'you are giving'].includes(label ?? '')) return 'give';
  if (['you receive', 'their offer', 'you are receiving'].includes(label ?? '')) return 'receive';
  return undefined;
}
function sideForRoot(node: HTMLElement): TradeSide | undefined {
  const explicit = node.dataset.w8rldTradeSide ?? node.dataset.tradeSide;
  if (node === node.ownerDocument.body || node === node.ownerDocument.documentElement || node.tagName === 'MAIN' || node instanceof HTMLAnchorElement) return undefined;
  if (explicit !== undefined && explicit !== 'give' && explicit !== 'receive') return undefined;
  if (node.dataset.w8rldTradeSide && node.dataset.tradeSide && node.dataset.w8rldTradeSide !== node.dataset.tradeSide) return undefined;
  const headings = [...node.children].filter((child) => child.matches('h1,h2,h3,h4,[role="heading"]'));
  const labels = [sideLabel(node.getAttribute('aria-label')), ...headings.map((heading) => sideLabel(heading.textContent))].filter((side): side is TradeSide => !!side);
  if (new Set([...(explicit ? [explicit] : []), ...labels]).size > 1) return undefined;
  if (explicit) return explicit;
  return node.tagName === 'SECTION' && labels.length && headings.length <= 1 ? labels[0] : undefined;
}
function quantityFor(card: HTMLElement): number | undefined {
  const raw = card.dataset.quantity;
  if (raw === undefined) return 1;
  if (!/^[1-9]\d{0,3}$/.test(raw)) return undefined;
  const value = Number(raw); // Bounded quantity; asset identity never uses Number.
  return value <= MAX_QUANTITY ? value : undefined;
}
function owned(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return !!element?.closest(`#${ROOT_ID},#${GIVE_ID},${ownedSelector}`);
}
// Explicit OFFLINE contract only. A screenshot cannot establish live selectors.
// Until sanctioned DOM evidence exists, unknown native markup mounts nothing.
function totalAnchors(roots: HTMLElement[]): Record<TradeSide, HTMLElement> | undefined {
  if (roots.length !== 2) return undefined;
  const result: Partial<Record<TradeSide, HTMLElement>> = {};
  for (const root of roots) {
    if (root.closest('[hidden],[inert],[aria-hidden="true"],[aria-busy="true"]')) return undefined;
    const version = root.getAttribute('data-w8rld-trade-contract');
    if (version !== null && version !== TRADE_DOM_CONTRACT.version) return undefined;
    const side = sideForRoot(root);
    const totals = [...root.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute('data-w8rld-native-total') === side);
    if (!side || result[side] || totals.length !== 1) return undefined;
    const total = totals[0];
    if (total.closest('[hidden],[inert],[aria-hidden="true"],[aria-busy="true"]') || total.tagName !== 'DIV' || total.matches('[role],[tabindex],[contenteditable]') || total.querySelector('a,button,input,select,textarea,form,summary,details,label,[role],[tabindex],[contenteditable]') || total.closest('form,a,button,summary,label,[role="button"],[role="link"],[contenteditable]') || !total.textContent?.trim()) return undefined;
    result[side] = total;
  }
  return result.give && result.receive ? result as Record<TradeSide, HTMLElement> : undefined;
}
export function scanTradeEvidence(doc: Document): { items: TradeItemInput[]; roots: HTMLElement[]; valid: boolean; evidence: TradeEvidence; anchors?: Record<TradeSide, HTMLElement> } {
  const found: TradeItemInput[] = []; const candidates = new Map<HTMLElement, TradeSide>(); const anchors: HTMLAnchorElement[] = [];
  const evidence: TradeEvidence = { componentsComplete: false, unclassifiedCount: 0, unsupportedComponents: 0 };
  const invalid = () => ({ items: [], roots: [], valid: false, evidence });
  const native = inspectNativeTrade(doc);
  if (native.status !== 'ABSENT') {
    if (native.status !== 'PASS') return invalid();
    evidence.unsupportedComponents=native.unsupportedComponents??0;
    return { items: normalizeItems(native.items), roots: native.sides.map(s => s.root), valid: true, evidence,
      anchors: Object.fromEntries(native.sides.map(s => [s.side, s.total])) as Record<TradeSide, HTMLElement> };
  }
  // Discover only documented side candidates. Unrelated catalog links and page
  // contents are not trade evidence; walk only the recognized, bounded regions.
  for (const node of doc.querySelectorAll<HTMLElement>('section,[data-trade-side],[data-w8rld-trade-side]')) {
    if (owned(node)) continue;
    const side = sideForRoot(node); if (side) candidates.set(node, side);
    if (candidates.size > 100) return invalid();
  }
  const regions = [...candidates.keys()].filter((root) => ![...candidates.keys()].some((other) => other !== root && (root.contains(other) || other.contains(root))));
  let visited = 0;
  for (const root of regions) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: (node) => owned(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++visited > 20_000) return invalid();
      if (!(node instanceof HTMLElement)) continue;
      if (node.dataset.w8rldTradeComponent && node.dataset.w8rldTradeComponent !== 'limited') evidence.unsupportedComponents++;
      if (node instanceof HTMLAnchorElement && node.getAttribute('href')?.includes('/catalog/')) anchors.push(node);
      if (anchors.length > MAX_ANCHORS) return invalid();
    }
  }
  const cards = new Map<HTMLElement, { side: TradeSide; anchors: HTMLAnchorElement[] }>();
  // Every supported card boundary without a catalog link is missing evidence.
  for (const root of regions) for (const card of root.querySelectorAll('[data-w8rld-trade-item],article,li')) {
    if (!owned(card) && !card.querySelector('a[href*="/catalog/"]') && !card.matches('a[href*="/catalog/"]')) evidence.unclassifiedCount++;
  }
  for (const anchor of anchors) {
    const root = regions.find((region) => region.contains(anchor));
    if (!root) { evidence.unclassifiedCount++; continue; }
    let blocked = false;
    for (let parent = anchor.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.tagName === 'SECTION' || parent.hasAttribute('data-trade-side') || parent.hasAttribute('data-w8rld-trade-side')) { blocked = true; break; }
    }
    if (blocked) { evidence.unclassifiedCount++; continue; }
    let card: HTMLElement = anchor;
    const marked = anchor.closest<HTMLElement>('[data-w8rld-trade-item],article,li');
    if (marked && marked !== root && root.contains(marked)) card = marked;
    else while (card.parentElement && card.parentElement !== root) card = card.parentElement;
    const prior = cards.get(card);
    if (prior) prior.anchors.push(anchor); else cards.set(card, { side: candidates.get(root)!, anchors: [anchor] });
  }
  if (cards.size > MAX_ITEMS) return invalid();
  const occurrences = new Map<string, number>();
  for (const group of cards.values()) {
    for (const id of new Set(group.anchors.map((anchor) => catalogAssetId(anchor.getAttribute('href') ?? '', doc.baseURI)))) {
      if (id) { const key = `${group.side}:${id}`; occurrences.set(key, (occurrences.get(key) ?? 0) + 1); }
    }
  }
  for (const [card, group] of cards) {
    const ids = group.anchors.map((anchor) => catalogAssetId(anchor.getAttribute('href') ?? '', doc.baseURI));
    const quantity = quantityFor(card);
    if (!quantity || ids.some((id) => !id) || new Set(ids).size !== 1) { evidence.unclassifiedCount++; continue; }
    // A bare duplicate anchor has no proven instance boundary. An unmarked
    // nested wrapper may contain several same-asset cards; never merge it as one.
    if ((card instanceof HTMLAnchorElement && !card.hasAttribute('data-w8rld-trade-item') && occurrences.get(`${group.side}:${ids[0]}`)! > 1)
      || (!(card instanceof HTMLAnchorElement) && !card.matches('[data-w8rld-trade-item],article,li') && group.anchors.some((anchor) => anchor.parentElement !== card))) { evidence.unclassifiedCount++; continue; }
    // Never inherit a page/side quantity or infer copies from link count.
    const nestedQuantities = group.anchors.filter((anchor) => anchor !== card && anchor.hasAttribute('data-quantity'));
    if (nestedQuantities.some((anchor) => quantityFor(anchor) !== quantity)) { evidence.unclassifiedCount++; continue; }
    const assetId = ids[0]!; const image = card.querySelector<HTMLImageElement>('img');
    const name = (image?.alt || group.anchors.find((anchor) => anchor.textContent?.trim())?.textContent || group.anchors[0].getAttribute('aria-label') || `Asset ${assetId}`).trim();
    if (name.length > 256) return invalid();
    found.push({ assetId, name, quantity, side: group.side });
  }
  const items = normalizeItems(found).sort((a, b) => `${a.side}:${a.assetId}`.localeCompare(`${b.side}:${b.assetId}`));
  const valid = items.some((item) => item.side === 'give') && items.some((item) => item.side === 'receive');
  return { items: valid ? items : [], roots: regions, valid, evidence };
}
export function scanTradeDocument(doc: Document): TradeItemInput[] { return scanTradeEvidence(doc).items; }
function snapshot(): Snapshot {
  const route = location.href; const supported = route.length <= 2048 && supportedTradeUrl(route);
  const data = supported ? scanTradeEvidence(document) : { items: [], roots: [], valid: false, evidence: { componentsComplete: false, unclassifiedCount: 0, unsupportedComponents: 0 } };
  const anchors = ('anchors' in data ? data.anchors : undefined) ?? totalAnchors(data.roots);
  data.valid = data.valid && !!anchors;
  const structure = data.roots.map((root) => [root.tagName, root.dataset.w8rldTradeSide ?? root.dataset.tradeSide ?? '', root.getAttribute('aria-label')?.slice(0, 256) ?? '']);
  // Local comparison only: never an account or authorization identity.
  return { ...data, anchors, route, supported, key: JSON.stringify([route.slice(0, 2048), supported, data.valid, !!anchors, structure, data.items, data.evidence]) };
}
type ViewPhase = 'loading' | 'ready' | 'disabled' | 'error' | 'unsupported';
const signed = (value: number, compact = false) => `${value >= 0 ? '+' : '−'}${displayNumber(Math.abs(value), compact)}`;

/** Presentation only: preserve individual demand ratings and physical copy counts. */
export function summarizeItemDemand(items: readonly PricedTradeItem[], incomplete = false, preferences?: Preferences): { value: string; detail: string; partial: boolean } {
  return demandBySide(items, incomplete, preferences);
}

/** The production lifecycle factory also runs in offline Chromium acceptance. */
export function startContentScript(extension: any, onTrade?: (items: PricedTradeItem[], ready: boolean, incomplete: boolean, facts?: readonly ItemFacts[]) => void): ContentLifecycle {
  const owners = globalThis as unknown as Record<symbol, ContentLifecycle | undefined>;
  owners[OWNER]?.dispose();
  const counts = { mutationCallbacks: 0, refreshAttempts: 0, workerMessages: 0, renderCommits: 0, storageReads: 0 };
  const listeners: (() => void)[] = []; const pending = new Map<number, { timer?: number }>();
  let disposed = false; let suspended = false; let generation = 0; let requestId = 0;
  let enabled: boolean | undefined; let preferenceRevision = 0; let storageNotice = '';
  let refreshTimer: number | undefined; let ready = false; let attemptedKey: string | undefined;
  let attempts = 0;
  let current: Snapshot | undefined; let observedRoots: HTMLElement[] = []; let observedParents: HTMLElement[] = []; let observedValid = false; let observerCount = 0;
  let panel: HTMLElement | undefined; let metrics: HTMLElement;
  let renderedKey = '';
  let preferences: Preferences = { ...DEFAULT_PREFERENCES };
  let lastRender: { items: PricedTradeItem[]; message: string; phase: ViewPhase; facts: readonly ItemFacts[] } | undefined;
  let expiryTimer: number | undefined;
  const annotations = new Set<HTMLElement>();
  const sourceObserver = new MutationObserver(onMutations); const locatorObserver = new MutationObserver(onMutations);

  function listen(target: EventTarget, event: string, handler: EventListener): void {
    target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler));
  }
  function clearRefresh(): void {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = undefined; ready = false;
  }
  function removeClones(): void {
    document.querySelectorAll(`[id="${ROOT_ID}"].w8rld-inline`).forEach(node => { if (node !== panel) node.remove(); });
  }
  function removeAnnotations(): void { annotations.forEach(n => n.remove()); annotations.clear(); }
  function removePanel(): void { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; panel?.remove(); panel = undefined; removeClones(); removeAnnotations(); renderedKey = ''; lastRender = undefined; }
  function place(): void {
    if (!current?.anchors || !panel) return;
    const anchor = current.anchors.give;
    // Inside the verified Give total wrapper, between the native offer sections.
    // Never insert a sibling into Roblox's strictly paired offer container.
    if (anchor.nextElementSibling !== panel) anchor.after(panel);
    removeClones();
    // Resolve only host surface colors. Typography, controls and layout stay
    // isolated; no Roblox class or style is changed. Avoid a second dark panel.
    inheritSurface(panel, anchor);
  }
  function mount(): void {
    if (panel) { place(); return; }
    panel = document.createElement('div'); panel.id = ROOT_ID; panel.className = 'w8rld-inline';
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'W8RLD Limited item comparison, receiving minus giving');
    for (const event of ['click', 'dblclick', 'auxclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup']) {
      panel.addEventListener(event, e => e.stopPropagation());
    }
    metrics = document.createElement('div'); metrics.className = 'w8rld-indicators';
    metrics.setAttribute('aria-live', 'polite'); metrics.setAttribute('aria-atomic', 'true');
    panel.append(metrics); place();
  }
  function render(items: PricedTradeItem[], message: string, phase: ViewPhase = 'ready', facts: readonly ItemFacts[] = []): void {
    if (!current?.supported || !current.anchors || enabled !== true || disposed || suspended) return;
    lastRender = { items, message, phase, facts };
    if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined;
    if (phase === 'ready') {
      const expires = Math.min(...items.flatMap(i => [i.quote?.fetchedAt, i.usdQuote?.retrievedAt,i.demandQuote?.retrievedAt].filter((t): t is number => t !== undefined).map(t => t + 15 * 60_000)));
      if (expires > Date.now() && Number.isFinite(expires)) expiryTimer = window.setTimeout(() => {
        expiryTimer = undefined; if (lastRender && !disposed && !suspended) { renderedKey = ''; attempts = 0; attemptedKey = undefined; ready = true; render(lastRender.items, 'Catalog evidence expired.', 'error'); }
      }, expires - Date.now());
    }
    const key = JSON.stringify([current.key, items, message, phase, storageNotice, preferences]);
    if (panel?.isConnected && renderedKey === key) { place(); return; }
    mount(); renderedKey = key; counts.renderCommits++;
    const analysis = analyzeTrade(items, current.evidence);
    if (phase === 'ready' && (analysis.give.estimatedCovered < analysis.give.itemCount || analysis.receive.estimatedCovered < analysis.receive.itemCount)) {
      emitContentDiagnostic(extension, { code: 'W8RLD-EXT-TRADE-001', status: 'unavailable', enabled: 'yes', page: 'trades' });
    }
    const valuation=displayValueTrade(items,!!(current.evidence.unclassifiedCount||current.evidence.unsupportedComponents),preferences);
    const provenance = items.flatMap(item => item.quote?.assetId === item.assetId ? [rolimonsMetricEvidence(item.quote)] : []);
    const stale = provenance.some(item => item.rap.freshness !== 'fresh');
    const incomplete = !!(current.evidence.unclassifiedCount || current.evidence.unsupportedComponents);
    const available = phase === 'ready' && !stale;
    const limitation = 'Limited items only; Robux and other components unverified.';
    const reason = phase === 'loading' ? 'Market data loading.' : phase === 'disabled' ? 'Provider transport disabled.'
      : stale ? 'Catalog evidence expired.' : phase !== 'ready' ? 'Market data unavailable.' : '';
    panel!.setAttribute('aria-label', `W8RLD trade metrics. Receiving minus giving. ${limitation} ${reason} ${storageNotice}`.trim());
    panel!.setAttribute('aria-busy', String(phase === 'loading'));
    const indicators: HTMLElement[] = [];
    const metric = (field: string, label: string, value: string, state: string, meaning: string, totals?: string) => {
      const indicator = document.createElement('div'); indicator.className = 'w8rld-indicator';
      indicator.setAttribute('role', 'group'); indicator.dataset.comparison = field; indicator.dataset.sign = state;
      indicator.setAttribute('aria-label', `${label}: ${meaning}`); indicator.title = meaning;
      const name = document.createElement('span'); name.className = 'w8rld-metric-label'; name.textContent = field === 'usdValue' && value !== 'N/A' ? '' : label;
      const amount = document.createElement('strong'); amount.textContent = value;
      indicator.append(name, amount); indicators.push(indicator);
      if (totals && preferences.tradeTotals) { const line = document.createElement('small'); line.className = 'w8rld-side-totals'; line.textContent = totals; indicator.append(line); }
    };
    for (const field of ['rap', 'estimatedValue'] as const) {
      const label = field === 'rap' ? 'RAP' : valuation.label.toUpperCase();
      const covered = field === 'rap' ? analysis.give.rapCovered + analysis.receive.rapCovered : valuation.give.covered+valuation.receive.covered;
      const difference = !available || incomplete ? undefined : field === 'rap' ? analysis.rapDifference : valuation.difference;
      const percent = difference === undefined ? undefined : field === 'rap' ? analysis.rapPercent : valuation.percent;
      const partial = difference === undefined && (covered > 0 || incomplete) && available;
      const state = difference === undefined ? partial ? 'partial' : 'unavailable' : difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral';
      const amount = difference === undefined ? 'N/A' : `${signed(difference, preferences.compactNumbers)} R$${percent === undefined ? '' : ` (${signedPercent(percent)}%)`}`;
      const meaning = difference === undefined ? `${partial ? 'Partial coverage; complete difference unavailable.' : 'Unavailable.'} ${reason}`
        : `${amount}, receiving minus giving.${percent === undefined ? ' Percentage unavailable: giving must be fully covered and greater than zero.' : ' Percentage of giving.'}`;
      const coverage = `${covered}/${analysis.give.itemCount + analysis.receive.itemCount} physical copies covered.`;
      metric(field, label, amount, state, `${meaning} Exact difference: ${difference === undefined ? 'N/A' : signed(difference)} R$.${percent === undefined ? '' : ` Exact change: ${percent.toLocaleString('en-US', { maximumFractionDigits: 6 })}%.`} ${field === 'rap' ? "Rolimon's RAP observation; native Roblox RAP is not read." : valuation.description} ${coverage}${available ? field==='rap'?` Giving: ${formatCoverage(analysis.give, field)}; receiving: ${formatCoverage(analysis.receive, field)}.`:` Giving: ${valuation.give.covered?displayNumber(valuation.give.value)+' R$':'Unavailable'}; receiving: ${valuation.receive.covered?displayNumber(valuation.receive.value)+' R$':'Unavailable'}. Curated ${valuation.give.curatedCovered+valuation.receive.curatedCovered}; RAP estimated ${valuation.give.rapCovered+valuation.receive.rapCovered}.` : ''} ${limitation}`,
        available && difference !== undefined ? (['give', 'receive'] as const).map(side => {
          const t = analysis[side]; const coverage = field === 'rap' ? t.rapCovered : valuation[side].covered;
          return `${side === 'give' ? 'Give' : 'Receive'} ${!coverage ? 'Unavailable' : `${coverage < t.itemCount ? 'Partial ' : ''}R$${displayNumber(field==='rap'?t[field]:valuation[side].value, preferences.compactNumbers)}`}`;
        }).join(' → ') : undefined);
    }
    const usd = displayUsdTrade(items, incomplete, preferences);
    const usdDifference = phase === 'ready' ? usd.difference : undefined;
    const usdPartial = usdDifference === undefined && usd.covered > 0;
    const usdText = usdDifference === undefined ? 'N/A'
      : `${usdAmount(usdDifference, { signed: true, compact:preferences.compactNumbers })}${usd.percent === undefined ? '' : ` (${signedPercent(usd.percent)}%)`}`;
    metric('usdValue', '$', usdText,
      usdDifference === undefined ? usdPartial ? 'partial' : 'unavailable' : usdDifference > 0 ? 'positive' : usdDifference < 0 ? 'negative' : 'neutral',
      `${usdText}. ${usdDifference === undefined ? '' : `Unrounded difference: ${usdExact(usdDifference)}; give ${usdExact(usd.give!)}; receive ${usdExact(usd.receive!)}. `}${usdDescription(usd.method, preferences.usdPerThousandRobux)} Receiving minus giving. ${usd.covered}/${usd.total} physical copies covered. ${limitation}`,
      phase === 'ready' && usdDifference !== undefined ? `Give ${usdAmount(usd.give!, {compact:preferences.compactNumbers})} → Receive ${usdAmount(usd.receive!, {compact:preferences.compactNumbers})}` : undefined);
    const demand = available ? summarizeItemDemand(items, incomplete, preferences) : { value: stale ? 'Stale' : 'Unavailable', detail: reason || 'Item demand evidence unavailable.', partial: false };
    metric('demand', 'DEMAND', demand.value, demand.value === 'Unavailable' ? 'unavailable' : demand.partial ? 'partial' : 'neutral', demand.detail);
    if (available && demand.value !== 'Unavailable') {
      const sides = demandBySide(items, incomplete, preferences); const amount = indicators[indicators.length - 1].querySelector('strong')!;
      amount.replaceChildren(...(['give', 'receive'] as const).map(side => {
        const line = document.createElement('span'); line.textContent = `${side === 'give' ? 'Giving' : 'Receiving'}: ${sides[side].value}${side === 'give' ? ' · ' : ''}`; return line;
      }));
      const delta=/ · Δ (.+)$/.exec(sides.value)?.[1];if(delta)amount.append(` · Δ ${delta}`);
    }
    metrics.replaceChildren(...indicators);
    panel!.querySelector('.w8rld-value-warning')?.remove();
    const warning = preferences.overpayWarnings && available && valueWarning(items, incomplete, preferences.overpayThreshold);
    if (warning) { const text = document.createElement('small'); text.className = 'w8rld-value-warning'; text.textContent = warning; panel!.append(text); }
    removeAnnotations();
    if (phase === 'ready' && (preferences.itemValues || preferences.itemFlags)) {
      const native = inspectNativeTrade(document);
      if (native.status === 'PASS') for (const side of native.sides) for (const card of side.cards) {
        const item = items.find(i => i.side === side.side && i.assetId === card.item.assetId);
        if (!item) continue;
        // Same RoUtility cardTags placement as catalog/inventory cards. The
        // verified trade-card boundary retains the existing annotation owner.
        const tagHost = cardTagsAnchor(card.node);
        if (tagHost && preferences.itemFlags) {
          const tags = ownedRegion('Limited item classifications'); tags.classList.add('w8rld-card-tags'); tags.append(...itemTags(item));
          if (tags.children.length) { inheritSurface(tags, card.node); tagHost.append(tags); annotations.add(tags); }
        }
        // This verified native price line already shows RAP. Keep it intact.
        const node = itemValues(item, preferences.itemFlags && !tagHost, !!card.node.querySelector('.item-card-price .text-robux-tile'), false, preferences);
        if (!preferences.itemValues) [...node.children].filter(n => !n.classList.contains('w8rld-tag')).forEach(n => n.remove());
        if (node.children.length) { inheritSurface(node, card.node); placeCardValues(card.node, node); annotations.add(node); }
      }
    }
    onTrade?.(items, phase === 'ready', incomplete, facts);
  }
  function observe(next: Snapshot): void {
    const parents = new Set<HTMLElement>();
    for (const root of next.roots) for (let parent = root.parentElement; parent; parent = parent.parentElement) parents.add(parent);
    const spine = [...parents];
    if (next.supported && observedValid === next.valid && observedRoots.length === next.roots.length && observedRoots.every((root, index) => root === next.roots[index]) && observedParents.length === spine.length && observedParents.every((parent, index) => parent === spine[index]) && observerCount) return;
    sourceObserver.disconnect(); locatorObserver.disconnect(); observerCount = 0; observedRoots = next.roots; observedParents = spine; observedValid = next.valid;
    if (disposed || suspended || enabled !== true || !next.supported) return;
    const roots = next.valid ? next.roots.filter((root) => root !== document.body && root !== document.documentElement) : [];
    if (roots.length) {
      let common = roots[0];
      while (common.parentElement && !roots.every((root) => common.contains(root))) common = common.parentElement;
      const regions = common !== document.body && common !== document.documentElement ? [common] : roots;
      for (const root of regions) sourceObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-busy', 'data-w8rld-trade-contract', 'href', 'data-quantity', 'data-trade-side', 'data-w8rld-trade-side', 'data-w8rld-trade-item', 'data-w8rld-trade-component', 'data-w8rld-native-total', 'role', 'tabindex', 'contenteditable', 'aria-label', 'alt', 'src'] });
      observerCount++;
      // Direct-child observation along the ancestor spine catches replacement of
      // whole trade regions without observing unrelated document subtrees.
      const ancestors = new Set<HTMLElement>();
      for (const root of regions) for (let parent = root.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
      for (const parent of ancestors) locatorObserver.observe(parent, { childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-busy', 'data-w8rld-trade-contract', 'data-quantity', 'data-trade-side', 'data-w8rld-trade-side', 'data-w8rld-native-total', 'role', 'tabindex', 'contenteditable', 'aria-label'] });
    } else {
      // Broad discovery only until recognized regions appear. Never a poll.
      locatorObserver.observe(document.body ?? document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-busy', 'data-w8rld-trade-contract', 'href', 'data-trade-side', 'data-w8rld-trade-side', 'data-w8rld-native-total', 'role', 'tabindex', 'contenteditable', 'aria-label'] });
    }
    observerCount++;
  }
  function syncSource(): void {
    if (disposed || suspended || enabled !== true) return;
    const next = snapshot(); observe(next);
    if (current?.key === next.key) { current = next; if (next.valid) place(); return; }
    current = next; generation++; attemptedKey = undefined; attempts = 0; clearRefresh();
    if (!next.supported || !next.valid) { removePanel(); return; }
    render(next.items, next.valid ? 'Updating catalog data…' : 'Trade data unavailable: unsupported or incomplete layout.', next.valid ? 'loading' : 'unsupported');
    if (next.valid) refreshTimer = window.setTimeout(() => { refreshTimer = undefined; counts.refreshAttempts++; ready = true; pump(); }, REFRESH_DELAY_MS);
  }
  function onMutations(records: MutationRecord[]): void {
    counts.mutationCallbacks++;
    if (records.every((record) => owned(record.target) || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(owned)))) return;
    syncSource();
  }
  function isCurrent(version: number, key: string): boolean {
    if (disposed || suspended || enabled !== true || version !== generation || current?.key !== key) return false;
    // Re-scan before every commit, including before observer microtasks run.
    if (snapshot().key !== key) { syncSource(); return false; }
    return current.supported && current.valid;
  }
  function pump(): void {
    if (!ready || disposed || suspended || enabled !== true || !current?.valid || attemptedKey === current.key) return;
    if (snapshot().key !== current.key) { syncSource(); return; }
    if (pending.size >= MAX_PENDING) { render(current.items, 'Catalog unavailable: waiting for pending worker requests.', 'error'); return; }
    const requested = current; const version = generation; const id = ++requestId;
    attemptedKey = requested.key; ready = false; attempts++; counts.workerMessages++;
    const request: { timer?: number } = {}; pending.set(id, request);
    const finish = (rawResponse?: unknown, error?: string) => {
      if (!pending.delete(id)) return;
      if (request.timer !== undefined) window.clearTimeout(request.timer);
      if (isCurrent(version, requested.key)) {
        const response = parseLookupReply(rawResponse, [...new Set(requested.items.map((item) => item.assetId))]);
        const quotes = new Map(response?.ok === true ? response.quotes.map((quote) => [quote.assetId, quote]) : []);
        const usdQuotes = new Map(response?.ok === true ? response.usdQuotes?.map((quote) => [quote.assetId, quote]) : []);
        const unavailable = error || (response?.ok !== true ? (typeof response?.error === 'string' ? response.error.slice(0, 256) : 'Catalog unavailable.') : '');
        render(requested.items.map((item) => ({ ...item, ...(!unavailable && quotes.has(item.assetId) ? { quote: quotes.get(item.assetId) } : {}), ...(!unavailable && usdQuotes.has(item.assetId) ? { usdQuote: usdQuotes.get(item.assetId) } : {}), ...(!unavailable&&response?.ok?{demandQuote:response.demandQuotes?.find(q=>q.assetId===item.assetId)}:{}) })), unavailable, response?.ok === false && response.code === 'PROVIDER_DISABLED' ? 'disabled' : unavailable ? 'error' : 'ready', !unavailable&&response?.ok?response.facts:[]);
        const failures = response?.ok === true ? Object.values(response.providers ?? {}).filter(p => p.state === 'unavailable' || p.state === 'stale') : [];
        if ((unavailable || failures.length) && !(response?.ok === false && response.code === 'PROVIDER_DISABLED') && attempts < 3) {
          const delay = Math.max(attempts * 1000, ...failures.map(p => (p.retryAt ?? Date.now() + 60_000) - Date.now()));
          refreshTimer = window.setTimeout(() => { refreshTimer = undefined; if (isCurrent(version, requested.key)) { attemptedKey = undefined; ready = true; pump(); } }, Math.min(delay, 2_147_483_647));
        }
      }
      pump();
    };
    request.timer = window.setTimeout(() => {
      request.timer = undefined;
      // A terminated MV3 worker may never invoke its callback. Release this
      // slot; the per-snapshot three-attempt limit still bounds retries, and
      // pending.delete makes every late callback harmless.
      finish(undefined, 'Catalog unavailable: worker response timed out.');
    }, REQUEST_DEADLINE_MS);
    try {
      extension.runtime.sendMessage({ type: 'w8rld:limited-lookup', assetIds: [...new Set(requested.items.map((item) => item.assetId))] }, (response?: unknown) => {
        const disconnected = extension.runtime.lastError;
        finish(response, disconnected ? 'Catalog unavailable: extension worker disconnected.' : undefined);
      });
    } catch { finish(undefined, 'Catalog unavailable: extension worker disconnected.'); }
  }
  function applyEnabled(value: boolean): void {
    if (disposed || suspended || enabled === value) return;
    enabled = value; generation++; current = undefined; attemptedKey = undefined; clearRefresh();
    sourceObserver.disconnect(); locatorObserver.disconnect(); observerCount = 0; observedRoots = [];
    if (!value) removePanel(); else syncSource();
  }
  function readPreference(): void {
    const revision = preferenceRevision; counts.storageReads++;
    void (async () => {
      try {
        const settings = await extension.storage.sync.get({ enabled: true });
        if (revision === preferenceRevision) applyEnabled(settings?.enabled !== false);
      } catch { if (revision === preferenceRevision) { storageNotice = 'Preferences unavailable; using the enabled default.'; applyEnabled(true); } }
    })();
  }
  const storageChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'sync' || !Object.prototype.hasOwnProperty.call(changes, 'enabled')) return;
    preferenceRevision++; storageNotice = ''; applyEnabled(changes.enabled.newValue !== false);
  };
  extension.storage.onChanged.addListener(storageChanged); listeners.push(() => extension.storage.onChanged.removeListener(storageChanged));
  const routeChanged = () => { try { syncSource(); } catch {
    emitContentDiagnostic(extension, { code: 'W8RLD-EXT-NAVIGATION-001', status: 'failed', enabled: 'yes', page: 'trades' });
  } }; const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  const recover = () => {
    if (lastRender && lastRender.phase !== 'ready' && !pending.size && attempts >= 3) { attempts = 0; attemptedKey = undefined; ready = true; }
    syncSource(); if (ready) pump();
  };
  if (navigation) listen(navigation, 'currententrychange', routeChanged);
  listen(window, 'popstate', routeChanged); listen(window, 'hashchange', routeChanged); listen(window, 'focus', recover); listen(document, 'visibilitychange', routeChanged);
  listen(window, 'pagehide', ((event: PageTransitionEvent) => {
    if (!event.persisted) { lifecycle.dispose(); return; }
    suspended = true; generation++; clearRefresh(); if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; sourceObserver.disconnect(); locatorObserver.disconnect(); observerCount = 0;
    for (const request of pending.values()) if (request.timer !== undefined) window.clearTimeout(request.timer);
    pending.clear();
  }) as EventListener);
  listen(window, 'pageshow', () => { if (suspended) { suspended = false; enabled = undefined; current = undefined; readPreference(); } });
  const lifecycle: ContentLifecycle = {
    setPreferences: value => { preferences = value; renderedKey = ''; if (lastRender) render(lastRender.items, lastRender.message, lastRender.phase,lastRender.facts); },
    stats: () => ({ ...counts, activeTimers: Number(refreshTimer !== undefined) + Number(expiryTimer !== undefined) + [...pending.values()].filter((request) => request.timer !== undefined).length, activeObservers: observerCount, activeListeners: listeners.length, pendingRequests: pending.size }),
    dispose: () => {
      if (disposed) return;
      disposed = true; generation++; preferenceRevision++; clearRefresh(); if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; sourceObserver.disconnect(); locatorObserver.disconnect(); observerCount = 0;
      for (const request of pending.values()) if (request.timer !== undefined) window.clearTimeout(request.timer);
      pending.clear(); listeners.splice(0).forEach((remove) => remove()); removePanel();
      if (owners[OWNER] === lifecycle) delete owners[OWNER];
    },
  };
  owners[OWNER] = lifecycle; readPreference(); return lifecycle;
}
const extension = (globalThis as unknown as { chrome?: any }).chrome;
if (extension?.storage?.sync && extension.runtime) {
  try {
  startNativeSettings(extension);
  let lifecycle: ContentLifecycle | undefined;
  const companion = startCompanion(extension, value => lifecycle?.setPreferences(value));
  lifecycle = startContentScript(extension, (items, ready, incomplete, facts) => companion.trade(items, ready, incomplete, facts));
  const route = companionRoute(location.href);
  const page = route === 'marketplace' ? 'catalog' : route === 'subscription' ? 'unknown' : route ?? 'unknown';
  emitContentDiagnostic(extension, { code: 'W8RLD-EXT-CONTENT-002', status: 'ready', enabled: 'unknown', stage: 'content-start', page });
  } catch {
    emitContentDiagnostic(extension, { code: 'W8RLD-EXT-CONTENT-001', status: 'failed', enabled: 'unknown', stage: 'content-start' });
  }
}
