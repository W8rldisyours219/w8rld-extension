/*! Native item rows and reseller comparison adapted from RoUtility (MIT).
 * Copyright (c) 2026 RoUtility. src/core/content.js: nativeRow, markDeals,
 * injectItemRows at 403c75ed81f297e82ada6fccf084ae3fc2249def.
 * W8RLD: semantic dl rows, exact visible prices, shared fresh RAP, no purchases.
 * Hover facts follow src/features/items/itemcard.js::render, using cached data.
 * Full license: ../THIRD_PARTY_NOTICES.txt. */
/** Presentation only. Arithmetic and provider admission remain in shared core. */
import { analyzeTrade, QUOTE_FRESH_MS, type PricedTradeItem } from './core';
import type { Preferences } from './preferences';
import { demandBySide, displayNumber, freshQuote, itemTags, itemValueFields, itemValues, ownedRegion, signedNumber, signedPercent, usdAmount, usdExact } from './presentation';
import type { ItemFacts } from './protocol';
import { displayUsdTrade, usdDescription } from './usdDisplay';
import type { PublicSuggestion } from './publicSearch';
import {displayValue,displayValueTrade,demandText,itemDemand} from './valuation';
import {dollarIcon,nativeRobuxIcon} from './nativeIcons';
import {displayUsd} from './usdDisplay';

export type ListMetric = { key: string; label: string; give?: number; receive?: number; difference?: number; percent?: number; usd?: boolean; description?: string };
export function listMetrics(items: readonly PricedTradeItem[], incomplete: boolean, preference: Preferences['tradeListMetrics'], preferences?: Preferences): ListMetric[] {
  const a = analyzeTrade(items.map(i => ({ ...i, quote: freshQuote(i) })));
  const u = displayUsdTrade(items, incomplete, preferences);
  const field = (key: 'rap' | 'estimatedValue', label: string): ListMetric => {
    if(key==='estimatedValue'){
      const v=displayValueTrade(items,incomplete,preferences);
      const amount=(side:'give'|'receive')=>v[side].total>0&&v[side].covered===v[side].total&&!incomplete?v[side].value:undefined;
      return {key,label:v.label,give:amount('give'),receive:amount('receive'),difference:v.difference,percent:v.percent,
        description:`${v.description} Giving ${v.give.covered}/${v.give.total}; receiving ${v.receive.covered}/${v.receive.total} copies covered. Curated ${v.give.curatedCovered+v.receive.curatedCovered}; RAP estimated ${v.give.rapCovered+v.receive.rapCovered}.`};
    }
    const coverage = key === 'rap' ? 'rapCovered' : 'estimatedCovered';
    const side = (s: 'give' | 'receive') => !incomplete && a[s].itemCount > 0 && a[s][coverage] === a[s].itemCount ? a[s][key] : undefined;
    return { key, label, give: side('give'), receive: side('receive'),
      difference: incomplete ? undefined : key === 'rap' ? a.rapDifference : a.estimatedDifference,
      percent: incomplete ? undefined : key === 'rap' ? a.rapPercent : a.estimatedPercent };
  };
  const usd: ListMetric = { key: 'usd', label: '$', usd: true,
    description: usdDescription(u.method, preferences?.usdPerThousandRobux),
    give: u.difference === undefined ? undefined : u.give, receive: u.difference === undefined ? undefined : u.receive,
    difference: u.difference, percent: u.percent };
  const metrics = preference === 'rap-usd' ? [field('rap', 'RAP'), usd]
    : preference === 'value-usd' ? [field('estimatedValue', 'Value'), usd] : [field('rap', 'RAP'), field('estimatedValue', 'Value')];
  // RoUtility core/ui.js::shows: apply the display policy at the shared
  // presentation boundary, including row pills and both preview sides.
  return metrics.filter(m => m.key === 'rap' ? preferences?.showRap !== false
    : m.key === 'usd' ? preferences?.showUsd !== false : preferences?.showValue !== false);
}
/** Keep the saved pair first, then admit the remaining independently covered
 * metric. The original pair policy remains available to totals/previews. */
