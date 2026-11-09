/** Public diagnostics contract v1. Pure, closed data; never pass logs/errors here. */
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DIAGNOSTIC_LIMITS = Object.freeze({ events: 24, eventBytes: 512, retentionMs: 30 * 60_000, reportChars: 1800, reportEvents: 5 });
export type DiagnosticProduct = 'extension' | 'bot' | 'client';
type RegistryRow = readonly [DiagnosticProduct | 'shared', string, string, string, 'info' | 'warning' | 'error', string, string];
// code -> product, feature, category, safe description, severity, recovery, source owner.
const rows = {
  'W8RLD-EXT-SUPPORT-000': ['extension', 'Support', 'Support', 'Support snapshot', 'info', 'Copy a new report after reproducing.', 'extensions/roblox-limited-trading/src/settingsService.ts'],
  'W8RLD-EXT-WORKER-001': ['extension', 'Worker', 'Lifecycle', 'Worker started; prior memory history is unavailable', 'info', 'Reproduce once, then copy a report.', 'extensions/roblox-limited-trading/src/background.ts'],
  'W8RLD-EXT-CONTENT-001': ['extension', 'Content initialization', 'Lifecycle', 'Content script initialization failed', 'error', 'Reload the supported page.', 'extensions/roblox-limited-trading/src/content.ts'],
  'W8RLD-EXT-CONTENT-002': ['extension', 'Content initialization', 'Lifecycle', 'Content script initialized', 'info', 'No recovery required.', 'extensions/roblox-limited-trading/src/content.ts'],
  'W8RLD-EXT-PROVIDER-001': ['extension', 'Public catalogs', 'Data Loading', 'Catalog request unavailable', 'warning', 'Wait for the provider cooldown and retry.', 'extensions/roblox-limited-trading/src/provider.ts'],
  'W8RLD-EXT-PROVIDER-002': ['extension', 'Public catalogs', 'Data Loading', 'Catalog request timed out', 'warning', 'Wait for the provider cooldown and retry.', 'extensions/roblox-limited-trading/src/provider.ts'],
  'W8RLD-EXT-CACHE-001': ['extension', 'Public catalogs', 'Cache', 'Cached observations expired', 'info', 'Retry when the provider is available.', 'extensions/roblox-limited-trading/src/provider.ts'],
  'W8RLD-EXT-SEARCH-001': ['extension', 'Smart Search', 'Data Loading', 'Public search unavailable', 'warning', 'Check optional access in Extension Settings.', 'extensions/roblox-limited-trading/src/publicSearch.ts'],
  'W8RLD-EXT-PERMISSION-001': ['extension', 'Smart Search', 'Permission', 'Optional public search access not granted', 'info', 'Grant optional access in Extension Settings if wanted.', 'extensions/roblox-limited-trading/src/publicSearch.ts'],
  'W8RLD-EXT-TRADE-001': ['extension', 'Trade valuation', 'Data Loading', 'Trade observations unavailable or incomplete', 'warning', 'Reload the trade view and retry.', 'extensions/roblox-limited-trading/src/content.ts'],
  'W8RLD-EXT-PREVIEW-001': ['extension', 'Trade preview', 'Data Loading', 'Verified preview unavailable', 'warning', 'Focus a supported native trade row again.', 'extensions/roblox-limited-trading/src/companion.ts'],
  'W8RLD-EXT-THUMBNAIL-001': ['extension', 'Thumbnails', 'Rendering', 'Thumbnail unavailable', 'info', 'Retry the visible item later.', 'extensions/roblox-limited-trading/src/companion.ts'],
  'W8RLD-EXT-NAVIGATION-001': ['extension', 'Page navigation', 'Lifecycle', 'Page enhancement failed', 'warning', 'Reload the supported page.', 'extensions/roblox-limited-trading/src/companion.ts'],
  'W8RLD-EXT-SETTINGS-001': ['extension', 'Settings', 'Persistence', 'Settings operation failed', 'error', 'Retry saving in Extension Settings.', 'extensions/roblox-limited-trading/src/settingsService.ts'],
  'W8RLD-BOT-SUPPORT-000': ['bot', 'Support', 'Support', 'Private support snapshot', 'info', 'Copy a new report after reproducing.', 'plugins/discord/bot/adapter.ts'],
  'W8RLD-BOT-COMMAND-001': ['bot', 'Command', 'Command', 'Command execution failed', 'error', 'Retry a supported command.', 'plugins/discord/bot/adapter.ts'],
  'W8RLD-BOT-COMMAND-002': ['bot', 'Command', 'Validation', 'Command input refused', 'info', 'Check the command input.', 'plugins/discord/bot/adapter.ts'],
  'W8RLD-BOT-COMMAND-003': ['bot', 'Command', 'Timeout', 'Command timed out', 'warning', 'Retry later.', 'plugins/discord/bot/adapter.ts'],
  'W8RLD-BOT-COMMAND-004': ['bot', 'Command', 'Rate Limit', 'Local command capacity exceeded', 'info', 'Wait before retrying.', 'plugins/discord/bot/adapter.ts'],
  'W8RLD-BOT-API-001': ['bot', 'Interaction delivery', 'Connection', 'Interaction reply unavailable', 'warning', 'Retry the command later.', 'plugins/discord/bot/http.ts'],
  'W8RLD-BOT-API-002': ['bot', 'Interaction delivery', 'Rate Limit', 'Discord reply rate limited', 'warning', 'Wait before retrying.', 'plugins/discord/bot/http.ts'],
  'W8RLD-CLIENT-SUPPORT-000': ['client', 'Support', 'Support', 'Client support snapshot', 'info', 'Copy a new report after reproducing.', 'mod/renderer/diagnostics.ts'],
  'W8RLD-CLIENT-STARTUP-001': ['client', 'Startup', 'Lifecycle', 'Renderer initialization failed', 'error', 'Restart the client.', 'mod/renderer/bootstrap.ts'],
  'W8RLD-CLIENT-PLUGIN-002': ['client', 'Plugin initialization', 'Lifecycle', 'A plugin failed to initialize', 'error', 'Restart; review optional plugin controls.', 'mod/renderer/pluginManager.ts'],
  'W8RLD-CLIENT-PLUGIN-003': ['client', 'Plugin teardown', 'Lifecycle', 'A plugin failed to stop cleanly', 'warning', 'Restart the client.', 'mod/renderer/pluginManager.ts'],
  'W8RLD-CLIENT-SETTINGS-001': ['client', 'Settings', 'Persistence', 'Settings persistence unavailable', 'error', 'Retry saving; preserve existing settings backups.', 'mod/renderer/settingsStore.ts'],
  'W8RLD-CLIENT-RENDER-001': ['client', 'Settings rendering', 'Rendering', 'Client UI initialization failed', 'warning', 'Restart the client.', 'mod/renderer/bootstrap.ts'],
  'W8RLD-CLIENT-PERFORMANCE-001': ['client', 'Runtime performance', 'Performance', 'Slow synchronous work observed', 'warning', 'Reproduce once and copy a report.', 'mod/renderer/freezeWatch.ts'],
  'W8RLD-SHARED-VALIDATION-001': ['shared', 'Diagnostics', 'Validation', 'Diagnostic input rejected', 'warning', 'Generate a fresh report.', 'plugins/lib/safeDiagnostics.ts'],
} as const satisfies Record<string, RegistryRow>;
export type DiagnosticCode = keyof typeof rows;
const SAFE_REPRODUCTION = {
  Support: 'Mount actual settings controls with a mock clipboard; never open an account.',
  Lifecycle: 'Throw from a synthetic initialization/teardown hook in an isolated renderer or worker.',
  'Data Loading': 'Reject the intercepted provider read or return an incomplete synthetic result.',
  Cache: 'Advance the injected fixture clock beyond the cache lifetime.',
  Permission: 'Return false from the fixture permission check; do not change real grants.',
  Rendering: 'Remove a fixture mount target or fail synthetic image decoding.',
  Command: 'Reject the injected safe-command executor with a synthetic exception.',
  Validation: 'Supply an invalid fixture field; assert a fixed refusal without serialization.',
  Timeout: 'Hold the intercepted operation unresolved and advance the fixture deadline.',
  'Rate Limit': 'Return 429 from intercepted delivery or exercise fixture command cooldown.',
  Connection: 'Reject the intercepted interaction delivery; never send a real reply.',
  Persistence: 'Reject an in-memory store write; never use real settings as a fixture.',
  Performance: 'Feed a synthetic long-task entry to the isolated observer; never freeze Discord.',
} as const;
export const DIAGNOSTIC_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(rows).map(([code, row]) => [code, Object.freeze({
  code, product: row[0], feature: row[1], category: row[2], description: row[3], severity: row[4], recovery: row[5], source: row[6],
  reproduction: SAFE_REPRODUCTION[row[2]],
  regression: row[2] === 'Support' || row[2] === 'Rendering' ? 'npm run safe-diagnostics-check' : 'node scripts/safe-diagnostics-check.mjs',
})]))) as Readonly<Record<DiagnosticCode, { code: string; product: DiagnosticProduct | 'shared'; feature: string; category: string; description: string; severity: string; recovery: string; source: string; reproduction: string; regression: string }>>;

