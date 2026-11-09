/*!
 * Native placement helpers adapted from RoUtility (MIT).
 * Copyright (c) 2026 RoUtility
 * Upstream: insane/routility-extension@403c75ed81f297e82ada6fccf084ae3fc2249def
 * Sources: src/features/trading/trades.js (findScrollParent, annotateRow,
 * valueLine), src/features/profile/profile.js (findPillRow, ensureInjected).
 * Also src/features/inventory/invsearch.js (initials, shortMatch, render).
 * W8RLD changes: bounded roots, unique anchors, owned nodes only, no transport.
 * Full permission and warranty notice: ../THIRD_PARTY_NOTICES.txt.
 */
import { ownedSelector } from './presentation';

/** Upstream word/acronym search, applied only to already visible records.
 * Canonical identity and curated acronym remain supplied by W8RLD's providers. */
export function loadedItemMatches(query: string, item: {assetId: string; name: string; acronym?: string}): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean); const compact = words.join('');
  const name = item.name.toLowerCase();
  const initials = name.replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean).map(w => w[0]).join('');
  return words.every(word => name.includes(word) || item.assetId === word)
    || compact.length >= 2 && item.acronym?.toLowerCase() === compact
    || compact.length >= 3 && initials === compact;
}

/** Keep the existing scroll owner, including a wrapper around the row children.
 * No custom scrollbar, wheel handler, global prototype or page-world bridge. */
export function nativeTradeList(scope: HTMLElement): { rows: HTMLElement; scroll: HTMLElement } | undefined {
  const first = scope.querySelector<HTMLElement>('.trade-row');
  const rows = first?.parentElement;
  if (!rows || rows.children.length > 1000 || [...rows.children].some(n => !n.matches('.trade-row'))) return;
  for (let node: HTMLElement | null = rows; node && node !== scope; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return { rows, scroll: node };
  }
  // The observed native ID can initially have overflow hidden while mounting.
  const native = rows.closest<HTMLElement>('#trade-row-scroll-container');
  return { rows, scroll: native && scope.contains(native) ? native : rows };
}

export function tradeIndicatorAnchor(row: HTMLElement): HTMLElement {
  const content = row.querySelectorAll<HTMLElement>(':scope > .trade-row-container');
  return content.length === 1 ? content[0] : row;
}

/** Attach after a unique native price inside its caption. Unknown synthetic
 * cards retain the existing append fallback, never a guessed descendant. */
export function placeCardValues(card: HTMLElement, values: HTMLElement): void {
  const captions = card.querySelectorAll<HTMLElement>('.item-card-caption');
  const prices = captions.length === 1 ? [...captions[0].children].filter((n): n is HTMLElement =>
    n instanceof HTMLElement && n.matches('.item-card-price') && !n.closest(ownedSelector)) : [];
  if (prices.length === 1) { if (prices[0].nextElementSibling !== values) prices[0].after(values); }
  else if (captions.length === 1 && prices.length === 0) { if (values.parentElement !== captions[0]) captions[0].append(values); }
  else {
    // inventory.js::usdLine also admits the unique native price on inventory
    // cards without item-card-caption. Keep that price and its controls owned
    // by Roblox; never take a descendant price from another annotated card.
    const nativePrices=[...card.querySelectorAll<HTMLElement>('.item-card-price')].filter(n=>!n.closest(ownedSelector)&&!n.closest('button,form,[role="button"]'));
    if(!captions.length&&nativePrices.length===1){if(nativePrices[0].nextElementSibling!==values)nativePrices[0].after(values);}
    else if (values.parentElement !== card) card.append(values);
  }
}

/*! RoUtility core/ui.js::cardTags, MIT, Copyright (c) 2026 RoUtility.
 * Admit only the unique native thumbnail owned by this card. The caller keeps
 * its existing caption fallback for unknown layouts and owns cleanup. */
export function cardTagsAnchor(card: HTMLElement): HTMLElement | undefined {
  const hosts = [...card.querySelectorAll<HTMLElement>('.item-card-thumb-container')]
    .filter(n => {
      const owner = n.closest('.item-card-container,.trade-item-card');
      return !n.closest(ownedSelector) && (owner === card || card.matches('.trade-item-card')
        && owner?.matches('.item-card-container') && owner.closest('.trade-item-card') === card);
    });
  return hosts.length === 1 ? hosts[0] : undefined;
}

/** The native social row is present on the reviewed current profile. Match the
 * current route's identity; do not pick a friend card's Followers link. */
export function portfolioAnchor(main: HTMLElement, kind: string): HTMLElement | undefined {
  // RoUtility avatar.js::wearHost; the reviewed current avatar editor owns this
  // column. The caller distinguishes the native equipped GET from card fallback.
  if (kind === 'avatar') {
    const hosts=main.querySelectorAll<HTMLElement>('#avatar-web-app .left-wrapper');
    if(hosts.length===1)return hosts[0];
  }
  if (kind === 'profile') {
    const id = /^\/users\/([1-9]\d*)\/profile\/?$/.exec(location.pathname)?.[1];
    if (!id) return;
    const links = [...main.querySelectorAll<HTMLAnchorElement>('.user-profile-header a[href]')].filter(a => {
      try { const u = new URL(a.href); return u.origin === location.origin && u.pathname === `/users/${id}/friends` && u.hash === '#!/followers'; } catch { return false; }
    });
    if (links.length === 1) return links[0].parentElement ?? undefined;
  }
  if (kind === 'inventory') {
    const titles = main.querySelectorAll<HTMLElement>('#inventory-container .page-content > h1');
    if (titles.length === 1) return titles[0];
  }
}