export function tradeRowMetrics(items: readonly PricedTradeItem[], incomplete: boolean, preferences: Preferences): ListMetric[] {
  const leading = listMetrics(items, incomplete, preferences.tradeListMetrics, preferences);
  const extra = [...listMetrics(items,incomplete,'rap-value',preferences), ...listMetrics(items,incomplete,'rap-usd',preferences)];
  return [...new Map([...leading,...extra.filter(m=>m.difference!==undefined)].map(m=>[m.key,m])).values()];
}
export const metricAmount = (m: ListMetric, value: number | undefined, compact = false) => value === undefined ? 'N/A' : m.usd ? usdAmount(value, { symbol: false, compact }) : `R$ ${displayNumber(value, compact)}`;
export function metricDifference(m: ListMetric, compact = false): string {
  if (m.difference === undefined) return 'N/A';
  const n = Math.abs(m.difference); const sign = m.difference < 0 ? '−' : '+';
  const amount = m.usd ? usdAmount(m.difference, { signed: true, compact }) : compact && n >= 1_000 ? `${sign}${displayNumber(n, true)} R$`
    : `${signedNumber(m.difference)} R$`;
  return `${amount}${m.percent === undefined ? '' : ` (${signedPercent(m.percent)}%)`}`;
}
export function differenceNode(m: ListMetric, compact = false): HTMLElement {
  const node = document.createElement('span'); node.className = 'w8rld-difference'; node.dataset.metric = m.key;
  node.dataset.sign = m.difference === undefined ? 'unavailable' : m.difference > 0 ? 'positive' : m.difference < 0 ? 'negative' : 'neutral';
  const label = document.createElement('span'); label.className = 'w8rld-value-label'; label.textContent = m.usd && m.difference !== undefined ? '' : `${m.label} `;
  const value = document.createElement('span'); const text=metricDifference(m,compact),split=text.indexOf(' (');
  const amount=document.createElement('span');amount.className='w8rld-difference-amount';amount.textContent=split<0?text:text.slice(0,split);value.append(amount);
  if(split>=0){const percent=document.createElement('span');percent.className='w8rld-difference-percent';percent.textContent=text.slice(split+1);value.append(document.createTextNode(' '),percent);}node.append(label,value);
  node.setAttribute('aria-label', `${m.label}: ${metricDifference(m)}.${m.usd && m.difference !== undefined ? ` Unrounded difference: ${usdExact(m.difference)}; giving ${usdExact(m.give!)}; receiving ${usdExact(m.receive!)}.` : ''} Receiving minus giving; Limited items only.${m.percent === undefined ? ' Percentage unavailable without complete positive giving.' : ` Exact percentage ${m.percent}%.`}`);
  node.title = `${node.getAttribute('aria-label')!} ${m.description ?? ''}`; return node;
}

export type Box = { left: number; top: number; right: number; bottom: number };
/*! Centred/clamped tooltip placement adapted from RoUtility core/ui.js::showTip,
 * Copyright (c) 2026 RoUtility, MIT. W8RLD adds bounded alternatives and native
 * control exclusion. Full license: ../THIRD_PARTY_NOTICES.txt. */
