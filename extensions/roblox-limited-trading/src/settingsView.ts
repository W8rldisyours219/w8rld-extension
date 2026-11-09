/*! Row/dependency painting adapted from RoUtility src/settings/settings.js
 * (row, toggle, offParent, paint) at 403c75ed81f297e82ada6fccf084ae3fc2249def.
 * Copyright (c) 2026 RoUtility. MIT; full notice in ../THIRD_PARTY_NOTICES.txt.
 * W8RLD retains native checkbox switches and its validated worker preferences. */
/** Shared native/options settings view. Only sanitized preference messages cross contexts. */
import { DEFAULT_PREFERENCES, exportPreferences, importPreferences, parsePreferences, type Preferences } from './preferences';
import { FEATURE_SETTINGS, SETTINGS_CATEGORIES } from './settingsSchema';
import { PUBLIC_FACT_ORIGINS, MEMBER_ORIGINS, type PublicFactKind } from './publicFacts';
import { SEARCH_ORIGIN } from './publicSearch';
import { settingsCategoryIcon } from './nativeIcons';
import { createDiagnosticView } from '../../../plugins/lib/diagnosticView';
import {W8RLD_DATA_ORIGIN} from '../../../plugins/lib/w8rldData';

export interface SettingsSnapshot {
  diagnostics?: unknown;
  ok: boolean; preferences?: Preferences; enabled?: boolean; notifications?: boolean; permissionRequired?: boolean;
  providers?: { name: string; state: string; fetchedAt: number; entries: number; retryAt?: number }[];
  history?: { kind: string; time: number }[];
  publicAccess?: Record<PublicFactKind, boolean>;
  searchAccess?: boolean;
  memberAccess?: boolean;
  dataAccess?:boolean;
}
export interface SettingsClient {
  toolsUrl?: string;
  request(action: string, patch?: Partial<Preferences>, enabled?: boolean): Promise<SettingsSnapshot>;
  permission?(kind?: PublicFactKind | 'search' | 'member'|'data'): Promise<boolean>;
  removePermission?(kind?: PublicFactKind | 'search' | 'member'|'data'): Promise<boolean>;
  subscribe?(fn: () => void): () => void;
}
export function runtimeSettingsClient(extension: any): SettingsClient {
  return {
    toolsUrl: extension.runtime.getURL?.('options.html'),
    request: (action, patch, enabled) => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value?: SettingsSnapshot) => { if (settled) return; settled = true; clearTimeout(timer); value?.ok ? resolve(value) : reject(Error(value?.permissionRequired ? 'Grant notification permission in Extension Settings first.' : 'Settings could not be saved. Previous choices retained.')); };
      const timer = setTimeout(() => finish(), 10000);
      try { extension.runtime.sendMessage({ type: 'w8rld:settings', action, ...(patch ? { patch } : {}), ...(enabled === undefined ? {} : { enabled }) }, (reply: SettingsSnapshot) => {
        const error = extension.runtime.lastError; finish(error ? undefined : reply);
      }); } catch { finish(); }
    }),
    ...(extension.permissions?.request ? { permission: (kind?: PublicFactKind | 'search' | 'member'|'data') => extension.permissions.request(kind ? { origins: kind==='data'?[W8RLD_DATA_ORIGIN]:kind === 'search' ? [SEARCH_ORIGIN] : kind==='member'?MEMBER_ORIGINS:[...PUBLIC_FACT_ORIGINS[kind]] } : { permissions: ['notifications'] }) } : {}),
    ...(extension.permissions?.remove ? { removePermission: (kind?: PublicFactKind | 'search' | 'member'|'data') => extension.permissions.remove(kind ? { origins: kind==='data'?[W8RLD_DATA_ORIGIN]:kind === 'search' ? [SEARCH_ORIGIN] : kind==='member'?MEMBER_ORIGINS:[...PUBLIC_FACT_ORIGINS[kind]] } : { permissions: ['notifications'] }) } : {}),
    subscribe(fn) {
      const message = (raw: any, sender: any) => { if (sender?.id === extension.runtime.id && ['w8rld:preferences-changed', 'w8rld:public-facts-changed'].includes(raw?.type) && Object.keys(raw).length === 1) fn(); };
      const storage = (changes: any, area: string) => { if (area === 'sync' && 'enabled' in changes) fn(); };
      extension.runtime.onMessage?.addListener(message); extension.storage.onChanged?.addListener(storage);
      extension.permissions?.onAdded?.addListener(fn); extension.permissions?.onRemoved?.addListener(fn);
      return () => { extension.runtime.onMessage?.removeListener(message); extension.storage.onChanged?.removeListener(storage); extension.permissions?.onAdded?.removeListener(fn); extension.permissions?.onRemoved?.removeListener(fn); };
    },
  };
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag); if (text) n.textContent = text; return n;
};