const STATUSES = ['ok', 'unavailable', 'timeout', 'rate-limited', 'failed', 'denied', 'expired', 'started', 'ready', 'disabled', 'cancelled', 'unknown'] as const;
const STATES = ['yes', 'no', 'unknown'] as const;
const PROVIDERS = ['none', 'rolimons', 'routility', 'discord'] as const;
const PROVIDER_STATES = ['unknown', 'fresh', 'stale', 'unavailable', 'disabled', 'timeout', 'rate-limited', 'connected'] as const;
const CACHES = ['unknown', 'fresh', 'stale', 'expired', 'empty'] as const;
const STAGES = ['unknown', 'worker-start', 'content-start', 'bootstrap', 'plugins', 'ready', 'settings', 'shutdown'] as const;
const PAGES = ['unknown', 'home', 'search', 'trades', 'item', 'catalog', 'inventory', 'profile', 'friends', 'avatar', 'community', 'experience', 'transactions', 'settings'] as const;
const COMMANDS = ['unknown', 'utility', 'catalog', 'support'] as const;
const DURATIONS = ['unknown', 'under-1s', '1-5s', 'over-5s'] as const;
export interface DiagnosticEvent {
  code: DiagnosticCode;
  status: typeof STATUSES[number];
  enabled: typeof STATES[number];
  provider?: typeof PROVIDERS[number];
  providerStatus?: typeof PROVIDER_STATES[number];
  cache?: typeof CACHES[number];
  stage?: typeof STAGES[number];
  page?: typeof PAGES[number];
  command?: typeof COMMANDS[number];
  duration?: typeof DURATIONS[number];
}
export interface DiagnosticReport {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  product: DiagnosticProduct;
  version: string;
  build: string;
  os: 'Windows' | 'macOS' | 'Linux' | 'ChromeOS' | 'Unknown';
  runtime: 'Chrome' | 'Electron' | 'Node' | 'Unknown';
  runtimeMajor: number | null;
  current: DiagnosticEvent;
  recent: DiagnosticEvent[];
  privacy: 'sanitized';
  providers?: { rolimons: typeof PROVIDER_STATES[number]; routility: typeof PROVIDER_STATES[number] };
}