export function hoverPosition(anchor: Box, width: number, height: number, viewport: {width: number; height: number}, protectedBoxes: Box[], sideFirst = false) {
  if (![width,height,viewport.width,viewport.height,anchor.left,anchor.top,anchor.right,anchor.bottom].every(Number.isFinite) || width <= 0 || height <= 0) return;
  const gap = 8;
  const clamp = (n: number, max: number) => Math.max(gap, Math.min(n, max-gap));
  const left = clamp((anchor.left+anchor.right-width)/2, viewport.width-width);
  const top = clamp(anchor.top, viewport.height-height);
  const vertical = [{left,top:anchor.bottom+gap},{left,top:anchor.top-height-gap}];
  const sides = [{left:anchor.right+gap,top},{left:anchor.left-width-gap,top}];
  // Native catalog cards have action controls in adjacent rows. The upstream
  // side placement can remain beside this card by sliding past those controls;
  // four fixed rectangles alone incorrectly suppress otherwise safe previews.
  const shifted = sideFirst ? [...new Set([gap, ...protectedBoxes.flatMap(b => [clamp(b.bottom+gap,viewport.height-height),clamp(b.top-height-gap,viewport.height-height)])])]
    .sort((a,b) => Math.abs(a-top)-Math.abs(b-top))
    .flatMap(top => sides.map(p => ({left:p.left,top}))) : [];
  return (sideFirst ? [...sides,...vertical,...shifted] : [...vertical,...sides]).find(p =>
    p.left >= gap && p.top >= gap && p.left+width <= viewport.width-gap && p.top+height <= viewport.height-gap
    && [anchor,...protectedBoxes].every(b => p.left+width <= b.left || p.left >= b.right || p.top+height <= b.top || p.top >= b.bottom));
}
/** Adapt RoUtility trades.js::openPreview/place beside the native row/list.
 * Try either side without covering rows, scrollbars or native action controls;
 * the caller retains its in-flow fallback when neither side fits. */
export function previewPosition(row: Box, list: Box, width: number, height: number, viewport: { width: number; height: number }, protectedBoxes: Box[]) {
  const gap = 8; const clamp = (n: number) => Math.max(gap, Math.min(n, viewport.height - height - gap));
  const tops = [clamp(row.top), gap, ...protectedBoxes.flatMap(b => [b.bottom + gap, b.top - height - gap])];
  const candidates = [list.right + gap, list.left - width - gap].flatMap(left => tops.map(top => ({ left, top })));
  return candidates.find(p => p.left >= gap && p.top >= gap && p.left + width <= viewport.width - gap && p.top + height <= viewport.height - gap
    && [list, ...protectedBoxes].every(b => p.left + width <= b.left || p.left >= b.right || p.top + height <= b.top || p.top >= b.bottom));
}

/** Semantic price row only; never choose a purchase form or an interactive root.
 * Unknown structures keep the compact research directly after the unique title. */
export function nativeListingAmount(text: string): number | undefined {
  const value=text.trim().replace(/^R\$\s*/, '');
  // Genuine Roblox renders integer asks with locale-dependent grouping. Admit
  // complete 3-digit groups only; compact/decimal/ambiguous strings stay absent.
  if(!/^(?:\d+|\d{1,3}(?:([,.\u00a0\u202f ])\d{3})(?:\1\d{3})*)$/.test(value))return;
  const amount=Number(value.replace(/[,\.\u00a0\u202f ]/g,''));return Number.isSafeInteger(amount)?amount:undefined;
}