/** Detached owned nodes dispose their listeners with the subtree. Window listeners are explicit. */
export function mountSettings(root: HTMLElement, search: HTMLInputElement, status: HTMLElement, client: SettingsClient, master = false): () => void {
  let disposed = false; let ready = false; let writing = false; let pending: Partial<Preferences> = {};
  let desired = { ...DEFAULT_PREFERENCES }; let confirmed = { ...desired }; let requestRevision = 0;
  let category = 'General'; let enabled = true; let snapshot: SettingsSnapshot = {} as SettingsSnapshot;
  let permissionNotice = '';
  let changeRevision = 0;
  let dataChanging=false;
  const accessControls: { key: keyof Preferences; kind?: PublicFactKind|'member'; button: HTMLButtonElement }[] = [];
  const accessGranted = (kind?: PublicFactKind|'member') => kind==='member'?snapshot.memberAccess===true:kind ? snapshot.publicAccess?.[kind] === true : snapshot.notifications === true;
  const groups = new Map<string, HTMLFieldSetElement>(); const controls = new Map<keyof Preferences, HTMLInputElement | HTMLSelectElement>();
  let diagnostics: HTMLPreElement | undefined;
  const navigation = el('nav'); navigation.className = 'w8rld-settings-categories'; navigation.setAttribute('aria-label', 'W8RLD settings categories');
  const content = el('div'); content.className = 'w8rld-settings-content'; root.classList.add('w8rld-settings'); root.append(navigation, content);
  if(client.toolsUrl){const tools=el('div');tools.className='w8rld-research-nav';for(const [hash,title]of [['deals','Limited Deals'],['calculator','Trade calculator']]){const link=el('a',title);link.href=client.toolsUrl+'#'+hash;link.target='_blank';link.rel='noopener noreferrer';tools.append(link);}content.append(tools);}
  const tell = (message: string, error = false) => { if (!disposed) { status.textContent = message; status.setAttribute('role', error ? 'alert' : 'status'); } };
  const reflect = () => {
    dataAccess.textContent=snapshot.dataAccess?'Remove W8RLD data access':'Connect W8RLD data';dataAccess.disabled=!ready||dataChanging;
    for (const {key, kind, button} of accessControls) {
      const granted = accessGranted(kind);
      button.hidden = !desired[key] && !granted;
      button.disabled = !ready;
      button.textContent = client.permission ? granted ? 'Remove access' : 'Grant access' : 'Manage access in Extension Settings';
    }
    if (diagnostics) { diagnostics.hidden = !desired.diagnostics; diagnostics.textContent = 'Safe reports are available in General → Support & Diagnostics.'; }
    for (const [key, control] of controls) {
      const spec = FEATURE_SETTINGS.find(s => s.key === key);
      control.disabled = !ready || !!spec?.unavailable || !!spec?.depends && desired[spec.depends] !== true;
      if (spec) {
        const row = control.closest<HTMLElement>('.w8rld-preference');
        if (row) { row.dataset.state = desired[key] === true ? 'checked' : 'unchecked'; row.dataset.blocked = String(!!spec.depends && desired[spec.depends] !== true); }
        const note = row?.querySelector<HTMLElement>('.w8rld-setting-availability');
        if (note) {
          const permission = ['priceAlerts','marketAlerts'].includes(key) ? snapshot.notifications
            : key === 'smartSearch' ? snapshot.searchAccess : key === 'profileFacts' ? snapshot.publicAccess?.profile
            : key === 'communityFacts' ? snapshot.publicAccess?.community : key === 'experienceFacts' ? snapshot.publicAccess?.experience : key==='communitySearch'?snapshot.memberAccess:undefined;
          note.textContent = spec.depends && desired[spec.depends] !== true ? `Turn on ${FEATURE_SETTINGS.find(s => s.key === spec.depends)?.label ?? spec.depends} to use this.`
            : permission === false ? key === 'smartSearch' ? 'Public player/experience access not granted. Limited and native suggestions remain available.'
              : key==='communitySearch'?'Public member access not granted. Loaded filtering remains available.': ['profileFacts','communityFacts','experienceFacts'].includes(key) ? 'Public data access not granted. Supported visible facts remain available.' : 'Notification permission not granted. Your choice is saved; delivery is paused.' : '';
          note.hidden = !note.textContent;
        }
      }
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = desired[key] === true;
      else control.value = String(desired[key]);
    }
  };
  const empty = el('p', 'No matching W8RLD settings.'); empty.setAttribute('role', 'status'); empty.hidden = true; content.append(empty);
  const filter = () => {
    const query = search.value.trim().toLowerCase();
    for (const [name, group] of groups) {
      let matches = 0;
      for (const row of group.querySelectorAll<HTMLElement>('[data-search]')) { row.hidden = !!query && !row.dataset.search!.includes(query); if (!row.hidden) matches++; }
      group.hidden = !!query ? !matches : name !== category;
    }
    for (const button of navigation.querySelectorAll('button')) button.setAttribute('aria-pressed', String(!query && button.textContent === category));
    empty.hidden = !query || [...groups.values()].some(group => !group.hidden);
  };
  for (const name of SETTINGS_CATEGORIES) {
    const button = el('button'); button.type = 'button';
    const icon = settingsCategoryIcon(name); if (icon) button.append(icon);
    button.append(el('span', name));
    button.addEventListener('click', () => { category = name; search.value = ''; filter(); }); navigation.append(button);
    const group = el('fieldset'); group.append(el('legend', name)); groups.set(name, group); content.append(group);
  }
  const navigateCategory = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...navigation.querySelectorAll('button')]; const index = buttons.indexOf(event.target as HTMLButtonElement); if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); category = buttons[next].textContent!; search.value = ''; filter(); buttons[next].focus();
  };
  navigation.addEventListener('keydown', navigateCategory);
  const permissions = el('p'); permissions.className = 'w8rld-settings-note';
  permissions.textContent = 'Stored on this browser. Public catalog requests omit credentials. No account actions.'; groups.get('General')!.append(permissions);
  const dataRow=el('div');dataRow.className='w8rld-preference';dataRow.dataset.search='w8rld data catalog value rap access permissions connect';
  const dataAccess=el('button','Connect W8RLD data');dataAccess.type='button';dataAccess.disabled=true;
  dataRow.append(el('p','W8RLD data supplies saved public Value and RAP. Connect once to enable anonymous reads; existing source dates and unavailable metrics stay visible.'),dataAccess);groups.get('General')!.append(dataRow);
  dataAccess.addEventListener('click',()=>{
    if(disposed||dataChanging||!ready)return;
    // Only this explicit user gesture can display the browser permission prompt.
    const granted=snapshot.dataAccess===true;
    const job=granted?client.removePermission?.('data'):client.permission?.('data');
    if(!job){void client.request('open-options');return;}
    dataChanging=true;dataAccess.disabled=true;
    void job.then(async ok=>{if(!ok){tell('Data access unchanged. Cached data or N/A remains available.');return;}snapshot=await client.request('get');tell(granted?'W8RLD data access removed.':'W8RLD data connected.');}).catch(()=>tell('Data access could not be changed.',true)).finally(()=>{dataChanging=false;if(!disposed)reflect();});
  });
  let masterInput: HTMLInputElement | undefined;
  if (master) {
    const row = el('label', 'Enable W8RLD'); row.className = 'w8rld-preference'; row.dataset.search = 'general enable w8rld';
    masterInput = el('input'); masterInput.type = 'checkbox'; masterInput.setAttribute('role', 'switch'); masterInput.disabled = true;
    masterInput.addEventListener('change', () => { const value = masterInput!.checked; masterInput!.disabled = true;
      requestRevision++;
      void client.request('update', {}, value).then(r => { enabled = r.enabled !== false; tell('Saved.'); }).catch(e => tell(e.message, true)).finally(() => { if (!disposed) { masterInput!.checked = enabled; masterInput!.disabled = false; } });
    }); row.append(masterInput); groups.get('General')!.append(row);
  }
  async function save() {
    if (writing || !ready || disposed) return; writing = true;
    while (Object.keys(pending).length && !disposed) {
      const patch = pending; pending = {};
      try {
        const result = await client.request('update', patch); confirmed = parsePreferences(result.preferences); snapshot = result;
        desired = { ...confirmed, ...pending }; refreshInfo(); tell(permissionNotice || 'Saved locally.', !!permissionNotice); permissionNotice = '';
      } catch (error) { desired = { ...confirmed, ...pending }; tell((error as Error).message, true); }
      reflect();
    }
    writing = false;
  }
  async function change(patch: Partial<Preferences>) {
    if (!ready || disposed) return;
    // A refresh started before this gesture may finish after its save. Never
    // let that older snapshot revert the newly confirmed control state.
    requestRevision++;
    const change = ++changeRevision;
    if ((patch.priceAlerts || patch.marketAlerts) && !snapshot.notifications && client.permission) {
      let granted = false; try { granted = await client.permission(); } catch { /* denied */ }
      // onAdded also refreshes the snapshot. That refresh is not a newer user
      // choice and must not discard the very enable that requested the grant.
      if (disposed || change !== changeRevision) return;
      snapshot.notifications = granted;
      if (!granted) permissionNotice = 'Notification permission was not granted. Your choice is saved; delivery is paused. Use Grant access to retry.';
    }
    for (const kind of ['profile', 'community', 'experience'] as const) {
      const key = `${kind}Facts` as keyof Preferences;
      if (patch[key] === true && !snapshot.publicAccess?.[kind] && client.permission) {
        let granted = false; try { granted = await client.permission(kind); } catch { /* denied */ }
        if (disposed || change !== changeRevision) return;
        snapshot.publicAccess = { profile: false, community: false, experience: false, ...snapshot.publicAccess, [kind]: granted };
        if (!granted) permissionNotice = 'Public data access was not granted. Only supported visible facts are available. Enable this switch again in Extension Settings to retry the permission request.';
      } else if (patch[key] === true && !snapshot.publicAccess?.[kind]) {
        permissionNotice = 'Only supported visible facts are available. Open Extension Settings to grant optional public data access.';
      }
    }
    desired = parsePreferences({ ...desired, ...patch }); pending = { ...pending, ...patch }; reflect(); tell('Saving…'); void save();
  }
  const resetButton = (key: keyof Preferences) => {
    const button = el('button', 'Reset'); button.type = 'button'; button.className = 'w8rld-reset'; button.setAttribute('aria-label', `Reset ${FEATURE_SETTINGS.find(s => s.key === key)?.label ?? key}`);
    button.addEventListener('click', () => { void change({ [key]: DEFAULT_PREFERENCES[key] }); }); return button;
  };
  for (const spec of FEATURE_SETTINGS) {
    const row = el('div'); row.className = 'w8rld-preference'; row.dataset.search = `${spec.category} ${spec.label} ${spec.description}`.toLowerCase();
    const words = el('span'); const name = el('strong', spec.label); const help = el('small', spec.unavailable ?? spec.description + (spec.depends ? ` Requires ${FEATURE_SETTINGS.find(s => s.key === spec.depends)?.label ?? spec.depends}.` : ''));
    help.id = `w8rld-help-${spec.key}`; const availability = el('small'); availability.className = 'w8rld-setting-availability'; availability.id = `w8rld-availability-${spec.key}`; availability.hidden = true; words.append(name, help, availability);
    const control = el('input'); control.type = 'checkbox'; control.className = 'w8rld-switch'; control.setAttribute('role', 'switch'); control.setAttribute('aria-label', spec.label); control.setAttribute('aria-describedby', help.id);
    control.setAttribute('aria-describedby', `${help.id} ${availability.id}`);
    control.addEventListener('change', () => { void change({ [spec.key]: control.checked }); }); controls.set(spec.key, control);
    row.append(words, control, resetButton(spec.key)); groups.get(spec.category)!.append(row);
    const kind = spec.key === 'profileFacts' ? 'profile' : spec.key === 'communityFacts' ? 'community' : spec.key === 'experienceFacts' ? 'experience' : spec.key==='communitySearch'?'member':undefined;
    if (kind || ['priceAlerts', 'marketAlerts'].includes(spec.key)) {
      const button = el('button'); button.type = 'button'; button.className = 'w8rld-permission';
      button.setAttribute('aria-label', `Manage access for ${spec.label}`);
      const why = kind ? `Optional public ${kind} access: ${(kind==='member'?MEMBER_ORIGINS:PUBLIC_FACT_ORIGINS[kind]).join(', ')}. Requests omit credentials.` : 'Optional desktop notifications for the watched public item. Shared by price and market alerts; no background polling.';
      button.title = why; const explanation = el('small', why); words.append(explanation);
      button.addEventListener('click', () => {
        if (!ready || disposed) return;
        if (!client.permission) { void client.request('open-options').catch(e => tell(e.message, true)); return; }
        const removing = accessGranted(kind);
        // Start synchronously inside the explicit gesture. No worker relay can
        // request a grant, and no grant is requested merely by opening Settings.
        const operation = removing ? client.removePermission?.(kind) : client.permission(kind);
        if (!operation) return;
        button.disabled = true;
        void operation.then(async granted => {
          if (disposed) return;
          snapshot = await client.request('get'); if (disposed) return; reflect(); refreshInfo();
          tell(removing ? 'Access removed. Saved choices are retained.' : granted ? 'Access granted. Enabled features can now use it.' : 'Access was not granted. Saved choices are retained.', !removing && !granted);
        }).catch(() => tell('Access could not be changed. Saved choices are retained.', true)).finally(() => { if (!disposed) reflect(); });
      });
      row.append(button); accessControls.push({key:spec.key,kind,button});
    }
  }
  function field(category: string, key: keyof Preferences, title: string, options?: [string, string][], max = 1e12) {
    const row = el('label', title); row.className = 'w8rld-field'; row.dataset.search = `${category} ${title}`.toLowerCase();
    const control = options ? el('select') : el('input'); control.setAttribute('aria-label', title);
    if (control instanceof HTMLSelectElement) for (const [value, label] of options!) { const option = el('option', label); option.value = value; control.append(option); }
    else { control.type = key === 'alertAssetId' ? 'text' : 'number'; control.min = '0'; control.max = String(max); control.step = 'any'; control.maxLength = 16; }
    control.addEventListener('change', () => { void change({ [key]: typeof DEFAULT_PREFERENCES[key] === 'number' ? Number(control.value) : control.value }); }); controls.set(key, control);
    row.append(control, resetButton(key)); groups.get(category)!.append(row);
  }
  field('Trading', 'tradeListMetrics', 'Leading trade-list metrics', [['rap-usd', 'RAP + $ first'], ['value-usd', 'Value + $ first'], ['rap-value', 'RAP + Value first']]);
  const searchAccess = el('button', client.permission ? 'Enable public player and experience suggestions' : 'Public search access in Extension Settings'); searchAccess.type = 'button';
  searchAccess.addEventListener('click', () => {
    if (!client.permission) { void client.request('open-options'); return; }
    void client.permission('search').then(granted => { snapshot.searchAccess = granted; reflect(); tell(granted ? 'Public suggestions enabled. Search queries are sent to Roblox without credentials.' : 'Public search access was not granted. Limited and native suggestions remain available.', !granted); }).catch(() => tell('Public search access was not granted. Limited and native suggestions remain available.', true));
  });
  groups.get('Search')!.append(searchAccess, el('p', 'Uses the existing Roblox search field. Friends already visible on this page rank first; no private friend list is requested. Public player and experience results require optional public search access.'));
  field('Trading', 'overpayThreshold', 'Value warning threshold (%)', undefined, 100);
  field('General', 'usdFallback', 'Missing USD estimates', [['off', 'N/A (no conversion)'], ['rap', 'Estimate from RAP']]);
  field('General', 'valueFallback', 'Missing Value (Robux)', [['off', 'N/A (curated Value only)'], ['rap', 'Estimated Value from RAP']]);
  field('General', 'usdPerThousandRobux', 'USD per 1,000 Robux of RAP', undefined, 1e6);
  groups.get('General')!.append(el('p', 'Optional estimate = RAP ÷ 1,000 × the configured USD rate. Routility estimates take priority. Mixed methods never produce a trade difference. Not a market price.'));
  field('Notifications', 'alertAssetId', 'Watched asset ID'); field('Notifications', 'alertMetric', 'Threshold metric', [['rap', 'RAP · R$'], ['value', 'Value · R$'], ['usd', '$']]);
  field('Notifications', 'alertThreshold', 'Notify at or above'); field('Notifications', 'notificationRetentionDays', 'Suppress repeated alerts for', [['0', 'This minute'], ['1', '1 day'], ['7', '7 days'], ['30', '30 days']]);
  field('Notifications', 'quietStart', 'Quiet hours start (0–23)', undefined, 23); field('Notifications', 'quietEnd', 'Quiet hours end (0–23)', undefined, 23);
  const providerStatus = el('p'); const history = el('details'); history.append(el('summary', 'Local alert delivery history'));
  const publicStatus = el('p');
  const historyList = el('div'); history.append(historyList); groups.get('Notifications')!.append(history);
  const refreshInfo = () => {
    providerStatus.textContent = (snapshot.providers ?? []).map(p => `${p.name}: ${p.state}${p.fetchedAt ? ` · ${new Date(p.fetchedAt).toLocaleString()}` : ''} · ${p.entries} cached items${p.retryAt ? ' · request cooldown active' : ''}`).join(' / ') || 'Catalog status unavailable.';
    publicStatus.textContent = (['profile', 'community', 'experience'] as const).map(k => `Public ${k} access: ${snapshot.publicAccess?.[k] ? 'granted' : 'not granted'}`).join(' · ');
    historyList.replaceChildren(...(snapshot.history ?? []).slice().reverse().map(r => el('p', `${r.kind === 'price' ? 'Price threshold' : 'Market change'} · ${new Date(r.time).toLocaleString()}`)));
    if (!historyList.childNodes.length) historyList.textContent = 'No local alerts.';
  };
  groups.get('Advanced')!.append(providerStatus);
  groups.get('Advanced')!.append(publicStatus);
  const publicNote = el('p', 'Public profile counts, community dates/descriptions and experience statistics use optional Roblox data access. Requests omit authentication; no public response is stored on disk. Grant the relevant access by turning its Public facts switch on in Extension Settings.');
  groups.get('Advanced')!.append(publicNote);
  const support = createDiagnosticView({
    load: async () => (await client.request('debug-report')).diagnostics,
    clear: async () => { await client.request('debug-clear'); },
    textClass: 'w8rld-settings-diagnostics',
  });
  support.dataset.search = 'support diagnostics debug copy report history';
  groups.get('General')!.append(support);
  function action(category: string, label: string, name: string, confirmation?: string) {
    const row = el('div'); row.dataset.search = `${category} ${label}`.toLowerCase(); const button = el('button', label); button.type = 'button';
    const confirm = el('span'); confirm.hidden = true;
    const run = async () => {
      if (writing || Object.keys(pending).length) { tell('Wait for the current save to finish.', true); return; }
      button.disabled = true;
      try { const r = await client.request(name); if (disposed) return; if (r.preferences) { snapshot = r; desired = confirmed = parsePreferences(r.preferences); reflect(); refreshInfo(); } tell(`${label}: done.`); }
      catch (e) { tell((e as Error).message, true); } finally { if (!disposed) { button.disabled = false; confirm.hidden = true; } }
    };
    if (confirmation) {
      confirm.append(el('span', confirmation)); const yes = el('button', 'Confirm'); yes.type = 'button'; const no = el('button', 'Cancel'); no.type = 'button';
      yes.addEventListener('click', () => { void run(); }); no.addEventListener('click', () => { confirm.hidden = true; button.focus(); }); confirm.append(yes, no);
      button.addEventListener('click', () => { confirm.hidden = false; yes.focus(); });
    } else button.addEventListener('click', () => { void run(); });
    row.append(button, confirm); groups.get(category)!.append(row);
  }
  action('Notifications', client.permission ? 'Extension notification options' : 'Grant notification permission in Extension Settings', 'open-options');
  action('Notifications', 'Clear local alert history', 'clear-history');
  action('Trading', 'Delete saved comparisons', 'clear-comparisons', 'Delete all anonymous saved comparisons?');
  action('Advanced', 'Refresh source availability', 'get');
  action('Advanced', 'Open public-data permissions in Extension Settings', 'open-options');
  action('Advanced', 'Clear public catalog cache', 'clear-cache', 'Discard cached public observations? Request cooldowns are retained.');
  action('General', 'Reset all settings', 'reset', 'Restore every W8RLD preference to its default?');
  action('Privacy', 'Clear locally stored extension data', 'clear-local', 'Reset preferences and delete public caches, local alerts and saved comparisons?');
  const exportRow = el('div'); exportRow.dataset.search = 'general import export preferences';
  const exportButton = el('button', 'Prepare preference export'); exportButton.type = 'button'; const download = el('a', 'Save preferences'); download.hidden = true; download.download = 'w8rld-preferences.json'; let blobUrl: string | undefined;
  exportButton.addEventListener('click', () => { if (!ready) return; if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = URL.createObjectURL(new Blob([exportPreferences(desired)], { type: 'application/json' })); download.href = blobUrl; download.hidden = false; });
  const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Import non-sensitive W8RLD preferences');
  file.addEventListener('change', () => { const selected = file.files?.[0]; if (!selected || selected.size > 16000) { tell('Choose a W8RLD preference file under 16 KB.', true); return; }
    void selected.text().then(text => { if (disposed) return; const patch = importPreferences(text); if (!patch) tell('Invalid preference file. Nothing imported.', true); else void change(patch); });
  }); exportRow.append(exportButton, download, file); groups.get('General')!.append(exportRow);
  diagnostics = el('pre'); diagnostics.className = 'w8rld-settings-diagnostics'; groups.get('Advanced')!.append(diagnostics);
  search.addEventListener('input', filter); reflect(); filter();
  const revision = ++requestRevision;
  void client.request('get').then(r => {
    if (disposed || requestRevision !== revision) return; snapshot = r; desired = confirmed = parsePreferences(r.preferences); enabled = r.enabled !== false; ready = true;
    if (masterInput) { masterInput.checked = enabled; masterInput.disabled = false; } reflect(); refreshInfo(); tell('Preferences stored locally.');
  }).catch(e => tell((e as Error).message, true));
  const unsubscribe = client.subscribe?.(() => { if (writing || Object.keys(pending).length || disposed) return;
    const revision = ++requestRevision;
    void client.request('get').then(r => { if (disposed || revision !== requestRevision || writing || Object.keys(pending).length) return; snapshot = r; desired = confirmed = parsePreferences(r.preferences); enabled = r.enabled !== false; ready = true; if (masterInput) { masterInput.checked = enabled; masterInput.disabled = false; } reflect(); refreshInfo(); }).catch(() => {});
  });
  return () => { disposed = true; requestRevision++; support.dispose(); unsubscribe?.(); search.removeEventListener('input', filter); navigation.removeEventListener('keydown', navigateCategory); if (blobUrl) URL.revokeObjectURL(blobUrl); root.replaceChildren(); };
}
