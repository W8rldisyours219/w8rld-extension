import { ALERT_HISTORY_KEY, COMPARISON_KEY, inQuietHours, parsePreferences, PREFERENCE_KEY } from './preferences';
import { comparisonIdentity, validComparison, validSavedComparison, type AnonymousComparison, type SavedComparison } from './tradeResearchCore';
import { serializePreferenceWrite } from './settingsService';
import { validAvatarSection } from './pagePreferences';
import { createWorkerAccess, type WorkerAccess } from './workerAccess';

/** Optional notifications are observation-driven, never a background account poll.
 * Suppression stores only public watched-asset keys/timestamps, never account,
 * transaction, price, trade or inventory history. It survives MV3 restarts. */
export function createFeatureServices(extension: any, readValue?: (assetId: string, metric: 'rap' | 'value' | 'usd', signal?: AbortSignal) => Promise<number | undefined>, access: WorkerAccess = createWorkerAccess(extension)) {
  const events = new Map<string, number>();
  const observations = new Map<string, number>();
  let recovery: Promise<void> | undefined;
  // Preference changes cancel delivery, but only explicit history clearing
  // invalidates suppression recovery. Otherwise a cancelled load could dedupe
  // nothing on the next observation.
  let recoveryGeneration = 0;
  let comparisonQueue = Promise.resolve();
  let notificationQueue = Promise.resolve(); let generation = 0;
  const noticeId = 'w8rld-market-observation';
  const evaluating = new Map<string, Promise<boolean>>();
  const clearNotice = async () => { try { await extension.notifications?.clear?.(noticeId); } catch { /* Revoked API access can refuse cleanup. */ } };
  let cleanup = Promise.resolve();
  const cancel = () => { generation++; observations.clear(); cleanup = clearNotice(); };
  extension.permissions?.onRemoved?.addListener(cancel);
  extension.storage.onChanged?.addListener((changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && PREFERENCE_KEY in changes || area === 'sync' && 'enabled' in changes) cancel();
  });
  const recover = () => recovery ??= (async () => {
    const version = recoveryGeneration;
    const raw = (await extension.storage.local.get(ALERT_HISTORY_KEY))[ALERT_HISTORY_KEY];
    if (version !== recoveryGeneration) return;
    if (raw === undefined) return;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 100) throw Error('Alert history unavailable');
    for (const row of raw.entries) {
      if (!row || typeof row.key !== 'string' || !/^(?:price|market):[1-9]\d{0,15}$/.test(row.key)
        || !Number.isSafeInteger(row.time) || row.time <= 0 || row.time > Date.now()) throw Error('Alert history unavailable');
      events.set(row.key, row.time);
    }
  })();
  const persist = () => extension.storage.local.set({ [ALERT_HISTORY_KEY]: { version: 1, entries: [...events].map(([key, time]) => ({ key, time })) } });
  const preferences = async () => parsePreferences((await extension.storage.local.get(PREFERENCE_KEY))[PREFERENCE_KEY]);
  const notificationAccess = async (version: number) => {
    const granted = await extension.permissions?.contains({ permissions: ['notifications'] });
    return granted && version === generation;
  };
  return {
    preferences,
    comparison(raw: Record<string, unknown>) {
      const signal = access.signal();
      const operation = comparisonQueue.then(async () => {
        if (!await access.allowed(signal)) return {ok:false};
        if (Object.keys(raw).some(k => !['type', 'action', 'record', 'id'].includes(k)) || !['save', 'list', 'update', 'delete'].includes(String(raw.action))
          || raw.action === 'list' && ('record' in raw || 'id' in raw)
          || ['save','update'].includes(String(raw.action)) && !validComparison(raw.record) && !validSavedComparison(raw.record)
          || raw.action === 'save' && 'id' in raw || raw.action === 'delete' && 'record' in raw
          || ['update','delete'].includes(String(raw.action)) && (typeof raw.id !== 'string' || raw.id.length>512)
          || raw.action === 'update' && !validSavedComparison(raw.record)) return { ok: false };
        const p = await preferences(); if (!p.tradeCalculator || !p.savedComparisons) return { ok: false };
        const data = (await extension.storage.local.get(COMPARISON_KEY))[COMPARISON_KEY];
        const records: (AnonymousComparison | SavedComparison)[] = Array.isArray(data) ? data.filter(r=>validComparison(r)||validSavedComparison(r)).slice(-20) : [];
        const index = records.findIndex(r=>validSavedComparison(r)&&comparisonIdentity(r)===raw.id);
        if (raw.action === 'delete' || raw.action === 'update') {
          if (index<0) return {ok:false};
          if (raw.action === 'delete') records.splice(index,1);
          else { const record=raw.record as SavedComparison; if(records.some((r,i)=>i!==index&&validSavedComparison(r)&&comparisonIdentity(r)===comparisonIdentity(record)))return {ok:false};records[index]=record; }
        }
        if (raw.action === 'save') {
          const record=raw.record as AnonymousComparison | SavedComparison;
          if(validSavedComparison(record)&&records.some(r=>validSavedComparison(r)&&comparisonIdentity(r)===comparisonIdentity(record)))return {ok:true,records,duplicate:true};
          records.push(record);
        }
        if (!await access.allowed(signal)) return {ok:false};
        if(raw.action!=='list') await extension.storage.local.set({ [COMPARISON_KEY]: records.slice(-20) });
        return { ok: true, records: records.slice(-20) };
      });
      comparisonQueue = operation.then(() => {}, () => {}); return operation;
    },
    notify(raw: unknown): Promise<boolean> {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Promise.resolve(false);
      const message = raw as Record<string, unknown>;
      if (Object.keys(message).some(k => !['type', 'kind', 'assetId'].includes(k)) || message.type !== 'w8rld:notify'
        || !['price', 'market'].includes(String(message.kind)) || typeof message.assetId !== 'string' || !/^[1-9]\d{0,15}$/.test(message.assetId)) return Promise.resolve(false);
      const version = generation;
      const signal = access.signal();
      const evaluationKey = `${version}:${message.kind}:${message.assetId}`;
      const existing = evaluating.get(evaluationKey); if (existing) return existing;
      // One watched asset and two alert kinds. Never build an unbounded queue
      // from repeated content-script observations while a provider is pending.
      if (evaluating.size >= 2) return Promise.resolve(false);
      const job = notificationQueue.then(async () => {
      await cleanup;
      if (version !== generation) return false;
      const p = await preferences();
      if (extension.storage.sync && (await extension.storage.sync.get({ enabled: true })).enabled === false) return false;
      if (!(message.kind === 'price' ? p.priceAlerts : p.marketAlerts) || p.alertAssetId !== message.assetId) return false;
      if (inQuietHours(p)) return false;
      if (!await notificationAccess(version)) return false;
      try { await recover(); } catch { return false; }
      if (version !== generation) return false;
      if (!await access.allowed(signal)) return false;
      const value = await readValue?.(message.assetId, p.alertMetric, signal);
      if (value === undefined || !Number.isFinite(value)) return false;
      if (version !== generation || !await notificationAccess(version)) return false;
      const current = await preferences();
      if (version !== generation || JSON.stringify(current) !== JSON.stringify(p) || inQuietHours(current)
        || extension.storage.sync && (await extension.storage.sync.get({ enabled: true })).enabled === false) return false;
      const prior = observations.get(`${message.assetId}:${p.alertMetric}`);
      if (message.kind === 'market') observations.set(`${message.assetId}:${p.alertMetric}`, value);
      if (message.kind === 'price' ? value < p.alertThreshold : prior === undefined || value === prior) return false;
      const now = Date.now(); const retention = p.notificationRetentionDays * 86400000;
      for (const [key, time] of events) if (now - time > Math.max(60_000, retention)) events.delete(key);
      if (events.size >= 100) events.delete(events.keys().next().value!);
      const key = `${message.kind}:${message.assetId}`;
      // At most one generic notice per condition per session/retention period.
      if (events.has(key)) return false;
      if ([...events.values()].some(t => now - t < 60_000)) return false;
      events.set(key, now);
      try { await persist(); if (version !== generation || !await notificationAccess(version) || version !== generation || inQuietHours(current)) { events.delete(key); await persist(); return false; }
        // Chromium's Windows bridge suppresses the banner when a notification
        // replaces an existing tag without renotify. Upstream showNotification
        // uses event-specific IDs. Keep W8RLD's single generic notice, clearing
        // its previous instance before this separately eligible observation.
        await extension.notifications.clear?.(noticeId);
        if(version!==generation || !await notificationAccess(version) || inQuietHours(current)) { events.delete(key); await persist(); return false; }
        await extension.notifications.create(noticeId, {
        type: 'basic', iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA3klEQVR42u2ZSw6AMAhElXgH4wX0/sfRy+jKjbGFlo82HbbGwhsGbOI4z8s5NBw0NB4AAAAAAAAAAPQBcBx7aGHSfNOfis7lX9dNb6EooJI8WYAUdXTk6sAWag7Aew5KzyeN/0oKqQXn8k9/UjNsBrjCUs9r31MDfLVOJXnJ2zbPIqxt1e934E3JlPqSLtR2hiz9GO1/Uwtx3veahb7vQreKnPpcFzTdIA9fRvnfxEJS9b1mob8ZyCksbb3FGdhCWuWsFgI60CTA85JWaweLc0b8pQQAAAAAAAAA4MO4AG74W0i5CU8IAAAAAElFTkSuQmCC',
        title: 'W8RLD market alert', message: message.kind === 'price' ? 'A watched price threshold was observed. Review the current source before acting.' : 'A watched market observation changed. Review the current source before acting.',
      });
        // Chrome creation is asynchronous. Disable/revocation may have cleared
        // the old notice before this new one actually existed.
        if (version !== generation || !await notificationAccess(version) || inQuietHours(current)) {
          await clearNotice(); events.delete(key); await persist(); return false;
        }
      } catch { events.delete(key); try { await persist(); } catch { /* No notification on storage failure. */ } return false; }
      return true;
      }).catch(() => false);
      evaluating.set(evaluationKey, job);
      notificationQueue = job.then(() => { evaluating.delete(evaluationKey); }); return job;
    },
    clear() { cancel(); recoveryGeneration++; events.clear(); recovery = undefined; },
    async remember(section: unknown) {
      if (!validAvatarSection(section)) return false;
      const signal = access.signal();
      return serializePreferenceWrite(extension, async () => {
        const p = await preferences(); if (!p.rememberAvatarSection) return false;
        if (!await access.allowed(signal)) return false;
        await extension.storage.local.set({ [PREFERENCE_KEY]: { ...p, avatarSection: section } }); return true;
      });
    },
  };
}
