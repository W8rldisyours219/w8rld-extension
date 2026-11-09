/** Admission for visible, semantic native records. No hidden state/API scraping. */
export function visible(node: Element): boolean {
  if (node.closest('[hidden],[inert],[aria-hidden="true"],[aria-busy="true"]') || !node.getClientRects().length) return false;
  let parent: Element | null = node;
  for (let depth = 0; parent && depth < 32; depth++, parent = parent.parentElement) {
    const style = parent.ownerDocument.defaultView?.getComputedStyle(parent);
    if (!style || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
  }
  return !parent;
}
const renderedText = (node: Element) => node instanceof HTMLElement ? node.innerText : node.textContent ?? '';
export function exactTimestamp(raw: string | null): number | undefined {
  if (!raw || raw.length > 40 || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d))?$/.test(raw)) return;
  const [year, month, day] = raw.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  if (calendar !== raw.slice(0, 10)) return;
  const n = Date.parse(raw); return Number.isFinite(n) && n > 0 && n <= Date.now() ? n : undefined;
}
export function ageLabel(time: number, now = Date.now()): string {
  const days = Math.floor((now - time) / 86400000);
  return days > 365 ? `${Math.floor(days / 365)}y ago` : days > 30 ? `${Math.floor(days / 30)}mo ago` : days ? `${days}d ago` : now - time >= 3600000 ? `${Math.floor((now - time) / 3600000)}h ago` : 'Today';
}
export function exactRobux(raw: string): number | undefined {
  const text = raw.trim().replace(/^(?:R\$|Robux)\s*/i, '').replace(/\s*(?:R\$|Robux)$/i, '')
    // Native transaction amount-display separates its explicit sign from the
    // digits with icon/layout whitespace. Do not normalize whitespace in digits.
    .replace(/^([+\u2212-])\s+(?=\d)/, '$1');
  if (!/^[+−-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return;
  const n = Number(text.replace(/,/g, '').replace('−', '-')); return Number.isSafeInteger(n) ? n : undefined;
}
export interface VisibleTransaction { amount: number; pending: boolean; date?: number; description: string; item?: string; creator?: string; experience?: string; }
export function visibleTransactions(table: HTMLTableElement): VisibleTransaction[] | undefined {
  if (!visible(table)) return;
  const headerCells = [...table.querySelectorAll('thead th')];
  // The genuine Roblox Purchases table omits thead: its first tbody row is
  // entirely th cells (Date / Source / Description / Amount). Keep explicit
  // semantic headers mandatory; ordinary data rows cannot establish columns.
  if (!headerCells.length) {
    const first = table.tBodies[0]?.rows[0];
    if (!first || !visible(first) || !first.cells.length || [...first.cells].some(n => n.tagName !== 'TH' || !visible(n))) return;
    headerCells.push(...first.cells);
  }
  const headers = headerCells.map(n => renderedText(n).trim().toLowerCase());
  const amount = headers.findIndex(t => t === 'amount' || t === 'robux');
  const description = headers.findIndex(t => t === 'description'); const status = headers.indexOf('status'); const date = headers.indexOf('date');
  if (amount < 0 || description < 0) return;
  const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')];
  if (rows.length > 200) return;
  const result: VisibleTransaction[] = [];
  for (const row of rows) {
    if (!visible(row)) continue;
    const cells = [...row.cells]; if (cells.length !== headers.length) continue;
    if (!visible(cells[amount]) || !visible(cells[description])) continue;
    const n = exactRobux(renderedText(cells[amount])); if (n === undefined) continue;
    const text = renderedText(cells[description]).trim(); if (!text || text.length > 300) continue;
    const statusText = status >= 0 && visible(cells[status]) ? renderedText(cells[status]).trim().toLowerCase() : undefined;
    // An absent status cannot establish settlement; preserve it as pending.
    const pending = statusText !== 'completed';
    const group = (label: string) => { const i = headers.indexOf(label); return i < 0 || !visible(cells[i]) ? undefined : renderedText(cells[i]).trim().slice(0, 160) || undefined; };
    result.push({ amount: n, pending, description: text, date: date < 0 ? undefined : exactTimestamp(cells[date].querySelector('time')?.getAttribute('datetime') ?? null),
      item: group('item'), creator: group('creator'), experience: group('experience') });
  }
  return result;
}
export function transactionSummary(rows: readonly VisibleTransaction[]) {
  let net = 0; let pending = 0; let spent = 0; const months = new Map<string, number>();
  const byItem = new Map<string, number>(); const byCreator = new Map<string, number>(); const byExperience = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isSafeInteger(net + row.amount) || !Number.isSafeInteger(pending + row.amount) || !Number.isSafeInteger(spent + Math.abs(row.amount))) return undefined;
    if (row.pending) { pending += row.amount; continue; }
    net += row.amount;
    if (row.amount < 0) {
      const cost = -row.amount; spent += cost;
      if (row.date) { const month = new Date(row.date).toISOString().slice(0, 7); months.set(month, (months.get(month) ?? 0) + cost); }
      for (const [map, key] of [[byItem, row.item], [byCreator, row.creator], [byExperience, row.experience]] as const) if (key) map.set(key, (map.get(key) ?? 0) + cost);
    }
  }
  return { net, pending, spent, months, byItem, byCreator, byExperience };
}

/** Only visibly labelled definition-list facts; no account/billing input reads. */
export function publicFacts(root: Element, allowed: readonly string[]): { label: string; value: string }[] {
  return [...root.querySelectorAll('dl > dt')].slice(0, 100).flatMap(dt => {
    const label = renderedText(dt).trim(); const dd = dt.nextElementSibling;
    if (!allowed.includes(label.toLowerCase()) || dd?.tagName !== 'DD' || !visible(dt) || !visible(dd)
      || dd.querySelector('input,textarea,button,iframe')) return [];
    const value = renderedText(dd).trim();
    if (['followers', 'following', 'members', 'visits', 'active', 'players', 'store items'].includes(label.toLowerCase())
      && (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value) || !Number.isSafeInteger(Number(value.replace(/,/g, ''))))) return [];
    return value && value.length <= 160 ? [{ label, value }] : [];
  });
}