export function itemPriceAnchor(main: HTMLElement, heading: HTMLElement, isVisible: (n: HTMLElement) => boolean): { summary: HTMLElement; usd?: HTMLElement; nativePrice?: number } {
  const labels = [...main.querySelectorAll<HTMLElement>('dt,span,div')].filter(n => !n.children.length && !n.closest('[data-w8rld-owned]')
    && n.textContent?.trim().replace(/:$/, '').toLowerCase() === 'best price');
  if (labels.length !== 1) return { summary: heading };
  const label = labels[0];
  // Observed on the guarded disposable live Limited page. The price value is
  // a noninteractive sibling above the caption and purchase-button container.
  const nativeRow = label.parentElement;
  const prices = nativeRow?.querySelectorAll<HTMLElement>(':scope > .price-info > .item-price-value');
  if (label.matches('.price-label') && nativeRow?.matches('.item-info-row-container') && prices?.length === 1
    && !nativeRow.closest('a,button,form,[role="button"]') && isVisible(nativeRow) && isVisible(prices[0])
    && !prices[0].querySelector('button,a,input,form,[role="button"]')) {
    const info = heading.closest('.item-details-info-content');
    const section = info?.querySelector<HTMLElement>(':scope > .item-details-section');
    const rows = section && [...section.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n.matches('.item-info-row-container') && !n.hasAttribute('data-w8rld-owned'));
    const text = [...prices[0].childNodes].filter(n => !(n instanceof Element) || !n.closest('[data-w8rld-owned]')).map(n => n.textContent ?? '').join('').trim();
    const description=rows?.findIndex(n=>n.matches('.toggle-target'))??-1;
    return { summary: description>0?rows![description-1]:rows?.at(-1)??nativeRow, usd: prices[0], nativePrice: nativeListingAmount(text) };
  }
  // The native mobile breakpoint hides only the label. Unknown hidden labels
  // still cannot establish an insertion point outside the observed structure.
  if (!isVisible(label)) return { summary: heading };
  if (label.tagName === 'DT') {
    const value = label.nextElementSibling;
    if (value instanceof HTMLElement && value.tagName === 'DD' && isVisible(value) && !value.querySelector('button,a,input,form') && /\d/.test(value.textContent ?? '')) return { summary: value };
  }
  for (let row = label.parentElement, depth = 0; row && row !== main && depth < 3; row = row.parentElement, depth++) {
    if (row.contains(heading) || row.closest('a,button,form,[role="button"]') || row.querySelector('button,input,select,textarea,form')) break;
    if (isVisible(row) && /\d/.test(row.textContent ?? '') && !['TABLE', 'TBODY', 'TR', 'UL', 'OL'].includes(row.tagName)) return { summary: row };
  }
  return { summary: heading };
}

export function itemResearch(item: PricedTradeItem, fact: ItemFacts | undefined, flags: boolean, usdInline = false, nativePrice?: number, preferences?: Preferences, nativeLabels: readonly string[] = []): HTMLElement {
  const node = ownedRegion('Limited item valuation'); node.classList.add('w8rld-item-research');
  const q = freshQuote(item);
  const primary = document.createElement('dl'); primary.className = 'w8rld-item-primary';
  const secondary = document.createElement('dl'); secondary.className = 'w8rld-item-secondary';
  const row = (list: HTMLElement, label: string, value: string, numeric?: number, unit = '') => {
    if(nativeLabels.some(n=>n.toLowerCase()===label.toLowerCase()))return;
    // Keep nativeRow's label/value tree, with owned layout classes: Roblox's
    // row-label flex-basis/min-width is 150px and becomes a 150px-tall label
    // inside a column grid. Native row classes must remain on native rows only.
    const wrap = document.createElement('div'); wrap.className = 'w8rld-item-stat';
    const name = document.createElement('dt'); name.className = 'text-label w8rld-stat-label'; name.textContent = label;
    const amount = document.createElement('dd'); amount.className = 'font-body w8rld-stat-value';
    if(numeric!==undefined&&unit)amount.append(unit==='USD'?dollarIcon():nativeRobuxIcon());
    amount.append(document.createTextNode(numeric === undefined ? value : unit==='USD'?usdAmount(numeric,{symbol:false,compact:preferences?.compactNumbers}):displayNumber(numeric, preferences?.compactNumbers)));
    wrap.title = `${label}: ${value}`; wrap.setAttribute('aria-label', wrap.title); wrap.append(name, amount); list.append(wrap);
  };
  if (preferences?.showRap !== false) row(primary, 'RAP', q?.rap === undefined ? 'N/A' : `R$ ${q.rap.toLocaleString('en-US')}`, q?.rap, 'R$ ');
  const valuation=displayValue(item,preferences);
  if (preferences?.showValue !== false) row(primary, valuation.method==='rap'?'Estimated (RAP)':'Value', valuation.value === undefined ? 'N/A' : `R$ ${valuation.value.toLocaleString('en-US')}`, valuation.value, 'R$ ');
  const usd=displayUsd(item,preferences);
  if(!usdInline&&preferences?.showUsd!==false&&usd.value!==undefined)row(primary,usd.method==='rap-estimate'?'USD (RAP)':'USD',`Unrounded ${usdExact(usd.value)}. `+usdDescription(usd.method,preferences?.usdPerThousandRobux),usd.value,'USD');
  if (preferences?.itemDemand !== false && itemDemand(item)) row(primary, 'Demand', demandText(itemDemand(item)));
  if (preferences?.itemTrend !== false && q?.trend && q.trend !== 'Unavailable') row(primary, 'Trend', q.trend);
  if (preferences?.itemCopies !== false && fact?.copies !== undefined) row(secondary, 'Copies', fact.copies.toLocaleString('en-US'), fact.copies);
  if (preferences?.itemCopies !== false && fact?.premiumCopies !== undefined && (fact.copies===undefined||fact.premiumCopies<=fact.copies)) row(secondary, 'Premium copies', fact.premiumCopies.toLocaleString('en-US'), fact.premiumCopies);
  if (preferences?.itemCopies !== false && fact?.hoardShare !== undefined) row(secondary, 'Hoarded', `${(fact.hoardShare*100).toLocaleString('en-US',{maximumFractionDigits:1})}% of copies`);
  if (preferences?.lowestListing !== false) {
    if (nativePrice===undefined&&fact?.bestPrice!==undefined) row(secondary, 'Lowest listing', `R$ ${fact.bestPrice.toLocaleString('en-US')}`, fact.bestPrice, 'R$ ');
    const ask=nativePrice??fact?.bestPrice;
    if (q?.rap && q.rap > 0 && ask!==undefined) row(secondary, 'Listing vs RAP', `${signedPercent((ask - q.rap) / q.rap * 100)}%`);
  }
  node.append(primary); if (secondary.children.length) node.append(secondary);
  if (flags) node.append(...itemTags(item));
  return node;
}