/** Inspect data descriptors only: no getters, toJSON, inherited fields or coercion. */
function dataRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return;
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) return;
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return;
    result[key] = descriptor.value;
  }
  return result;
}
const includes = (values: readonly unknown[], value: unknown) => values.includes(value);
export function parseDiagnosticEvent(value: unknown, product?: DiagnosticProduct): DiagnosticEvent | undefined {
  try {
    const v = dataRecord(value, ['code', 'status', 'enabled', 'provider', 'providerStatus', 'cache', 'stage', 'page', 'command', 'duration']);
    if (!v || typeof v.code !== 'string' || !Object.prototype.hasOwnProperty.call(DIAGNOSTIC_REGISTRY, v.code)) return;
    const entry = DIAGNOSTIC_REGISTRY[v.code as DiagnosticCode];
    if (product && entry.product !== product && entry.product !== 'shared') return;
    if (!includes(STATUSES, v.status) || !includes(STATES, v.enabled)) return;
    const output: Record<string, unknown> = { code: v.code, status: v.status, enabled: v.enabled };
    const optional = { provider: PROVIDERS, providerStatus: PROVIDER_STATES, cache: CACHES, stage: STAGES, page: PAGES, command: COMMANDS, duration: DURATIONS };
    for (const [key, values] of Object.entries(optional)) {
      if (Object.prototype.hasOwnProperty.call(v, key)) { if (!includes(values, v[key])) return; output[key] = v[key]; }
    }
    if (JSON.stringify(output).length > DIAGNOSTIC_LIMITS.eventBytes) return;
    return output as unknown as DiagnosticEvent;
  } catch { return; }
}

