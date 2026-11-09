/** Worker-only, fixed local settings operations. Never accepts storage keys/URLs. */
import { ALERT_HISTORY_KEY, COMPARISON_KEY, DEFAULT_PREFERENCES, parsePreferences, preferencePatch, PREFERENCE_KEY } from './preferences';
import type { createBrowserProviders } from './transport';
import { PUBLIC_FACT_ORIGINS, MEMBER_ORIGINS, type createPublicFactService } from './publicFacts';
import { SEARCH_ORIGIN } from './publicSearch';
import { extensionDiagnosticHistory, extensionDiagnosticReport } from './diagnostics';
import {W8RLD_DATA_ORIGIN} from '../../../plugins/lib/w8rldData';

const writes = new WeakMap<object, Promise<unknown>>();
/** Settings and the remembered-section shortcut share one preference writer. */
export function serializePreferenceWrite<T>(extension: object, write: () => Promise<T>): Promise<T> {
  const task = (writes.get(extension) ?? Promise.resolve()).then(write);
  writes.set(extension, task.then(() => {}, () => {})); return task;
}

export function settingsSender(sender: any, extensionId: string): boolean {
  if (sender?.id !== extensionId) return false;
  try {
    const u = new URL(sender.url);
    if (u.protocol === 'chrome-extension:' && u.hostname === extensionId && u.pathname === '/options.html' && !u.search) return true;
    const tab = new URL(sender.tab?.url);
    return sender.frameId === 0 && sender.origin === 'https://www.roblox.com' && u.origin === tab.origin
      && u.origin === 'https://www.roblox.com' && /^\/my\/account\/?$/.test(u.pathname) && /^\/my\/account\/?$/.test(tab.pathname);
  } catch { return false; }
}

export function createSettingsService(extension: any, providers?: ReturnType<typeof createBrowserProviders>, publicFacts?: ReturnType<typeof createPublicFactService>, history?: {clear():void}) {
  async function releaseUnused() {
    if (!extension.permissions?.remove) return;
    const p = parsePreferences((await extension.storage.local.get(PREFERENCE_KEY))[PREFERENCE_KEY]);
    const needed=new Set<string>(Object.entries(PUBLIC_FACT_ORIGINS).flatMap(([kind,hosts])=>p[`${kind}Facts` as keyof typeof p]?[...hosts]:[]));
    if(p.smartSearch)needed.add(SEARCH_ORIGIN);if(p.communitySearch)for(const host of MEMBER_ORIGINS)needed.add(host);
    const origins=[...new Set([...Object.values(PUBLIC_FACT_ORIGINS).flat(),SEARCH_ORIGIN])].filter(host=>!needed.has(host));
    if (origins.length) await extension.permissions.remove({ origins });
    if (!p.priceAlerts && !p.marketAlerts) await extension.permissions.remove({ permissions: ['notifications'] });
  }
  // One queue owns partial preference writes, including rapid clicks in two tabs.
  async function snapshot() {
    const data = await extension.storage.local.get([PREFERENCE_KEY, ALERT_HISTORY_KEY]);
    const enabled = (await extension.storage.sync.get({ enabled: true })).enabled !== false;
    const history = data[ALERT_HISTORY_KEY];
    const entries = history?.version === 1 && Array.isArray(history.entries) ? history.entries.slice(-100).flatMap((r: any) =>
      r && /^(price|market):[1-9]\d{0,15}$/.test(r.key) && Number.isSafeInteger(r.time) && r.time > 0 && r.time <= Date.now()
        ? [{ kind: r.key.split(':')[0], time: r.time }] : []) : [];
    const status = providers ? await Promise.all([providers.rolimons.status(), providers.routility.status()]) : [];
    return { ok: true, preferences: parsePreferences(data[PREFERENCE_KEY]), enabled,
      dataAccess:!!await extension.permissions?.contains({origins:[W8RLD_DATA_ORIGIN]}),
      searchAccess: !!await extension.permissions?.contains({ origins: [SEARCH_ORIGIN] }),
      memberAccess: !!await extension.permissions?.contains({origins:MEMBER_ORIGINS}),
      publicAccess: Object.fromEntries(await Promise.all(Object.entries(PUBLIC_FACT_ORIGINS).map(async ([kind, origins]) => [kind, !!await extension.permissions?.contains({ origins: [...origins] })]))),
      notifications: !!await extension.permissions?.contains({ permissions: ['notifications'] }), history: entries,
      providers: status.map((s, i) => ({ name: i ? 'Routility' : "Rolimon's", ...s })) };
  }
  async function perform(raw: Record<string, unknown>) {
    if (Object.keys(raw).some(k => !['type', 'action', 'patch', 'enabled'].includes(k))) return { ok: false };
    const action = raw.action;
    if (action !== 'update' && ('patch' in raw || 'enabled' in raw)) return { ok: false };
    if (action === 'get') return snapshot();
    if (action === 'debug-clear') { extensionDiagnosticHistory.clear(); return {ok:true}; }
    if (action === 'debug-report') {
      const enabled = (await extension.storage.sync.get({ enabled: true })).enabled !== false;
      const states = providers ? await Promise.allSettled([providers.rolimons.status(), providers.routility.status()]) : [];
      const state = (index: number) => states[index]?.status === 'fulfilled' ? (states[index] as PromiseFulfilledResult<{state:'fresh'|'stale'|'unavailable'|'disabled'}>).value.state : 'unknown' as const;
      return { ok: true, diagnostics: extensionDiagnosticReport(enabled, {rolimons:state(0),routility:state(1)}) };
    }
    if (action === 'open-options') { await extension.runtime.openOptionsPage(); return { ok: true }; }
    if (action === 'update') {
      if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return { ok: false };
      const patch = raw.patch === undefined ? {} : preferencePatch(raw.patch);
      if (!patch) return { ok: false };
      // A preference is intent, never a permission grant. Delivery independently
      // checks the current grant; revocation must not erase the user's choice.
      const current = parsePreferences((await extension.storage.local.get(PREFERENCE_KEY))[PREFERENCE_KEY]);
      await extension.storage.local.set({ [PREFERENCE_KEY]: { ...current, ...patch } });
      if (typeof raw.enabled === 'boolean') await extension.storage.sync.set({ enabled: raw.enabled });
    } else if (action === 'reset') {
      await extension.storage.local.set({ [PREFERENCE_KEY]: { ...DEFAULT_PREFERENCES } });
      await extension.storage.sync.set({ enabled: true });
    } else if (action === 'clear-history') await extension.storage.local.remove(ALERT_HISTORY_KEY);
    else if (action === 'clear-comparisons') await extension.storage.local.remove(COMPARISON_KEY);
    else if (action === 'clear-cache' || action === 'clear-local') {
      publicFacts?.clear();
      history?.clear();
      // Preserve request leases/cooldowns even when the catalog body is deleted.
      await providers?.rolimons.clearCache(); await providers?.routility.clearCache();
      if (action === 'clear-local') {
        await extension.storage.local.remove([ALERT_HISTORY_KEY, COMPARISON_KEY]);
        await extension.storage.local.set({ [PREFERENCE_KEY]: { ...DEFAULT_PREFERENCES } });
        await extension.storage.sync.set({ enabled: true });
      }
    } else return { ok: false };
    await releaseUnused();
    return snapshot();
  }
  return (raw: Record<string, unknown>) => serializePreferenceWrite(extension, () => perform(raw)).catch(() => {
    extensionDiagnosticHistory.record({ code: 'W8RLD-EXT-SETTINGS-001', status: 'failed', enabled: 'unknown', stage: 'settings' });
    return { ok: false };
  });
}
