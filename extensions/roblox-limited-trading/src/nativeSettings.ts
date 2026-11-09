/*! Native settings placement adapted from RoUtility src/settings/settings.js
 * at 403c75ed81f297e82ada6fccf084ae3fc2249def. Copyright (c) 2026 RoUtility.
 * MIT; full license in THIRD_PARTY_NOTICES.txt. No upstream router/global hooks. */
import { mountSettings, runtimeSettingsClient } from './settingsView';
import { NATIVE_SETTINGS_HASH } from './preferences';

// Keep Roblox's recognized Info route: this document_idle integration cannot
// reserve an unknown route before the host's router starts handling history.
const HASH = NATIVE_SETTINGS_HASH;
const OWNER = Symbol.for('w8rld.roblox.native-settings.lifecycle');
/** Only the upstream-observed settings menu/content pair is admitted. Roblox
 * owns its nodes and native routes. A scoped class hides siblings while our pane
 * is selected; removing it restores native presentation without rewriting nodes. */
export function startNativeSettings(extension: any): () => void {
  const owners = globalThis as unknown as Record<symbol, (() => void) | undefined>; owners[OWNER]?.();
  let stopped = false; let suspended = false; let queued: number | undefined;
  let entry: HTMLElement | undefined; let pane: HTMLElement | undefined; let container: HTMLElement | undefined;
  let unmount: (() => void) | undefined; let lastRoute = location.href;
  const active = () => /^\/my\/account\/?$/.test(location.pathname) && location.hash === HASH;
  const close = () => { unmount?.(); unmount = undefined; pane?.remove(); pane = undefined; container?.classList.remove('w8rld-settings-open'); };
  function scan() {
    queued = undefined; if (stopped || suspended) return;
    if (!/^\/my\/account\/?$/.test(location.pathname)) { close(); entry?.remove(); entry = undefined; container = undefined; return; }
    if (location.hash === '#!/w8rld') history.replaceState(history.state, '', `${location.pathname}${location.search}${HASH}`);
    const menus = document.querySelectorAll<HTMLElement>('.settings-left-navigation .menu-vertical');
    const contents = document.querySelectorAll<HTMLElement>('.settings-left-navigation .tab-content');
    if (menus.length !== 1 || contents.length !== 1) { close(); entry?.remove(); entry = undefined; return; }
    const menu = menus[0];
    if (container !== contents[0]) { close(); container = contents[0]; }
    if (!entry?.isConnected || entry.parentElement !== menu) {
      entry?.remove(); entry = document.createElement('li'); entry.className = 'menu-option'; entry.dataset.w8rldOwned = '';
      const link = document.createElement('a'); link.className = 'menu-option-content'; link.href = HASH;
      const label = document.createElement('span'); label.className = 'font-caption-header'; label.textContent = 'W8RLD'; link.append(label);
      link.addEventListener('click', event => { if (event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button)) return;
        event.preventDefault(); event.stopPropagation(); history.pushState(history.state, '', `${location.pathname}${location.search}${HASH}`); scan(); pane?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }); entry.append(link); menu.append(entry);
    }
    const link = entry.querySelector('a')!; link.classList.toggle('active', active());
    if (active()) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    if (!active()) { close(); return; }
    container.classList.add('w8rld-settings-open');
    if (pane?.isConnected) return;
    close(); container.classList.add('w8rld-settings-open');
    pane = document.createElement('section'); pane.className = 'tab-pane active w8rld-native-settings'; pane.dataset.w8rldOwned = ''; pane.setAttribute('aria-label', 'W8RLD Settings');
    const title = document.createElement('h2'); title.textContent = 'W8RLD Settings';
    const search = document.createElement('input'); search.type = 'search'; search.maxLength = 100; search.placeholder = 'Search W8RLD settings'; search.setAttribute('aria-label', 'Search W8RLD settings');
    const status = document.createElement('p'); status.setAttribute('aria-live', 'polite');
    const root = document.createElement('div'); pane.append(title, search, root, status); container.append(pane);
    unmount = mountSettings(root, search, status, runtimeSettingsClient(extension), true);
  }
  const schedule = () => { if (!stopped && !suspended && queued === undefined) queued = window.setTimeout(scan, 60); };
  const own = (n: Node) => !!(n instanceof Element ? n : n.parentElement)?.closest('[data-w8rld-owned]');
  const observer = new MutationObserver(records => { if (records.some(r => !own(r.target) && (r.type !== 'childList' || [...r.addedNodes, ...r.removedNodes].some(n => !own(n) || n === pane || n === entry)))) schedule(); });
  const observe = () => { observer.disconnect(); if (/^\/my\/account\/?$/.test(location.pathname)) observer.observe(document.body, { childList: true, subtree: true }); };
  const route = () => { if (location.href !== lastRoute) { lastRoute = location.href; observe(); schedule(); } };
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  const hide = (e: PageTransitionEvent) => { close(); observer.disconnect(); if (e.persisted) suspended = true; else dispose(); };
  const show = () => { if (suspended) { suspended = false; observe(); schedule(); } };
  const dispose = () => { if (stopped) return; stopped = true; if (queued !== undefined) clearTimeout(queued); observer.disconnect(); close(); entry?.remove();
    window.removeEventListener('popstate', route); window.removeEventListener('hashchange', route); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); navigation?.removeEventListener('currententrychange', route);
    if (owners[OWNER] === dispose) delete owners[OWNER];
  };
  window.addEventListener('popstate', route); window.addEventListener('hashchange', route); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); navigation?.addEventListener('currententrychange', route);
  owners[OWNER] = dispose; observe(); scan(); return dispose;
}