export function parseDiagnosticReport(value: unknown): DiagnosticReport | undefined {
  try {
    const v = dataRecord(value, ['schemaVersion', 'product', 'version', 'build', 'os', 'runtime', 'runtimeMajor', 'current', 'recent', 'privacy', 'providers']);
    if (!v || v.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION || !includes(['extension', 'bot', 'client'], v.product) || v.privacy !== 'sanitized') return;
    if (typeof v.version !== 'string' || v.version.length > 16 || !/^(?:unknown|\d{1,3}\.\d{1,3}\.\d{1,3})$/.test(v.version)) return;
    // Identities are baked public artifact digests, never environment values.
    if (typeof v.build !== 'string' || v.build.length > 64 || !/^(?:unknown|w8rld-(?:ext-|bot-)?[a-f0-9]{16}(?:-\d{17})?)$/.test(v.build)) return;
    if (!includes(['Windows', 'macOS', 'Linux', 'ChromeOS', 'Unknown'], v.os) || !includes(['Chrome', 'Electron', 'Node', 'Unknown'], v.runtime)) return;
    if (v.runtimeMajor !== null && (typeof v.runtimeMajor !== 'number' || !Number.isInteger(v.runtimeMajor) || v.runtimeMajor < 1 || v.runtimeMajor > 999)) return;
    const current = parseDiagnosticEvent(v.current, v.product as DiagnosticProduct);
    if (!current || !Array.isArray(v.recent) || v.recent.length > DIAGNOSTIC_LIMITS.events || Object.getPrototypeOf(v.recent) !== Array.prototype) return;
    // Reject sparse arrays, custom properties, getters and array subclasses.
    if (Reflect.ownKeys(v.recent).length !== v.recent.length + 1) return;
    const recent: DiagnosticEvent[] = [];
    for (let i = 0; i < v.recent.length; i++) {
      const d = Object.getOwnPropertyDescriptor(v.recent, String(i));
      const event = d && 'value' in d ? parseDiagnosticEvent(d.value, v.product as DiagnosticProduct) : undefined;
      if (!event) return; recent.push(event);
    }
    let providers: DiagnosticReport['providers'];
    if (Object.prototype.hasOwnProperty.call(v, 'providers')) {
      const p = dataRecord(v.providers, ['rolimons', 'routility']);
      if (!p || !includes(PROVIDER_STATES, p.rolimons) || !includes(PROVIDER_STATES, p.routility)) return;
      providers = { rolimons: p.rolimons, routility: p.routility } as NonNullable<DiagnosticReport['providers']>;
    }
    return { schemaVersion: 1, product: v.product, version: v.version, build: v.build, os: v.os, runtime: v.runtime, runtimeMajor: v.runtimeMajor,
      current, recent, privacy: 'sanitized', ...(providers ? { providers } : {}) } as DiagnosticReport;
  } catch { return; }
}

