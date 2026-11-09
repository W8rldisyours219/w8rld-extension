/*! Native anchors/API field references reviewed against RoUtility profile.js,
 * communities.js, games.js and games/extras.js at 403c75ed81f297e82ada6fccf084ae3fc2249def.
 * Copyright (c) 2026 RoUtility; MIT, see THIRD_PARTY_NOTICES.txt.
 * Independent W8RLD credentialless transport and lifecycle; no upstream auth. */
import type { Preferences } from './preferences';
import { safeAssetId } from './core';
import { parsePublicFactReply, type PublicFactKind } from './publicFacts';
import { displayNumber, inheritSurface, ownedRegion } from './presentation';
import { visible } from './visibleData';

function alreadyExact(anchor: HTMLElement, label: string, value: string): boolean {
  if (!['Followers', 'Following', 'Friends', 'Members', 'Visits', 'Players'].includes(label)) return false;
  const nativeLabel = label === 'Players' ? 'Active' : label;
  const candidates = [...anchor.querySelectorAll<HTMLElement>('a,.profile-insight-pill-button')].filter(n => !n.closest('[data-w8rld-owned]') && visible(n));
  for (const row of anchor.querySelectorAll<HTMLElement>('.game-stat')) {
    if (row.querySelector('.text-label')?.textContent?.trim() !== nativeLabel) continue;
    const lead = row.querySelector<HTMLElement>('.text-lead'); if (lead && visible(lead)) candidates.push(lead);
  }
  return candidates.some(n => {
    const text = n.innerText.trim().replace(new RegExp(`\\b${nativeLabel}\\b`, 'i'), '').trim();
    return /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text) && text.replace(/,/g, '') === value.replace(/,/g, '');
  });
}

export function publicFactUi(extension: any) {
  let serial = 0; let attempted = ''; let node: HTMLElement | undefined; let timer: number | undefined; let expiry: number | undefined;
  let active: { preferences: Preferences; main: HTMLElement; kind: PublicFactKind } | undefined;
  function reset() { serial++; attempted = ''; node?.remove(); node = undefined; if (timer !== undefined) clearTimeout(timer); if (expiry !== undefined) clearTimeout(expiry); timer = expiry = undefined; active = undefined; }
  function update(preferences?: Preferences, main?: HTMLElement, kind?: string) {
    if (!preferences || !main || !['profile', 'community', 'experience'].includes(kind ?? '') || preferences[`${kind as PublicFactKind}Facts`] !== true) { reset(); return; }
    const factKind = kind as PublicFactKind;
    const anchors = main.querySelectorAll<HTMLElement>(factKind === 'profile' ? '.user-profile-header' : factKind === 'community' ? '.profile-insights-container' : '.game-stat-container');
    if (anchors.length !== 1 || !visible(anchors[0])) { if (node) reset(); return; }
    const anchor = anchors[0];
    const routeId = factKind === 'profile' ? /^\/users\/([1-9]\d*)\/profile/.exec(location.pathname)?.[1] : /^\/(?:communities|groups)\/([1-9]\d*)/.exec(location.pathname)?.[1];
    // This public native metadata owner is used by the pinned experience module.
    const rawId = factKind === 'experience' ? document.querySelector('#game-detail-meta-data')?.getAttribute('data-universe-id') : routeId;
    const id = safeAssetId(rawId); if (!id) return;
    const key = `${location.href}:${factKind}:${id}`;
    if (key === attempted && node?.isConnected) {
      // The existing portfolio summary shares this header. Retain its owned
      // sibling instead of repeatedly moving both regions after the same node.
      if (node.parentElement !== anchor.parentElement || !(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) anchor.after(node);
      return;
    }
    reset(); attempted = key; active = { preferences, main, kind: factKind }; const version = serial;
    node = ownedRegion('Public Roblox information'); node.classList.add('w8rld-public-facts'); node.setAttribute('role', 'status'); node.textContent = 'Loading public information…'; inheritSurface(node, anchor); anchor.after(node);
    const host = node;
    const retry = (text: string) => {
      host.hidden = false;
      host.replaceChildren(document.createTextNode(text)); const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Retry public data';
      button.addEventListener('click', () => { const current = active; if (!current) return; reset(); update(current.preferences, current.main, current.kind); }); host.append(button);
    };
    timer = window.setTimeout(() => { timer = undefined; if (serial === version) { serial++; retry('Public information unavailable. Optional Roblox data access may be needed in Extension Settings. '); } }, 10000);
    try { extension.runtime.sendMessage({ type: 'w8rld:public-facts', kind: factKind, entityId: id }, (raw: unknown) => {
      const error = extension.runtime.lastError; if (version !== serial || !host.isConnected || key !== attempted) return;
      if (timer !== undefined) clearTimeout(timer); timer = undefined;
      const reply = !error && parsePublicFactReply(raw, factKind, id);
      if (!reply || !reply.rows.length) { retry('Public information unavailable. Grant optional Roblox data access in Extension Settings to use the public API. '); return; }
      const list = document.createElement('dl');
      for (const row of reply.rows) {
        if (alreadyExact(anchor, row.label, row.value)) continue;
        if (row.label === 'Description') {
          const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Full public description';
          const text = document.createElement('p'); text.textContent = preferences.privacyMode ? 'Hidden' : row.value; details.append(summary, text); list.append(details); continue;
        }
        const wrap = document.createElement('div'); const label = document.createElement('dt'); label.textContent = row.label;
        const value = document.createElement('dd'); const date = /^\d{4}-\d\d-\d\dT/.test(row.value) ? new Date(row.value) : undefined;
        const count = ['Followers','Following','Friends','Members','Visits','Players'].includes(row.label) ? Number(row.value.replace(/,/g,'')) : undefined;
        value.textContent = preferences.privacyMode ? 'Hidden' : date ? date.toLocaleString() : count !== undefined ? displayNumber(count, preferences.compactNumbers) : row.value;
        wrap.title = preferences.privacyMode ? 'Public information hidden in privacy mode.' : `${row.label}: ${row.value}. Public Roblox response observed ${new Date(reply.retrievedAt).toLocaleString()}.`;
        wrap.append(label, value); list.append(wrap);
      }
      host.replaceChildren(list); host.hidden = !list.childElementCount && !reply.partial;
      if (reply.partial) { const note = document.createElement('small'); note.textContent = 'Some public facts unavailable.'; host.append(note); }
      expiry = window.setTimeout(() => { expiry = undefined; if (serial === version && host.isConnected) retry('Public observations expired. '); }, Math.max(1, reply.retrievedAt + 5 * 60000 - Date.now()));
    }); } catch { if (timer !== undefined) clearTimeout(timer); timer = undefined; retry('Public information unavailable. '); }
  }
  return { update, reset, dispose: reset };
}