/*! Native card tree: RoUtility src/core/content.js::similarCard. Search row:
 * src/features/search/search.js::row. Thumbnail: trades.js::previewSide.
 * Copyright (c) 2026 RoUtility. MIT; full notice in ../THIRD_PARTY_NOTICES.txt.
 * W8RLD retains canonical IDs, fresh providers, privacy, independent metrics,
 * safe image URLs and account-action refusal. No upstream logo. */
export function nativeThumbnail(fact: ItemFacts | undefined, privacy: boolean, size: number, source?: HTMLCanvasElement): HTMLElement {
  const thumb=document.createElement('span');thumb.className='thumbnail-2d-container w8rld-native-thumbnail';thumb.setAttribute('aria-hidden','true');
  if(!privacy&&source){const copy=document.createElement('canvas');copy.width=copy.height=size;copy.getContext('2d')?.drawImage(source,0,0,size,size);thumb.append(copy);}
  else if(!privacy&&fact?.thumbnailUrl&&fact.retrievedAt<=Date.now()&&Date.now()-fact.retrievedAt<QUOTE_FRESH_MS){
    const status=document.createElement('span');status.textContent='…';thumb.append(status);thumb.title='Loading thumbnail';
    const img=document.createElement('img');img.alt='';img.width=img.height=size;img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';img.loading='lazy';img.decoding='async';
    img.addEventListener('load',()=>{status.remove();thumb.title='';},{once:true});
    img.addEventListener('error',()=>{img.remove();status.textContent='—';thumb.title='Thumbnail unavailable';},{once:true});img.src=fact.thumbnailUrl;thumb.append(img);
  }else{thumb.title=privacy?'Limited item':'Thumbnail unavailable';if(!privacy)thumb.textContent='—';}
  return thumb;
}

/*! RoUtility trades.js::previewSide and routility-tp-thumb (MIT), Copyright
 * (c) 2026 RoUtility. Reuse side/thumbnail trees for rows and previews. W8RLD
 * adds visible per-item quotes and retains independent freshness/coverage. */
