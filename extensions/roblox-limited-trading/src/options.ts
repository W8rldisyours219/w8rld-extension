/** Sync the existing enabled preference; serialize writes without losing a rapid final choice. */

export { FEATURE_SETTINGS } from './settingsSchema';
import { mountSettings, runtimeSettingsClient } from './settingsView';
import { mountResearchRoutes } from './researchView';

function startFeatures(extension: any): () => void {
  const root = document.querySelector<HTMLElement>('#features');
  const search = document.querySelector<HTMLInputElement>('#settings-search');
  const status = document.querySelector<HTMLElement>('#feature-status');
  if (!root || !search || !status || !extension.storage?.local) return () => {};
  return mountSettings(root, search, status, runtimeSettingsClient(extension));
}

export function startOptions(extension: any): () => void {
  const disposeResearch=mountResearchRoutes(extension);
  const disposeFeatures = startFeatures(extension);
  const enabled = document.querySelector<HTMLInputElement>('#enabled')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  let disposed = false; let revision = 0; let confirmed = true; let desired = true;
  let writing = false; let queued = false; let storageRevision = 0;
  const show = (message?: string, error = false) => {
    if (disposed) return;
    enabled.checked = desired; status.textContent = message ?? (desired ? 'Inline analysis enabled' : 'Inline analysis disabled');
    status.setAttribute('role', error ? 'alert' : 'status'); status.setAttribute('aria-live', error ? 'assertive' : 'polite');
    enabled.setAttribute('aria-invalid', String(error));
  };
  const storageChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (disposed || area !== 'sync' || !Object.prototype.hasOwnProperty.call(changes, 'enabled')) return;
    revision++; storageRevision++; confirmed = changes.enabled.newValue !== false;
    if (!writing && !queued) { desired = confirmed; show(); }
  };
  extension.storage.onChanged.addListener(storageChanged);
  const initialRevision = revision;
  void (async () => {
    try {
      const settings = await extension.storage.sync.get({ enabled: true });
      if (revision === initialRevision) { confirmed = desired = settings?.enabled !== false; show(); }
    } catch { if (revision === initialRevision) show('Preferences unavailable; using the enabled default.', true); }
  })();
  async function save(): Promise<void> {
    if (writing || disposed) return;
    writing = true;
    while (queued && !disposed) {
      queued = false; const value = desired; const before = storageRevision;
      try {
        await extension.storage.sync.set({ enabled: value });
        if (before === storageRevision) confirmed = value;
        if (!queued) { desired = confirmed; show(`Saved · Inline analysis ${desired ? 'enabled' : 'disabled'}`); }
      }
      catch { if (!queued) { desired = confirmed; show('Preference could not be saved. Your previous choice is restored.', true); } }
    }
    writing = false;
  }
  const changed = () => { revision++; desired = enabled.checked; queued = true; show('Saving…'); void save(); };
  enabled.addEventListener('change', changed);
  const dispose = () => {
    disposeResearch();
    disposeFeatures();
    disposed = true; revision++;
    enabled.removeEventListener('change', changed); extension.storage.onChanged.removeListener(storageChanged);
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
}
const extension = (globalThis as unknown as { chrome?: any }).chrome;
if (extension?.storage?.sync) startOptions(extension);
