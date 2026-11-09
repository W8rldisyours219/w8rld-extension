/*! Section memory and trailer intent handling adapted from RoUtility
 * src/features/avatar/avatar.js::currentSection/setupRemember/openSection and
 * src/features/games/games.js::stopTrailers at
 * 403c75ed81f297e82ada6fccf084ae3fc2249def. Copyright (c) 2026 RoUtility.
 * MIT; full notice in ../THIRD_PARTY_NOTICES.txt. No equip or automatic clicks. */
import { visible } from './visibleData';

export function validAvatarSection(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 220) return false;
  if (/^#!\/[a-z-]+(?:\/[a-z-]+){0,3}$/.test(value)) return true;
  try {
    const data = JSON.parse(value);
    return Object.keys(data).length === 2 && typeof data.tabId === 'string' && /^[a-z][\w.-]{0,63}$/i.test(data.tabId)
      && typeof data.sub === 'string' && /^[\p{L}\p{N} &'()-]{1,64}$/u.test(data.sub);
  } catch { return false; }
}

/** Read native breadcrumbs only; outfit/item cards never enter this shortcut. */
export function currentAvatarSection(root: HTMLElement): string | undefined {
  const crumbs = [...root.querySelectorAll<HTMLElement>('#avatar-web-app .breadcrumb-container li')].filter(visible).map(n => n.innerText.trim()).filter(Boolean);
  if (crumbs.length < 2 || crumbs.length > 4) return;
  const tabs = [...root.querySelectorAll<HTMLElement>('#avatar-web-app .rbx-tab .rbx-tab-heading')]
    .filter(n => visible(n) && n.innerText.trim().toLowerCase() === crumbs[0].toLowerCase());
  if (tabs.length !== 1) return;
  const value = JSON.stringify({tabId:tabs[0].id,sub:crumbs[crumbs.length - 1]});
  return validAvatarSection(value) ? value : undefined;
}

/** Reuse a native section link when one exists. The package forbids simulated
 * native clicks, so hashless sections retain a useful local last-viewed label. */
export function avatarShortcut(value: string): {node: HTMLElement; dispose(): void} | undefined {
  if (!validAvatarSection(value)) return;
  if (value.startsWith('#!')) {
    const link = document.createElement('a'); link.href = `/my/avatar${value}`; link.textContent = 'Resume last viewed section';
    return {node:link,dispose() {}};
  }
  const data = JSON.parse(value);
  const choices = [...document.querySelectorAll<HTMLAnchorElement>('#avatar-web-app .tab-horizontal-submenu li a[href]')].filter(n => n.innerText.trim() === data.sub);
  if (choices.length === 1) try {
    const url = new URL(choices[0].href);
    if (url.origin === 'https://www.roblox.com' && /^\/my\/avatar\/?$/.test(url.pathname) && !url.search && /^#!\/[a-z-]+(?:\/[a-z-]+){0,3}$/.test(url.hash)) {
      const link = document.createElement('a'); link.href = url.pathname + url.hash; link.textContent = `Resume ${data.sub}`; return {node:link,dispose() {}};
    }
  } catch { /* No supported section link. */ }
  const label = document.createElement('small'); label.textContent = `Last viewed section: ${data.sub}`;
  return {node:label,dispose() {}};
}

/** No global polling or autoplay writes. Explicit native playback wins for the
 * lifetime of that video. Unrelated videos and Roblox's Play button are ignored. */
export function trailerPreference() {
  let root: HTMLElement | undefined; let intent = -Infinity; let chosen = new WeakSet<HTMLVideoElement>();
  const inCarousel = (n: EventTarget | null) => n instanceof Element && !!root?.contains(n) && !!n.closest('#game-details-carousel-container');
  const onIntent = (event: Event) => { if (event.isTrusted && inCarousel(event.target)) intent = performance.now(); };
  const guard = (event: Event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !inCarousel(video)) return;
    if (performance.now() - intent < 2000) chosen.add(video);
    if (!chosen.has(video)) video.pause();
  };
  const reset = () => {
    if (root) for (const [event, handler] of [['pointerdown',onIntent],['keydown',onIntent],['play',guard],['playing',guard]] as const) root.removeEventListener(event,handler,true);
    root = undefined; intent = -Infinity; chosen = new WeakSet();
  };
  const update = (main?: HTMLElement, allow = true) => {
    if (allow || !main) { reset(); return; }
    if (root !== main) { reset(); root = main; for (const [event, handler] of [['pointerdown',onIntent],['keydown',onIntent],['play',guard],['playing',guard]] as const) root.addEventListener(event,handler,true); }
    for (const video of root.querySelectorAll<HTMLVideoElement>('#game-details-carousel-container video')) if (!video.paused && !chosen.has(video)) guard({target:video} as unknown as Event);
  };
  return {update,dispose:reset};
}
