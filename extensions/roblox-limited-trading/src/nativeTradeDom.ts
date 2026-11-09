import { catalogAssetId, type TradeItemInput, type TradeSide } from './core';

// Discovered on the authorized disposable account, 2026-10-26. Only this
// completed-detail layout is verified; incoming/outgoing/localized views are not.
export const NATIVE_TRADE_DOM_CONTRACT = {
  version: 'roblox-completed-detail-v1',
  liveVerified: true,
  scope: 'main > .content > #trades-web-app.trades-container .trades-list-detail',
} as const;

export type NativeSide = {
  side: TradeSide; root: HTMLElement; heading: HTMLElement; list: HTMLElement;
  total: HTMLElement; amount: HTMLElement;
  cards: { node: HTMLElement; link: HTMLAnchorElement; name: HTMLElement; item: TradeItemInput }[];
};
export type NativeTrade = {
  status: 'ABSENT' | 'AMBIGUOUS' | 'PASS'; reason?: string;
  sides: NativeSide[]; items: TradeItemInput[];
  unsupportedComponents?: number;
};

// No global text search, account/header traversal, attribute dumping, storage,
// network, event dispatch or host mutation. Only verified offer descendants.
export function inspectNativeTrade(doc: Document): NativeTrade {
  const ambiguous = (reason: string): NativeTrade => ({ status: 'AMBIGUOUS', reason, sides: [], items: [] });
  const scopes = doc.querySelectorAll<HTMLElement>(NATIVE_TRADE_DOM_CONTRACT.scope);
  if (!scopes.length) return doc.querySelector('main > .content > #trades-web-app.trades-container')
    ? ambiguous('trade-detail-scope') : { status: 'ABSENT', sides: [], items: [] };
  if (scopes.length !== 1) return ambiguous('trade-detail-scope');
  const hidden = (node: HTMLElement) => !!node.closest('[hidden],[inert],[aria-hidden="true"],[aria-busy="true"]')
    || (!!doc.defaultView && !node.getClientRects().length);
  if (hidden(scopes[0])) return ambiguous('visible-trade-detail');
  const roots = [...scopes[0].querySelectorAll<HTMLElement>('.trade-list-detail-offer')];
  if (roots.length !== 2 || roots[0].parentElement !== roots[1].parentElement
    || roots[0].parentElement?.children.length !== 2) return ambiguous('paired-offer-containers');
  const sides: NativeSide[] = [];
  let unsupportedComponents=0;
  let instances = 0;
  for (const root of roots) {
    if (hidden(root)) return ambiguous('visible-offer');
    const headings = root.querySelectorAll<HTMLElement>(':scope > h3.trade-list-detail-offer-header');
    if (headings.length !== 1 || headings[0].children.length) return ambiguous('offer-heading');
    const label = headings[0].textContent?.trim().toLowerCase().replace(/\s+/g, ' ');
    const side: TradeSide | undefined = label === 'items you gave' ? 'give' : label === 'items you received' ? 'receive' : undefined;
    if (!side || sides.some(s => s.side === side)) return ambiguous('give-receive-identity');
    const lists = root.querySelectorAll<HTMLElement>(':scope > ul.item-cards');
    // A Robux offer adds another native .robux-line beside Total Value.
    // Select the semantic total, never the first line or the offered amount.
    const lines=[...root.querySelectorAll<HTMLElement>(':scope > div > .robux-line')];
    const totals = lines.filter(line=>line.firstElementChild?.textContent?.trim().toLowerCase().replace(/[:\s]+$/g,'').replace(/\s+/g,' ')==='total value');
    unsupportedComponents+=lines.length-totals.length;
    if (lists.length !== 1 || totals.length !== 1) return ambiguous('card-list-or-native-total');
    const list = lists[0]; const total = totals[0];
    // The total wrapper is a direct offer child. Owned inline siblings may be
    // present after mounting; the original total itself must stay noninteractive.
    if (hidden(list) || hidden(total) || total.tagName !== 'DIV'
      || total.matches('[role],[tabindex],[contenteditable]')
      || total.closest('form,a,button,summary,label,[role="button"],[contenteditable]')
      || total.querySelector('a,button,input,select,textarea,form,[role],[tabindex],[contenteditable]')) return ambiguous('safe-native-total');
    const totalLabel = total.firstElementChild;
    const amounts = total.querySelectorAll<HTMLElement>(':scope > .robux-line-amount > .robux-line-value');
    if (!totalLabel || totalLabel.children.length
      || totalLabel.textContent?.trim().toLowerCase().replace(/[:\s]+$/g, '').replace(/\s+/g, ' ') !== 'total value'
      || amounts.length !== 1 || hidden(amounts[0]) || !/^[\d,\.\s]+$/.test(amounts[0].textContent ?? '')) return ambiguous('native-total-value');
    const cards: NativeSide['cards'] = [];
    if (!list.children.length) return ambiguous('existing-item-cards');
    for (const child of list.children) {
      if (!(child instanceof HTMLElement) || !child.matches('li.trade-item-card') || hidden(child)
        || ++instances > 100) return ambiguous('individual-card-boundaries');
      // Only individual copies are proven by this capture. An explicit quantity
      // or a new card-caption component requires fresh evidence, not a default.
      if (child.hasAttribute('data-quantity') || child.querySelector('[data-quantity]')) return ambiguous('native-quantity-representation');
      const links = child.querySelectorAll<HTMLAnchorElement>('a.item-card-link');
      const names = child.querySelectorAll<HTMLElement>('.item-card-name');
      const captions = child.querySelectorAll<HTMLElement>('.item-card-caption');
      if (links.length !== 1 || names.length !== 1 || names[0].children.length || captions.length !== 1
        || !links[0].contains(names[0]) || [...captions[0].children].some(n => !n.matches('.item-card-name-link,.item-card-price,[data-w8rld-owned].w8rld-item-values'))) return ambiguous('canonical-card-content');
      const assetId = catalogAssetId(links[0].getAttribute('href') ?? '', doc.baseURI);
      const name = names[0].textContent?.trim() ?? '';
      if (!assetId || !name || name.length > 256) return ambiguous('canonical-asset-or-name');
      cards.push({ node: child, link: links[0], name: names[0], item: { side, assetId, name, quantity: 1 } });
    }
    sides.push({ side, root, heading: headings[0], list, total, amount: amounts[0], cards });
  }
  return { status: 'PASS', sides, items: sides.flatMap(s => s.cards.map(c => c.item)), unsupportedComponents };
}
