/** Non-sensitive local preferences. Account data never belongs in this record. */
import { validAvatarSection } from './pagePreferences';
import {FEATURE_SETTINGS} from './settingsSchema';
export const PREFERENCE_KEY = 'w8rld:preferences:v1';
export const COMPARISON_KEY = 'w8rld:anonymous-comparisons:v1';
export const ALERT_HISTORY_KEY = 'w8rld:public-alert-suppression:v1';
export const NATIVE_SETTINGS_HASH = '#!/info?w8rld=1';
export const DEFAULT_PREFERENCES = {
  itemValues: true, itemFlags: true, itemPreviews: true, smartSearch: true, tradeTotals: true,
  tradeList: true, tradePreviews: true, tradeSearch: true, tradeAge: true, tradeKeyboard: true, tradeProof: false,
  tradeListMetrics: 'rap-usd' as 'rap-usd' | 'value-usd' | 'rap-value',
  itemPages: true, marketplace: false, inventory: true, profileTotals: true,
  inventorySearch: false, inventorySort: false, hideSerials: false,
  avatar: false, rememberAvatarSection: false, friendsSearch: false,
  profileFacts: false, communityFacts: false, experienceFacts: false, trailerAutoplay: true,
  privacyMode: false, maskNames: true, maskBalances: true, maskIdentifiers: true,
  transactions: false, subscriptionInfo: false,
  priceAlerts: false, marketAlerts: false,
  alertAssetId: '', alertMetric: 'rap' as 'rap' | 'value' | 'usd', alertThreshold: 0,
  notificationRetentionDays: 1,
  avatarSection: '',
  tradeCalculator: false, savedComparisons: false, overpayWarnings: false, overpayThreshold: 15, tradePlayerSearch: false,
  similarItems: true, itemDemand: true, itemTrend: true, itemCopies: true, lowestListing: true,
  inventoryLimitedFilter: false, acquisitionDates: true, friendFilters: false, communitySearch: false,
  profilePreviews: false, searchShortcut: false,
  compactNumbers: false, showRap: true, showValue: true, showUsd: true, diagnostics: false,
  usdFallback: 'off' as 'off' | 'rap', usdPerThousandRobux: 4,
  valueFallback: 'off' as 'off' | 'rap',
  quietHours: false, quietStart: 22, quietEnd: 8,

};
export type Preferences = typeof DEFAULT_PREFERENCES;
/** Runtime projection only; stored child intent remains available in Settings. */
export function effectivePreferences(intent:Preferences):Preferences {
  const effective={...intent};
  for(const spec of FEATURE_SETTINGS)if(spec.depends&&effective[spec.depends]!==true&&typeof effective[spec.key]==='boolean')
    (effective as Record<string,unknown>)[spec.key]=false;
  return effective;
}
export function parsePreferences(raw: unknown): Preferences {
  const result = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(result) as (keyof Preferences)[]) {
    if (typeof result[key] === 'boolean' && typeof value[key] === 'boolean') (result as Record<string, unknown>)[key] = value[key];
  }
  if (['rap-usd', 'value-usd', 'rap-value'].includes(String(value.tradeListMetrics))) result.tradeListMetrics = value.tradeListMetrics as Preferences['tradeListMetrics'];
  if (value.usdFallback === 'off' || value.usdFallback === 'rap') result.usdFallback = value.usdFallback;
  if (value.valueFallback === 'off' || value.valueFallback === 'rap') result.valueFallback = value.valueFallback;
  if (typeof value.usdPerThousandRobux === 'number' && Number.isFinite(value.usdPerThousandRobux) && value.usdPerThousandRobux > 0 && value.usdPerThousandRobux <= 1e6) result.usdPerThousandRobux = value.usdPerThousandRobux;
  if (['rap', 'value', 'usd'].includes(String(value.alertMetric))) result.alertMetric = value.alertMetric as Preferences['alertMetric'];
  if (typeof value.alertAssetId === 'string' && /^(?:[1-9]\d{0,15})?$/.test(value.alertAssetId) && Number(value.alertAssetId) <= Number.MAX_SAFE_INTEGER) result.alertAssetId = value.alertAssetId;
  if (typeof value.alertThreshold === 'number' && Number.isFinite(value.alertThreshold) && value.alertThreshold >= 0 && value.alertThreshold <= 1e12) result.alertThreshold = value.alertThreshold;
  if (typeof value.notificationRetentionDays === 'number' && [0, 1, 7, 30].includes(value.notificationRetentionDays)) result.notificationRetentionDays = value.notificationRetentionDays;
  if (validAvatarSection(value.avatarSection)) result.avatarSection = value.avatarSection;
  for (const key of ['quietStart', 'quietEnd'] as const) if (Number.isInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 23) result[key] = Number(value[key]);
  if (typeof value.overpayThreshold === 'number' && Number.isFinite(value.overpayThreshold) && value.overpayThreshold >= 0 && value.overpayThreshold <= 100) result.overpayThreshold = value.overpayThreshold;
  return result;
}