export function tradeSideItems(items: readonly PricedTradeItem[], side: 'give'|'receive', preferences: Preferences, facts?: ReadonlyMap<string,ItemFacts>, sources?: ReadonlyMap<string,HTMLCanvasElement>, detailed = false): HTMLElement {
  const strip=document.createElement('div');strip.className=detailed?'w8rld-preview-thumbnails':'w8rld-row-side';
  strip.setAttribute('aria-label',side==='give'?'Giving items':'Receiving items');
  if(!detailed){const label=document.createElement('span');label.className='w8rld-value-label';label.textContent=side==='give'?'Give':'Get';strip.append(label);}
  for(const item of items.filter(i=>i.side===side)){
    const entry=document.createElement('span');entry.className=detailed?'w8rld-preview-item-detail':'w8rld-row-item';
    const thumb=document.createElement('span');thumb.className='w8rld-preview-item';
    thumb.append(nativeThumbnail(facts?.get(item.assetId),preferences.privacyMode,40,sources?.get(item.assetId)));
    const name=preferences.privacyMode?'Limited item':item.name;
    const fields=itemValueFields(item,false,preferences);entry.title=`${name} ×${item.quantity}. ${fields.map(f=>`${f.label}: ${f.exact}`).join(' · ')}`;
    entry.setAttribute('aria-label',entry.title);
    if(item.quantity>1){const quantity=document.createElement('small');quantity.className='w8rld-preview-quantity';quantity.textContent=`×${item.quantity}`;thumb.append(quantity);}
    entry.append(thumb);
    if(detailed){const body=document.createElement('span');body.className='w8rld-preview-item-body';const title=document.createElement('strong');title.textContent=name;body.append(title,itemValues(item,false,false,false,preferences,false));entry.append(body);}
    strip.append(entry);
  }
  return strip;
}

export function tradeDemandComparison(items: readonly PricedTradeItem[], incomplete: boolean, preferences: Preferences): HTMLElement | undefined {
  if(!preferences.itemDemand)return;
  const demand=demandBySide(items,incomplete,preferences);
  if(demand.give.value.startsWith('N/A')||demand.receive.value.startsWith('N/A'))return;
  const node=document.createElement('small');node.className='w8rld-row-demand';
  node.textContent=`Demand ${demand.give.value} → ${demand.receive.value}`;node.title=demand.detail;node.setAttribute('aria-label',demand.value);return node;
}

/** Direct native Roblox wrapper/caption hierarchy from upstream similarCard.
 * Native Robux and the attributed dollar glyph replace branded price artwork. */
