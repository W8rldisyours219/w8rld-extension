import { type PricedTradeItem, type TradeSide } from './core';
import type { Preferences } from './preferences';
import { displayUsd, usdDescription } from './usdDisplay';
import {quoteFor,displayValue,demandText,itemDemand,weightedTradeDemand} from './valuation';
import {dollarIcon,nativeRobuxIcon} from './nativeIcons';
import { formatEstimate } from '../../../plugins/lib/displayPrecision';
export { freshUsd } from './usdDisplay';

export const ownedSelector = '[data-w8rld-owned]';
export const freshQuote = quoteFor;
export const signedNumber = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en-US')}`;
/** Display only: exact observations and arithmetic never use this text. */
export const displayNumber = (n: number, compact = false) => n.toLocaleString('en-US', compact ? {notation:'compact',maximumFractionDigits:1} : {});
export function signedPercent(n: number): string {
  if (!Number.isFinite(n)) return 'Unavailable';
  const formatted = formatEstimate(n, { unit: 'percent', signed: true });
  if (Math.abs(n) < 10_000) return formatted.text.replace(/(^| )-/, '$1−');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3, signDisplay: 'exceptZero' }).format(n);
  return `${Number(n.toPrecision(3)) === n ? '' : '≈ '}${compact}`.replace(/(^| )-/, '$1−');
}
/** Exact secondary text for the same original USD basis used in arithmetic. */
export function usdExact(n: number): string {
  return Number.isFinite(n) ? `${formatEstimate(n, { unit: 'USD' }).exact.replace(/^-/, '−')} USD` : 'N/A';
}
export function usdAmount(n: number, options: { symbol?: boolean; signed?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return 'N/A';
  const displayed = formatEstimate(n, { unit: 'USD', signed: options.signed });
  let text = displayed.text;
  if (options.compact && Math.abs(n) >= 1000) text = `${displayed.rounded ? '≈ ' : ''}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumSignificantDigits: 3, minimumFractionDigits: 0, ...(options.signed ? { signDisplay: 'exceptZero' as const } : {}) }).format(n)}`;
  return (options.symbol === false ? text.replace('$', '') : text).replace(/(^| )-/, '$1−');
}

/** W8RLD value-weighted 1–5 score; preserve qualitative counts and coverage. */
export function demandBySide(items: readonly PricedTradeItem[], incomplete = false, preferences?: Preferences) {
  const weighted=weightedTradeDemand(items,incomplete,preferences);
  const ratings = ['Terrible', 'Low', 'Normal', 'High', 'Amazing'] as const;
  const side = (kind: TradeSide) => {
    const rows = items.filter(i => i.side === kind); const counts = new Map<string, number>(); let missing = 0;
    for (const item of rows) {
      const label=itemDemand(item);
      if (!label) missing += item.quantity;
      else counts.set(label, (counts.get(label) ?? 0) + item.quantity);
    }
    const known = ratings.filter(r => counts.has(r));
    const text = known.length === 0 ? 'Unavailable' : known.length === 1 ? `${counts.get(known[0])} ${known[0]}` : `Mixed (${[...counts.values()].reduce((a, b) => a + b, 0)} items)`;
    const score=weighted[kind];
    return { value: `${score.value}${score.partial?' · Partial':''}`,
      partial: score.partial, detail: `${known.map(r => `${counts.get(r)} ${r}`).join(', ') || text}. ${missing} copies missing demand. ${score.detail}` };
  };
  const give = side('give'); const receive = side('receive');
  return { give, receive, value: weighted.give.score===undefined&&weighted.receive.score===undefined ? 'Unavailable' : `Giving: ${give.value} · Receiving: ${receive.value}${weighted.difference===undefined?'':` · Δ ${weighted.difference>=0?'+':''}${weighted.difference.toFixed(2)}`}`,
    partial: give.partial || receive.partial,
    detail: `Giving: ${give.detail}. Receiving: ${receive.detail}. W8RLD score = Σ(demand × Robux weight × quantity) / Σ(Robux weight × quantity). Weight is curated Value${preferences?.valueFallback==='rap'?' or explicitly enabled RAP fallback':''}; missing demand/weight excluded. Rolimon's (otherwise fresh Routility) Terrible/Low/Normal/High/Amazing maps to 1/2/3/4/5; this is not an official provider trade score.${give.partial || receive.partial ? ' Partial or unavailable evidence.' : ''}` };
}

export function ownedRegion(label: string): HTMLElement {
  const node = document.createElement('div'); node.className = 'w8rld-ext3'; node.dataset.w8rldOwned = '';
  node.setAttribute('role', 'group'); node.setAttribute('aria-label', label);
  return node;
}
export function inheritSurface(node: HTMLElement, anchor: HTMLElement): void {
  const surface = getComputedStyle(anchor); const ink = surface.color;
  if (node.style.getPropertyValue('--ink') !== ink) node.style.setProperty('--ink', ink);
  if (node.style.fontFamily !== surface.fontFamily) node.style.fontFamily = surface.fontFamily;
  let ground = 'Canvas';
  for (let n: HTMLElement | null = anchor; n; n = n.parentElement) {
    const color = getComputedStyle(n).backgroundColor;
    if (/^rgb\(/.test(color) || /, 1\)$/.test(color)) { ground = color; break; }
  }
  if (node.style.getPropertyValue('--ground') !== ground) node.style.setProperty('--ground', ground);
}
/** One formatter for native captions, Similar Price and preview descriptions.
 * RAP, curated Value and USD retain independent freshness and provenance. */
export function itemValueFields(item: PricedTradeItem, nativeRap = false, preferences?: Preferences) {
  const q = freshQuote(item); const estimate = displayUsd(item, preferences); const usd = estimate.value;
  const value=displayValue(item,preferences);
  return [
    {label:'RAP',value:q?.rap,enabled:!nativeRap&&preferences?.showRap!==false},
    {label:value.method==='rap'?'Estimated':'Value',value:value.value,enabled:preferences?.showValue!==false},
    {label:'$',value:usd,enabled:preferences?.showUsd!==false},
  ].filter(f=>f.enabled).map(f=>{
    const exact=f.value===undefined?'N/A':f.label==='$'?usdExact(f.value):`R$ ${displayNumber(f.value)}`;
    const text=f.value===undefined?'N/A':f.label==='$'?usdAmount(f.value,{compact:preferences?.compactNumbers}):`R$ ${displayNumber(f.value,preferences?.compactNumbers)}`;
    return {label:f.label,text,exact,description:f.label==='$'?`${exact}. ${usdDescription(estimate.method,preferences?.usdPerThousandRobux)}`:f.label==='Estimated'?`${exact}. Estimated Value from RAP; curated Value unavailable.`:`${f.label}: ${exact}`,usdMethod:f.label==='$'?estimate.method:undefined};
  });
}

/*! Badge markup adapted from RoUtility src/core/ui.js::cardTags (MIT).
 * Copyright (c) 2026 RoUtility; pinned 403c75ed81f297e82ada6fccf084ae3fc2249def.
 * No branded artwork. Only explicit fresh Rolimon's classifications qualify. */
export function itemTags(item: PricedTradeItem): HTMLElement[] {
  const q=freshQuote(item);
  return [q?.projected==='projected'?'Projected':'',q?.rare==='rare'?'Rare':''].filter(Boolean).map(flag=>{
    const tag=document.createElement('span');tag.className='w8rld-tag foundation-web-badge inline-flex items-center radius-circle padding-x-small';tag.dataset.flag=flag.toLowerCase();
    const text=document.createElement('span');text.className='text-no-wrap';text.textContent=flag;tag.append(text);
    tag.title=flag==='Projected'?"Rolimon's classifies this item as Projected. Recent RAP may be inflated.":"Rolimon's classifies this item as Rare.";
    tag.setAttribute('aria-label',tag.title);return tag;
  });
}

export function itemValues(item: PricedTradeItem, flags = true, nativeRap = false, details = false, preferences?: Preferences, includeDemand=true): HTMLElement {
  const node = ownedRegion('Limited item market observations'); node.classList.add('w8rld-item-values');
  const q = freshQuote(item); const estimate = displayUsd(item, preferences);
  for (const field of itemValueFields(item,nativeRap,preferences)) {
    const line = document.createElement('span'); line.className = 'w8rld-item-value item-card-price font-header-2 text-subheader margin-top-none';line.title=field.description;
    const name=document.createElement('span');name.className='w8rld-value-label';name.textContent=field.label==='$'&&field.text!=='N/A'?'':`${field.label} `;
    const amount=document.createElement('span');amount.className='text-robux-tile';
    if(field.text!=='N/A')amount.append(field.label==='$'?dollarIcon():nativeRobuxIcon());
    amount.append(document.createTextNode(field.text.replace(/^(?:R\$|\$)\s*/,'')));
    if(field.usdMethod)line.dataset.usdMethod=field.usdMethod;
    line.setAttribute('aria-label',`${field.label}: ${field.exact}`);line.append(name,amount);node.append(line);
  }
  if (details) for (const [label, value] of [['Demand', itemDemand(item)], ['Trend', q?.trend]]) {
    const line = document.createElement('span'); line.textContent = `${label}: ${label==='Demand'?demandText(value):value && value !== 'Unavailable' ? value : 'N/A'}`; node.append(line);
  }
  if(!details&&includeDemand&&preferences?.itemDemand!==false){
    const label=itemDemand(item);const line=document.createElement('small');line.className='w8rld-item-demand';line.textContent=`Demand ${demandText(label)}`;
    line.title=label?`W8RLD 1–5 mapping of ${q?.demand===label?"Rolimon's":'Routility'} ${label}; not an official provider numeric scale.`:'Demand unavailable.';node.append(line);
  }
  if (flags) node.append(...itemTags(item));
  node.title = `RAP, curated Value and classifications: Rolimon's. ${usdDescription(estimate.method, preferences?.usdPerThousandRobux)} Sources expire independently.`;
  return node;
}
