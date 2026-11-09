/** Passive item comparison below verified native sellers. No native inputs. */
export function itemSellersAnchor(main: HTMLElement, isVisible: (node: HTMLElement) => boolean): HTMLElement | undefined {
  // Observed on the genuine Limited page. Never guess from heading text or
  // fall back to Recommendations, purchase/details, or an empty React mount.
  const candidates = [...main.querySelectorAll<HTMLElement>('#asset-resale-data-container .resale-pricechart-tabs .tab-content.rbx-tab-content > #resellers.resellers-container')];
  if (candidates.length !== 1) return;
  const sellers = candidates[0];
  const list = sellers.querySelector<HTMLElement>(':scope > .section-content > .resellers > ul.vlist');
  const rows = list && [...list.children];
  if (!isVisible(sellers) || !list || !isVisible(list) || !rows?.length
    || rows.some(n => !n.matches('li.reseller-item') || !n.querySelector('.resale-info .reseller-price-container') || !n.querySelector('.reseller-buttons-container'))
    || sellers.closest('a,button,form,[role="button"],[data-w8rld-owned]')) return;
  return sellers;
}

export function itemComparison(host: HTMLElement, load: (results: HTMLElement) => void, cancel: (results: HTMLElement) => void) {
  host.classList.add('w8rld-similar-panel'); host.id = 'w8rld-similar-values';
  host.setAttribute('role', 'region'); host.setAttribute('aria-labelledby', 'w8rld-similar-title');
  const header = document.createElement('div'); header.className = 'w8rld-similar-header';
  const title = document.createElement('h2'); title.id = 'w8rld-similar-title'; title.textContent = 'Similar Price';
  const more = document.createElement('button'); more.type = 'button'; more.textContent = 'More'; more.hidden = true;
  more.setAttribute('aria-label', 'Scroll to more similar price items'); more.setAttribute('aria-controls', 'w8rld-similar-results');
  const results = document.createElement('div'); results.id = 'w8rld-similar-results'; results.className = 'w8rld-similar-results';
  results.setAttribute('role', 'list'); results.setAttribute('aria-label', 'Limited items ranked by closest Routility USD estimate'); results.tabIndex = 0;
  const update = () => {
    more.hidden = results.scrollWidth <= results.clientWidth + 1;
    more.disabled = results.scrollLeft + results.clientWidth >= results.scrollWidth - 2;
  };
  more.addEventListener('click', () => { results.scrollBy({ left: Math.max(128, results.clientWidth - 140), behavior: 'auto' }); });
  results.addEventListener('scroll', update, { passive: true });
  const observer = new ResizeObserver(update); observer.observe(results);
  header.append(title, more); host.append(header, results);
  queueMicrotask(() => { if (host.isConnected) load(results); });
  return { host, dispose() { cancel(results); observer.disconnect(); results.removeEventListener('scroll', update); } };
}