export function similarItemCard(item: PricedTradeItem, fact: ItemFacts | undefined, preferences: Preferences, source?: HTMLCanvasElement): HTMLElement {
  const entry=document.createElement('div');entry.className='item-list-item-card w8rld-similar-entry';entry.setAttribute('role','listitem');
  const inner=document.createElement('div');const card=document.createElement('div');card.className='list-item item-card grid-item-container';
  const box=document.createElement('div');box.className='item-card-container';
  const link=document.createElement('a');link.className='item-card-link w8rld-similar-item';link.href=`/catalog/${item.assetId}`;
  const thumb=document.createElement('div');thumb.className='item-card-thumb-container w8rld-similar-thumbnail';
  const thumbInner=document.createElement('div');thumbInner.className='item-card-thumb-container-inner';
  const holder=document.createElement('div');holder.append(nativeThumbnail(fact,preferences.privacyMode,128,source));thumbInner.append(holder);thumb.append(thumbInner);
  const limited=document.createElement('span');limited.className='restriction-icon icon-limited-label';limited.setAttribute('aria-hidden','true');thumb.append(limited);
  if(preferences.itemFlags){const tags=document.createElement('span');tags.className='w8rld-card-tags';tags.append(...itemTags(item));if(tags.children.length)thumb.append(tags);}
  const caption=document.createElement('div');caption.className='item-card-caption';
  const nameLink=document.createElement('div');nameLink.className='item-card-name-link';
  const name=document.createElement('div');name.className='item-card-name w8rld-similar-name';name.textContent=preferences.privacyMode?'Limited item':item.name;name.title=name.textContent;nameLink.append(name);
  const values=document.createElement('dl');values.className='w8rld-similar-value';
  // Recommendations display curated Value only; neither explicit RAP display
  // fallback may masquerade as the observation which selected this candidate.
  for(const field of itemValueFields(item,false,{...preferences,valueFallback:'off',usdFallback:'off'}).filter(f=>f.label!=='Value'||item.quote?.estimatedValue!==undefined)){
    const row=document.createElement('div');row.className='item-card-price font-header-2 text-subheader margin-top-none';row.title=field.description;row.setAttribute('aria-label',`${field.label}: ${field.exact}`);
    const label=document.createElement('dt');label.textContent=field.label==='$'?'USD':field.label;
    const amount=document.createElement('dd');amount.className='text-robux-tile';
    if(field.text!=='N/A')amount.append(field.label==='$'?dollarIcon():nativeRobuxIcon());
    amount.append(document.createTextNode(field.text.replace(/^(?:R\$|\$)\s*/,'')));row.append(label,amount);
    if(field.usdMethod){row.dataset.usdMethod=field.usdMethod;values.dataset.usdMethod=field.usdMethod;}values.append(row);
  }
  caption.append(nameLink,values);link.append(thumb,caption);box.append(link);card.append(box);inner.append(card);entry.append(inner);return entry;
}

/** Same compact thumbnail/body/secondary-label tree as upstream row. */
export function limitedSearchRow(item: PricedTradeItem, fact: ItemFacts | undefined, preferences: Preferences): HTMLElement {
  const row=ownedRegion('Public Limited search result');row.classList.add('w8rld-limited-suggestion');
  // Catalog identities are public, unlike owned items and account previews.
  // Privacy mode must not turn a verified search hit into an anonymous quote.
  const link=searchLink(`/catalog/${item.assetId}`,item.name,'Limited');
  const body=link.querySelector('.w8rld-search-item-body')!;
  if(preferences.itemFlags)body.querySelector('small')!.append(...itemTags(item));
  body.append(itemValues(item,false,false,false,preferences,false));
  link.prepend(nativeThumbnail(fact,false,58));row.append(link);return row;
}

/** Shared title/subtitle tree directly adapted from search.js::row. Public
 * suggestions have no thumbnail contract: no fake image or additional request. */
function searchLink(href: string, title: string, subtitle: string): HTMLAnchorElement {
  const link=document.createElement('a');link.href=href;link.className='w8rld-search-item';
  const body=document.createElement('span');body.className='w8rld-search-item-body';
  const name=document.createElement('strong');name.textContent=title;
  const type=document.createElement('small');type.textContent=subtitle;body.append(name,type);link.append(body);return link;
}

export function publicSearchRow(suggestion: PublicSuggestion, friend = false): HTMLAnchorElement {
  const label=friend?'Friend':suggestion.kind==='player'?'Player':'Experience';
  const subtitle=[label,suggestion.subtitle && suggestion.subtitle!==suggestion.name ? suggestion.subtitle : undefined].filter(Boolean).join(' · ');
  const link=searchLink(suggestion.kind==='player'?`/users/${suggestion.id}/profile`:`/games/${suggestion.id}`,suggestion.name,subtitle);
  link.classList.add('w8rld-public-suggestion');return link;
}

/** Upstream compact hover fact hierarchy. Missing metadata stays unavailable;
 * the separate explicit RAP fallback never changes provider observations. */
