/*! Public suggestion schema/paths adapted from RoUtility search.js, MIT,
 * Copyright (c) 2026 RoUtility, pinned 403c75ed81f297e82ada6fccf084ae3fc2249def.
 * See ../THIRD_PARTY_NOTICES.txt. No presence, hidden users or account reads.
 */
import { safeAssetId } from './core';
import { extensionDiagnosticHistory } from './diagnostics';
export const SEARCH_ORIGIN = 'https://apis.roblox.com/*';
export type PublicSuggestion = { kind: 'player' | 'experience'; id: string; name: string; subtitle?: string };
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
export function parseSuggestions(value: unknown): PublicSuggestion[] | undefined {
  if (!Array.isArray(value) || value.length > 8) return;
  const out: PublicSuggestion[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(k => !['kind', 'id', 'name', 'subtitle'].includes(k))
      || !['player', 'experience'].includes(row.kind) || safeAssetId(row.id) !== row.id || !text(row.name, 100)
      || row.subtitle !== undefined && !text(row.subtitle, 100)) return;
    if (!out.some(r => r.kind === row.kind && r.id === row.id)) out.push(row);
  }
  return out;
}
export function createPublicSearch(extension: any, read: (url: string, signal?: AbortSignal) => Promise<unknown>, now = Date.now) {
  const cache = new Map<string, { at: number; rows: PublicSuggestion[] }>();
  let active: { query: string; job: Promise<PublicSuggestion[]> } | undefined; let nextAt = 0; let revision = 0;
  const controllers = new Set<AbortController>();
  const clear = () => { revision++; for (const controller of controllers) controller.abort(); controllers.clear(); active = undefined; cache.clear(); };
  const search = async (query: string): Promise<PublicSuggestion[]> => {
    const version = revision;
    if (typeof query !== 'string' || query.length < 2 || query.length > 100 || query.trim() !== query || /[\u0000-\u001f\u007f]/.test(query)) return [];
    if ((await extension.storage.sync.get({enabled:true})).enabled === false) return [];
    if (!await extension.permissions?.contains({ origins: [SEARCH_ORIGIN] })) {
      extensionDiagnosticHistory.record({code:'W8RLD-EXT-PERMISSION-001',status:'denied',enabled:'yes'}); return [];
    }
    if (version !== revision) return [];
    const key = query.toLowerCase(); const hit = cache.get(key); if (hit && now() - hit.at < 60_000) return hit.rows;
    if (active?.query === key) return active.job;
    if (active || now() < nextAt) return [];
    nextAt = now() + 1000;
    const controller = new AbortController(); controllers.add(controller);
    const session = crypto.randomUUID(); const q = encodeURIComponent(query);
    const job = (async () => {
      const replies = await Promise.allSettled([
        read(`https://apis.roblox.com/search-api/omni-search?verticalType=user&searchQuery=${q}&pageToken=&globalSessionId=${session}&sessionId=${session}`, controller.signal),
        read(`https://apis.roblox.com/search-api/omni-search?searchQuery=${q}&pageToken=&sessionId=${session}&pageType=all`, controller.signal),
      ]);
      const rows: PublicSuggestion[] = [];
      for (const [i, reply] of replies.entries()) {
        if (reply.status !== 'fulfilled' || !reply.value || typeof reply.value !== 'object') continue;
        const groups = (reply.value as any).searchResults;
        if (!Array.isArray(groups) || groups.length > 100) continue;
        const contents = groups.find(g => g?.contentGroupType === (i ? 'Game' : 'User'))?.contents;
        if (!Array.isArray(contents) || contents.length > 100) continue;
        for (const r of contents.slice(0, i ? 2 : 4)) {
          const rawId = i ? r?.rootPlaceId : r?.contentId;
          const id = safeAssetId(typeof rawId === 'number' && Number.isSafeInteger(rawId) ? String(rawId) : rawId); const name = text(i ? r?.name : r?.displayName || r?.username, 100);
          if (!id || !name) continue;
          const subtitle = !i && text(r.username, 100);
          rows.push({ kind: i ? 'experience' : 'player', id, name, ...(subtitle ? {subtitle} : {}) });
        }
      }
      if (version !== revision || !await extension.permissions?.contains({origins:[SEARCH_ORIGIN]})) return [];
      if (version !== revision) return [];
      if (replies.some(r => r.status === 'rejected')) {
        nextAt = now() + 30_000;
        extensionDiagnosticHistory.record({code:'W8RLD-EXT-SEARCH-001',status:'unavailable',enabled:'yes'});
      }
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, {at:now(), rows}); return rows;
    })();
    active = {query:key,job}; try { return await job; } finally { controllers.delete(controller); if (active?.job === job) active = undefined; }
  };
  return { search, clear };
}
