/** Request-free enhancements using native links and the reviewed navbar input. */
import type { Preferences } from './preferences';
import { inheritSurface, ownedRegion } from './presentation';
import { visible } from './visibleData';
import { hoverPosition } from './nativeUi';

export function localEnhancements() {
  let preferences: Preferences | undefined; let route = ''; let tooltip: HTMLElement | undefined;
  let target: HTMLAnchorElement | undefined; let original: string | null = null;
  const close = () => { tooltip?.remove(); tooltip = undefined; if (target) { if (original === null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', original); } target = undefined; };
  const reveal = (event: Event) => {
    if (!preferences?.profilePreviews || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href*="/users/"]');
    // RoUtility profile/hovercard.js::SKIP: native navigation, search and modal
    // surfaces own their previews. Do not cover their controls with another one.
    if (!link || link.closest('[data-w8rld-owned],#header,.rbx-header,#navigation,.rbx-left-col,.navbar-search,[role="dialog"],.modal') || !visible(link) || link === target) return;
    const u = new URL(link.href); if (u.origin !== location.origin || !/^\/users\/[1-9]\d*\/profile\/?$/.test(u.pathname) || u.search || u.hash) return;
    const name = link.innerText.trim(); if (!name || name.length > 160) return;
    close(); target = link; original = link.getAttribute('aria-describedby');
    tooltip = ownedRegion('Public profile link preview'); tooltip.classList.add('w8rld-profile-preview'); tooltip.id = 'w8rld-public-profile-preview'; tooltip.setAttribute('role', 'tooltip');
    const title = document.createElement('strong'); title.textContent = preferences.privacyMode ? 'Public profile' : name;
    const caption = document.createElement('small'); caption.textContent = 'Public profile'; tooltip.append(title, caption); inheritSurface(tooltip, link); tooltip.style.visibility='hidden'; document.body.append(tooltip);
    const r = link.getBoundingClientRect(); const box = tooltip.getBoundingClientRect();
    const protectedBoxes=[...document.querySelectorAll<HTMLElement>('button,input,select,textarea,[role="button"],[role="tooltip"]')]
      .filter(n=>n!==tooltip&&visible(n)).map(n=>n.getBoundingClientRect());
    const position=hoverPosition(r,box.width,box.height,{width:innerWidth,height:innerHeight},protectedBoxes);
    if(!position){close();return;}
    tooltip.style.left=`${position.left}px`;tooltip.style.top=`${position.top}px`;tooltip.style.visibility='';
    link.setAttribute('aria-describedby', [original, tooltip.id].filter(Boolean).join(' '));
  };
  const leave = (e: Event) => { if (target && e.target instanceof Node && target.contains(e.target)) { const related = (e as MouseEvent).relatedTarget; if (!(related instanceof Node) || !target.contains(related)) close(); } };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (!preferences?.searchShortcut || e.key !== '/' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]')) return;
    if ([...document.querySelectorAll<HTMLElement>('[role="dialog"],.modal.in')].some(visible)) return;
    const inputs = [...document.querySelectorAll<HTMLInputElement>('#navbar-search-input')].filter(n => !n.disabled && visible(n));
    if (inputs.length === 1) { e.preventDefault(); inputs[0].focus(); }
  };
  document.addEventListener('keydown', key); document.addEventListener('mouseover', reveal); document.addEventListener('focusin', reveal); document.addEventListener('mouseout', leave); document.addEventListener('focusout', leave);
  document.addEventListener('scroll', close, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
  return {
    update(p?: Preferences) { if (!p || route !== location.href || preferences?.profilePreviews !== p.profilePreviews || preferences?.privacyMode !== p.privacyMode || target && (!target.isConnected || !visible(target))) close(); preferences = p; route = location.href; },
    dispose() { close(); preferences = undefined; document.removeEventListener('keydown', key); document.removeEventListener('mouseover', reveal); document.removeEventListener('focusin', reveal); document.removeEventListener('mouseout', leave); document.removeEventListener('focusout', leave); document.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close); },
  };
}
