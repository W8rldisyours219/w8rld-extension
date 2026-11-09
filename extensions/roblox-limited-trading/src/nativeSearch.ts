/*!
 * Native search placement adapted from RoUtility (MIT), Copyright (c) 2026
 * RoUtility. Source: src/features/search/search.js at
 * 403c75ed81f297e82ada6fccf084ae3fc2249def (input, menu, place, onInput).
 * See ../THIRD_PARTY_NOTICES.txt for the complete MIT license.
 * W8RLD retains the native input and suggestions. Only owned suggestions are
 * handled. No page-world interception or account actions.
 */
import { inheritSurface, ownedRegion, ownedSelector } from './presentation';

export function startNativeSearch(load: (results: HTMLElement, query: string) => void, cancel: (results: HTMLElement) => void) {
  let enabled = false; let disposed = false; let timer: number | undefined;
  let input: HTMLInputElement | undefined; let root: HTMLElement | undefined; let results: HTMLElement | undefined;
  let query = ''; let escapeQuery: string | undefined; let box: Element | undefined;
  let serial = 0;
  let loaded = false; let loadAt = 0;
  let selected = -1;
  let nativeActive: string | null | undefined;
  function releaseSelection() {
    selected = -1;
    root?.querySelectorAll('[data-w8rld-search-selected]').forEach(n => n.removeAttribute('data-w8rld-search-selected'));
    restoreActive();
  }
  function restoreActive() {
    if(input?.getAttribute('aria-activedescendant')?.startsWith('w8rld-search-')){
      if(nativeActive)input.setAttribute('aria-activedescendant',nativeActive);else input.removeAttribute('aria-activedescendant');
    }
    nativeActive=undefined;
  }
  const observer = new MutationObserver(records => {
    // Native React reconciliation may remove the owned <li> alone. That is a
    // host mutation too; ignoring it loses the only result before activation.
    if (root && !root.isConnected) { if (input?.isConnected && input.value.trim() === query) place(); else clear(); return; }
    if (records.every(r => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest(ownedSelector)
      || r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n instanceof Element && n.matches(ownedSelector)))) return;
    if (!input?.isConnected || input.value.trim() !== query) clear(); else place();
  });
  function clear() {
    serial++;
    if (timer !== undefined) clearTimeout(timer); timer = undefined;
    if (results) cancel(results);
    releaseSelection();
    root?.remove(); root = undefined; results = undefined; query = ''; box = undefined;
    loaded = false; loadAt = 0;
    observer.disconnect();
  }
  function loadReady() {
    if (loaded || !results?.isConnected || !enabled || disposed || Date.now() < loadAt) return;
    loaded = true; load(results,query);
  }
  function place() {
    if (!root || !box || !input?.isConnected || !enabled || input.value.trim() !== query) return;
    const menus = box.querySelectorAll<HTMLUListElement>('ul.dropdown-menu');
    if (menus.length !== 1) { root.remove(); return; }
    const menu = menus[0]; inheritSurface(root, menu); if (root.parentElement !== menu) menu.prepend(root);
    loadReady();
  }
  function changed(event: Pick<Event,'target'>) {
    if (!enabled || disposed || !(event.target instanceof HTMLInputElement) || event.target.id !== 'navbar-search-input') return;
    if (event instanceof InputEvent && event.isComposing) { clear(); return; }
    const next = event.target; const text = next.value.trim();
    if (text === query && input === next && root) { place(); return; }
    clear(); input = next;
    if (text.length < 2 || text.length > 100 || text === escapeQuery) return;
    escapeQuery = undefined;
    const parent = next.closest('[data-testid="navigation-search-input"], .navbar-search');
    if (!parent) return;
    box = parent; query = text;
    root = document.createElement('li'); root.className = 'navbar-search-option w8rld-ext3 w8rld-native-search'; root.dataset.w8rldOwned = '';
    root.setAttribute('aria-label', 'W8RLD Limited suggestions');
    const label = document.createElement('strong'); label.textContent = 'W8RLD';
    results = ownedRegion('Public Limited suggestions'); results.setAttribute('aria-live', 'polite');
    root.append(label, results);
    // Isolate only owned suggestions. Native input/menu events remain native.
    // Upstream onKey/row activation keeps native input focus until navigation.
    // React closes its menu on input blur, before a later click can activate.
    for (const type of ['mousedown', 'pointerdown']) root.addEventListener(type, e => {
      if ((e as MouseEvent).button === 0 && e.target instanceof Element && e.target.closest('a[href]')) e.preventDefault();
      e.stopPropagation();
    });
    root.addEventListener('click', e => {
      e.stopPropagation();
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !(e.target instanceof Element)) return;
      const link = e.target.closest<HTMLAnchorElement>('a[href]');
      if (link && navigate(link)) e.preventDefault();
    });
    // React may create/reconcile its menu after this native input event. Keep
    // the pending query until that host mutation, including a detach spanning
    // the debounce deadline; a missed mount must not consume the only load.
    loadAt = Date.now()+250;
    observer.observe(box.parentElement ?? box, { childList: true, subtree: true }); place();
    const version = serial;
    timer = window.setTimeout(() => { timer = undefined; if (!disposed && version === serial) place(); }, 250);
  }
  function navigate(link: HTMLAnchorElement): boolean {
    const url = new URL(link.href);
    if (url.origin !== 'https://www.roblox.com' || url.search || url.hash
      || !/^\/(?:catalog\/[1-9]\d*(?:\/[^/]+)?|users\/[1-9]\d*\/profile|games\/[1-9]\d*)\/?$/.test(url.pathname)) return false;
    location.assign(url.href); clear(); return true;
  }
  function key(event: KeyboardEvent) {
    if (!enabled || !root?.isConnected || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || event.target !== input && !(event.target instanceof Node && root.contains(event.target))) return;
    if (event.key === 'Escape') {
      escapeQuery = query; const target = input; clear(); target?.focus();
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')];
    if (event.key === 'Enter') {
      const link = event.target === input ? links[selected] : (event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null);
      if (link && navigate(link)) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    if (event.target === input) {
      const next = selected + (event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0 && next < links.length) {
        selected = next;
        if(nativeActive===undefined)nativeActive=input!.getAttribute('aria-activedescendant');
        links.forEach((link,i) => { link.id ||= `w8rld-search-${serial}-${i}`; link.toggleAttribute('data-w8rld-search-selected',i===selected); });
        input!.setAttribute('aria-activedescendant',links[next].id);
        links[next].scrollIntoView({block:'nearest'});
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      // Yield both boundaries to Roblox. Keeping the last owned index here
      // causes Enter on a subsequently selected native result to open our old
      // result instead, and leaves a stale active-descendant/highlight behind.
      releaseSelection();
      return;
    }
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = links[index + (event.key === 'ArrowDown' ? 1 : -1)];
    const target = next ?? (index === 0 && event.key === 'ArrowUp' ? input : index === links.length - 1 && event.key === 'ArrowDown'
      ? box?.querySelector<HTMLAnchorElement>('ul.dropdown-menu > li:not([data-w8rld-owned]) a[href]') : undefined);
    // RoUtility search.js::paint keeps the active suggestion in its scroll
    // owner. Retain W8RLD's existing real-link focus and native menu handoff.
    if (target) { target.focus({preventScroll:true}); target.scrollIntoView({block:'nearest'}); event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function dismiss(event: Event) { if (box && event.target instanceof Node && !box.contains(event.target)) clear(); }
  function blur() { queueMicrotask(() => { if (box && !box.contains(document.activeElement)) clear(); }); }
  document.addEventListener('input', changed); document.addEventListener('focusin', changed); document.addEventListener('compositionend', changed);
  document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', dismiss); document.addEventListener('focusout', blur);
  return {
    setEnabled(value: boolean) {
      const previous = enabled; enabled = value;
      if (!value || input && !input.isConnected) clear();
      // Initial preference loading, SPA return and settings reconciliation can
      // finish after the user already focused/typed. Recover that same native
      // input without synthesizing page events or admitting the old response.
      if (value && !previous && document.activeElement instanceof HTMLInputElement
        && document.activeElement.id === 'navbar-search-input') changed({target:document.activeElement});
    },
    clear,
    dispose() { if (disposed) return; disposed = true; clear(); document.removeEventListener('input', changed); document.removeEventListener('focusin', changed); document.removeEventListener('compositionend', changed); document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('focusout', blur); },
  };
}