export const INVALID_DIAGNOSTIC_TEXT = '[W8RLD DEBUG REPORT]\nReport Format: 1\nPrivacy: Rejected\nStatus: Invalid diagnostic data\n[END REPORT]';
export function formatDiagnosticReport(value: unknown): string {
  const r = parseDiagnosticReport(value);
  if (!r) return INVALID_DIAGNOSTIC_TEXT;
  const e = r.current; const entry = DIAGNOSTIC_REGISTRY[e.code];
  const lines = ['[W8RLD DEBUG REPORT]', `Product: W8RLD ${r.product === 'extension' ? 'Extension' : r.product === 'bot' ? 'Bot' : 'Client'}`,
    `Version: ${r.version}`, `Build: ${r.build}`, 'Report Format: 1', `Platform: ${r.os}`, `Runtime: ${r.runtime} ${r.runtimeMajor ?? 'unknown'}`,
    `Feature: ${entry.feature}`, `Error Code: ${e.code}`, `Category: ${entry.category}`, `Status: ${e.status}`, `Feature Enabled (observed): ${e.enabled}`];
  if (e.provider) lines.push(`Provider: ${e.provider}`, `Provider Status: ${e.providerStatus ?? 'unknown'}`);
  if (r.providers) lines.push(`Catalogs: rolimons ${r.providers.rolimons} / routility ${r.providers.routility}`);
  if (r.product === 'client') lines.push('Discord Version: unavailable', 'Update Check: unavailable', 'Previous-session Crash: unavailable');
  for (const [key, label] of [['cache', 'Cache'], ['stage', 'Stage'], ['page', 'Page'], ['command', 'Command'], ['duration', 'Duration']] as const) if (e[key]) lines.push(`${label}: ${e[key]}`);
  lines.push('Privacy: Sanitized (allowlist validated)');
  const recent = r.recent.slice(-DIAGNOSTIC_LIMITS.reportEvents);
  lines.push(recent.length ? 'Recent safe events (oldest first):' : 'No recent errors recorded.');
  for (const event of recent) lines.push(`${event.code}: ${event.status}${event.provider ? ` / ${event.provider} ${event.providerStatus ?? 'unknown'}` : ''}`);
  lines.push('[END REPORT]');
  const text = lines.join('\n');
  return text.length <= DIAGNOSTIC_LIMITS.reportChars ? text : INVALID_DIAGNOSTIC_TEXT;
}

/** Memory only. Lazy expiry, no timers, IO, uploads, identifiers or log callbacks. */
export function createDiagnosticHistory(product: DiagnosticProduct, now: () => number = Date.now) {
  let entries: { time: number; event: DiagnosticEvent }[] = [];
  const prune = () => {
    const time = now();
    entries = Number.isFinite(time) ? entries.filter(e => e.time <= time && time - e.time < DIAGNOSTIC_LIMITS.retentionMs) : [];
    return time;
  };
  return Object.freeze({
    record(value: unknown): boolean {
      try {
        const event = parseDiagnosticEvent(value, product); if (!event) return false;
        const time = prune(); if (!Number.isFinite(time)) return false;
        const last = entries[entries.length - 1];
        if (last && time - last.time < 1000 && JSON.stringify(last.event) === JSON.stringify(event)) return true;
        entries.push({ time, event }); entries = entries.slice(-DIAGNOSTIC_LIMITS.events); return true;
      } catch { return false; }
    },
    snapshot(): DiagnosticEvent[] { try { prune(); return entries.map(e => ({ ...e.event })); } catch { return []; } },
    clear(): void { entries = []; },
  });
}

/** Consume runtime metadata transiently; only these coarse values are returned. */
export function coarseDiagnosticOS(platform: string): DiagnosticReport['os'] {
  return /^win|windows/i.test(platform) ? 'Windows' : /mac|darwin/i.test(platform) ? 'macOS' : /cros/i.test(platform) ? 'ChromeOS' : /linux/i.test(platform) ? 'Linux' : 'Unknown';
}
export function diagnosticRuntimeMajor(version: string | undefined): number | null {
  const major = Number(version?.match(/^(\d{1,3})(?:\.|$)/)?.[1]);
  return Number.isInteger(major) && major > 0 && major <= 999 ? major : null;
}