/** Exact, non-sensitive preference patch. Unknown keys and invalid values fail closed. */
export function preferencePatch(raw: unknown): Partial<Preferences> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 16000) return;
  const parsed = parsePreferences(raw); const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_PREFERENCES, key) || parsed[key as keyof Preferences] !== value) return;
    result[key] = value;
  }
  return result as Partial<Preferences>;
}
export function exportPreferences(value: Preferences): string {
  const { avatarSection: omitted, ...preferences } = parsePreferences(value); void omitted;
  return JSON.stringify({ format: 'w8rld-preferences', version: 1, preferences }, null, 2);
}
export function importPreferences(text: string): Partial<Preferences> | undefined {
  if (text.length > 16000) return;
  try {
    const raw = JSON.parse(text);
    if (!raw || raw.format !== 'w8rld-preferences' || raw.version !== 1 || Object.keys(raw).some(k => !['format', 'version', 'preferences'].includes(k))) return;
    return preferencePatch(raw.preferences);
  } catch { return; }
}
export function inQuietHours(p: Preferences, hour = new Date().getHours()): boolean {
  return p.quietHours && (p.quietStart === p.quietEnd || (p.quietStart < p.quietEnd ? hour >= p.quietStart && hour < p.quietEnd : hour >= p.quietStart || hour < p.quietEnd));
}


/** Curated document routes, not a wildcard proxy or a Roblox API capability. */
export function companionRoute(url: string): 'trades' | 'item' | 'marketplace' | 'inventory' | 'profile' | 'avatar' | 'friends' | 'community' | 'experience' | 'transactions' | 'subscription' | 'settings' | 'search' | undefined {
  if (url.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(url)) return;
  try {
    const u = new URL(url);
    if (u.origin !== 'https://www.roblox.com' || u.username || u.password || /%2f|%5c/i.test(u.pathname)) return;
    const p = u.pathname;
    if (/^\/(?:home|search\/users)\/?$/.test(p)) return 'search';
    if (/^\/trades(?:\/[^/]*)?\/?$/.test(p)) return 'trades';
    if (/^\/catalog\/[1-9]\d*(?:\/[^/]+)?\/?$/.test(p)) return 'item';
    if (/^\/catalog\/?$/.test(p)) return 'marketplace';
    if (/^\/users\/(?:[1-9]\d*\/)?inventory\/?$/.test(p)) return 'inventory';
    if (/^\/users\/[1-9]\d*\/profile\/?$/.test(p)) return 'profile';
    if (/^\/my\/avatar\/?$/.test(p)) return 'avatar';
    if (/^\/users\/(?:[1-9]\d*\/)?friends\/?$/.test(p)) return 'friends';
    if (/^\/(?:communities|groups)\/[1-9]\d*(?:\/[^/]+)?\/?$/.test(p)) return 'community';
    if (/^\/games\/[1-9]\d*(?:\/[^/]+)?\/?$/.test(p)) return 'experience';
    if (/^\/transactions\/?$/.test(p)) return 'transactions';
    if (/^\/my\/account\/?$/.test(p)) return u.hash === '#!/subscriptions' ? 'subscription' : ['', '#!/info', NATIVE_SETTINGS_HASH, '#!/w8rld'].includes(u.hash) ? 'settings' : undefined;
  } catch { /* Unknown and encoded routes fail closed. */ }
}

export function readPreferences(extension: any): Promise<Preferences> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(undefined), 2000);
    const finish = (raw: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve(effectivePreferences(parsePreferences(raw)));
    };
    try { extension.runtime.sendMessage({ type: 'w8rld:preferences' }, (reply: any) => {
      const error = extension.runtime.lastError;
      finish(!error && reply?.ok === true ? reply.preferences : undefined);
    }); } catch { finish(undefined); }
  });
}