export function itemHoverFacts(item: PricedTradeItem, fact: ItemFacts | undefined, preferences: Preferences): HTMLElement {
  const list = document.createElement('dl'); list.className = 'w8rld-hover-facts'; const quote = freshQuote(item);
  const add = (label: string, value: string | number | undefined) => {
    if (value === undefined || value === 'Unavailable') return;
    const row = document.createElement('div'); const name = document.createElement('dt'); name.textContent = label;
    const amount = document.createElement('dd'); amount.textContent = typeof value === 'number' ? displayNumber(value, preferences.compactNumbers) : value;
    if (typeof value === 'number') { row.title = `${label}: ${value.toLocaleString('en-US')}`; row.setAttribute('aria-label', row.title); }
    row.append(name,amount); list.append(row);
  };
  if (preferences.itemDemand) add('Demand',demandText(itemDemand(item)));
  if (preferences.itemTrend) add('Trend',quote?.trend);
  if (preferences.itemCopies) {add('Copies',fact?.copies);add('Premium copies',fact?.premiumCopies);}
  if (preferences.itemCopies && fact?.hoardShare !== undefined) add('Hoarded',`${(fact.hoardShare*100).toLocaleString('en-US',{maximumFractionDigits:1})}% of copies`);
  return list;
}

/*! Direct header/prices/fact hierarchy from RoUtility itemcard.js::render,
 * MIT, Copyright (c) 2026 RoUtility, pinned commit in THIRD_PARTY_NOTICES.txt.
 * Native pixels/validated provider images replace upstream unrestricted URLs;
 * W8RLD's independent metrics and explicit fallback labels replace branded icons. */
export function itemPreviewBody(item: PricedTradeItem, fact: ItemFacts | undefined, preferences: Preferences, source?: HTMLCanvasElement): HTMLElement {
  const body = document.createElement('div'); body.className = 'w8rld-item-preview-body';
  const head = document.createElement('div'); head.className = 'w8rld-item-preview-head';
  const thumb = nativeThumbnail(fact, preferences.privacyMode, 44, source); thumb.classList.add('w8rld-item-preview-thumb');
  const names = document.createElement('div'); names.className = 'w8rld-item-preview-identity';
  const name = document.createElement('strong'); name.textContent = preferences.privacyMode ? 'Limited item' : item.name; name.title = name.textContent; names.append(name);
  if (preferences.itemFlags) { const tags = document.createElement('div'); tags.className = 'w8rld-item-preview-tags'; tags.append(...itemTags(item)); if (tags.children.length) names.append(tags); }
  head.append(thumb, names); body.append(head, itemValues(item, false, false, false, preferences,false));
  const facts = itemHoverFacts(item, fact, preferences); if (facts.children.length) body.append(facts);
  return body;
}

/*! Wearing grid from RoUtility avatar.js::renderWearing, MIT, Copyright (c)
 * 2026 RoUtility. Catalog links only; no equip/remove controls or extra reads.
 * Show provider-covered equipped items; never manufacture Limited status. */
export function avatarValueTiles(items: readonly PricedTradeItem[], facts: readonly ItemFacts[], preferences: Preferences): HTMLElement | undefined {
  const grid = document.createElement('ul'); grid.className = 'w8rld-avatar-value-tiles'; grid.setAttribute('aria-label', 'Valued equipped items');
  for (const item of items) {
    const fields = itemValueFields(item, false, preferences);
    if (!fields.some(f => f.text !== 'N/A')) continue;
    const li = document.createElement('li'); const link = document.createElement('a'); link.href = `/catalog/${item.assetId}`;
    const name = preferences.privacyMode ? 'Limited item' : item.name;
    link.title = `${name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}. ${fields.map(f => `${f.label}: ${f.exact}`).join('; ')}. Per-item observations.`;
    link.setAttribute('aria-label', link.title);
    link.append(nativeThumbnail(facts.find(f => f.assetId === item.assetId), preferences.privacyMode, 64));
    const caption = document.createElement('span'); caption.textContent = name; link.append(caption);
    if (item.quantity > 1) { const quantity = document.createElement('small'); quantity.textContent = `×${item.quantity}`; link.append(quantity); }
    li.append(link); grid.append(li);
  }
  return grid.children.length ? grid : undefined;
}
