import { QUOTE_FRESH_MS, safeAssetId, type LimitedQuote } from './core';
import { observation } from '../../../plugins/lib/robloxLimitedValuation';
import {W8RLD_LIMITED_CATALOG} from '../../../plugins/lib/w8rldData';
import { parseLookupMessage, parseLookupReply, validSender, type LookupReply, type LookupSender, type ProviderStatus } from './protocol';
import { createBrowserProviders, readRobloxPublicJson, readRoutilityHistory } from './transport';
import {createItemHistoryService} from './itemHistory';
import { createPublicFactService, createCommunityMemberService, type PublicFactKind } from './publicFacts';
import { createFeatureServices } from './backgroundFeatures';
import { ALERT_HISTORY_KEY, PREFERENCE_KEY } from './preferences';
import { createSettingsService, settingsSender } from './settingsService';
import { createPublicSearch } from './publicSearch';
import { createWorkerAccess, type WorkerAccess } from './workerAccess';
import { comparableUsd, usdDistance } from './similarPrice';
import { extensionDiagnosticHistory, parseContentDiagnostic } from './diagnostics';
import { createResearchHandler } from './researchService';
const demands=(result?: Awaited<ReturnType<ReturnType<typeof createBrowserProviders>['routility']['lookup']>>)=>result?.quotes.map(q=>q.demand).filter(q=>q?.availability==='available'&&['Terrible','Low','Normal','High','Amazing'].includes(q.value??''))??[];

// Owner-authorized private read-only reuse of the desktop public GET catalogs.
export const PROVIDER_STATUS = 'public-read-only';
export const CATALOG_URL = W8RLD_LIMITED_CATALOG;
const CACHE_MS = QUOTE_FRESH_MS;
type FixtureCatalog = () => Promise<Map<string, LimitedQuote>>;

/** Production message/cache owner; fixture loader is never supplied by messages. */
export function createLookupHandler(extensionId: string, fixtureCatalog?: FixtureCatalog, providers?: ReturnType<typeof createBrowserProviders>, features?: ReturnType<typeof createFeatureServices>, settings?: ReturnType<typeof createSettingsService>, publicFacts?: ReturnType<typeof createPublicFactService>, publicSearch?: ReturnType<typeof createPublicSearch>, history?: ReturnType<typeof createItemHistoryService>, members?: ReturnType<typeof createCommunityMemberService>, access?: WorkerAccess, research?: ReturnType<typeof createResearchHandler>) {
  const optionsFeature=(message:unknown,sender:LookupSender|undefined)=>settingsSender(sender,extensionId)&&!!message&&typeof message==='object'&&(!!parseLookupMessage(message)||(message as {type?:unknown}).type==='w8rld:comparison');
  let cache: { expiresAt: number; quotes: Map<string, LimitedQuote> } | undefined;
  let inFlight: Promise<Map<string, LimitedQuote>> | undefined;
  async function catalog(): Promise<Map<string, LimitedQuote>> {
    if (!fixtureCatalog) throw new Error('Provider disabled');
    if (cache && cache.expiresAt > Date.now()) return cache.quotes;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(fixtureCatalog).then((quotes) => {
      cache = { quotes, expiresAt: Date.now() + CACHE_MS }; return quotes;
    });
    try { return await inFlight; } finally { inFlight = undefined; }
  }
  const dispatch = (message: unknown, sender: LookupSender | undefined, sendResponse: (reply: LookupReply) => void, signal?: AbortSignal): true | false => {
    if (settings && message && typeof message === 'object' && !Array.isArray(message) && (message as any).type === 'w8rld:settings') {
      if (!settingsSender(sender, extensionId)) { sendResponse({ ok: false, code: 'INVALID_SENDER', error: 'Unsupported settings context.' }); return false; }
      void settings(message as Record<string, unknown>).then(reply => (sendResponse as (v: unknown) => void)(reply))
        .catch(() => (sendResponse as (v: unknown) => void)({ ok: false })); return true;
    }
    if (!validSender(sender, extensionId) && !optionsFeature(message,sender)) { sendResponse({ ok: false, code: 'INVALID_SENDER', error: 'Unsupported extension sender context.' }); return false; }
    if (message && typeof message === 'object' && !Array.isArray(message) && (message as any).type === 'w8rld:diagnostic-event') {
      const raw = message as Record<string, unknown>;
      const event = Object.keys(raw).length === 2 ? parseContentDiagnostic(raw.event) : undefined;
      (sendResponse as (v: unknown) => void)({ ok: !!event && extensionDiagnosticHistory.record(event) }); return false;
    }
    if(members&&message&&typeof message==='object'&&!Array.isArray(message)&&['w8rld:community-member','w8rld:community-member-cancel'].includes((message as any).type)){
      const raw=message as Record<string,unknown>;const tabId=sender!.tab!.id!;
      if(raw.type==='w8rld:community-member-cancel'&&Object.keys(raw).length===1){members.cancel(tabId);(sendResponse as (v:unknown)=>void)({ok:true});return false;}
      const group=(url:string|undefined)=>url&&/^\/(?:communities|groups)\/([1-9]\d*)(?:\/[^/]+)?\/?$/.exec(new URL(url).pathname)?.[1];
      if(Object.keys(raw).length!==3||typeof raw.query!=='string'||raw.groupId!==group(sender!.url)||raw.groupId!==group(sender!.tab!.url)||typeof raw.groupId!=='string'){(sendResponse as (v:unknown)=>void)({ok:false});return false;}
      void members.lookup(raw.groupId,raw.query,tabId).then(r=>(sendResponse as (v:unknown)=>void)(r??{ok:false})).catch(()=>(sendResponse as (v:unknown)=>void)({ok:false}));return true;
    }
    if (history && message && typeof message === 'object' && !Array.isArray(message) && ['w8rld:item-history','w8rld:item-history-cancel'].includes((message as any).type)) {
      const raw=message as Record<string,unknown>;const id=safeAssetId(raw.assetId);const tabId=sender!.tab!.id;
      const route=(url:string|undefined)=>url&&/^\/catalog\/([1-9]\d*)(?:\/[^/]+)?\/?$/.exec(new URL(url).pathname)?.[1];
      if(Object.keys(raw).length!==2||!id||!Number.isSafeInteger(tabId)){sendResponse({ok:false,code:'INVALID_REQUEST',error:'Unsupported item context.'});return false;}
      // Own-tab cleanup may arrive after SPA navigation changed the item route.
      if(raw.type==='w8rld:item-history-cancel'){history.cancel(tabId);(sendResponse as (v:unknown)=>void)({ok:true});return false;}
      if(route(sender!.url)!==id||route(sender!.tab!.url)!==id){sendResponse({ok:false,code:'INVALID_REQUEST',error:'Unsupported item context.'});return false;}
      void history.lookup(id,tabId!).then(reply=>(sendResponse as (v:unknown)=>void)(reply??{ok:false})).catch(()=>(sendResponse as (v:unknown)=>void)({ok:false}));return true;
    }
    if (publicSearch && features && message && typeof message === 'object' && !Array.isArray(message) && (message as any).type === 'w8rld:public-search') {
      const raw = message as Record<string, unknown>;
      if (Object.keys(raw).length !== 2 || typeof raw.query !== 'string' || raw.query.trim() !== raw.query || raw.query.length < 2 || raw.query.length > 100) return false;
      void features.preferences().then(p => p.smartSearch && !p.privacyMode ? publicSearch.search(raw.query as string) : [])
        .then(suggestions => (sendResponse as (v: unknown) => void)({ok:true,suggestions}))
        .catch(() => (sendResponse as (v: unknown) => void)({ok:false})); return true;
    }
    if (publicFacts && features && message && typeof message === 'object' && !Array.isArray(message) && (message as any).type === 'w8rld:public-facts') {
      const raw = message as Record<string, unknown>; const path = new URL(sender!.tab!.url!).pathname;
      const kind = raw.kind as PublicFactKind; const id = safeAssetId(raw.entityId);
      const matches = kind === 'profile' ? /^\/users\/([1-9]\d*)\/profile\/?$/.exec(path) : kind === 'community' ? /^\/(?:communities|groups)\/([1-9]\d*)(?:\/[^/]+)?\/?$/.exec(path) : kind === 'experience' ? /^\/games\/[1-9]\d*(?:\/[^/]+)?\/?$/.exec(path) : undefined;
      if (Object.keys(raw).length !== 3 || !id || !matches || kind !== 'experience' && matches[1] !== id) { sendResponse({ ok: false, code: 'INVALID_REQUEST', error: 'Unsupported public fact context.' }); return false; }
      void features.preferences().then(async p => {
        if (p[`${kind}Facts`] !== true) return;
        return publicFacts(kind, id);
      }).then(reply => (sendResponse as (v: unknown) => void)(reply ?? { ok: false })).catch(() => (sendResponse as (v: unknown) => void)({ ok: false })); return true;
    }
    if (features && message && typeof message === 'object' && !Array.isArray(message)) {
      const raw = message as Record<string, unknown>;
      if (raw.type === 'w8rld:preferences' && Object.keys(raw).length === 1) {
        void features.preferences().then(preferences => (sendResponse as (v: unknown) => void)({ ok: true, preferences }))
          .catch(() => (sendResponse as (v: unknown) => void)({ ok: false })); return true;
      }
      if (raw.type === 'w8rld:notify') {
        void features.notify(raw).then(sent => (sendResponse as (v: unknown) => void)({ ok: true, sent }))
          .catch(() => (sendResponse as (v: unknown) => void)({ ok: false })); return true;
      }
      if (raw.type === 'w8rld:comparison') {
        void features.comparison(raw).then(reply => (sendResponse as (v: unknown) => void)(reply))
          .catch(() => (sendResponse as (v: unknown) => void)({ ok: false })); return true;
      }
      if (raw.type === 'w8rld:remember-avatar' && Object.keys(raw).length === 2 && typeof raw.section === 'string') {
        void features.remember(raw.section).then(saved => (sendResponse as (v: unknown) => void)({ ok: true, saved }))
          .catch(() => (sendResponse as (v: unknown) => void)({ ok: false })); return true;
      }
    }
    if (providers && message && typeof message === 'object' && !Array.isArray(message)) {
      const raw = message as Record<string, unknown>;
      if (raw.type === 'w8rld:catalog-search' && Object.keys(raw).length === 2 && typeof raw.nearAssetId === 'string' && safeAssetId(raw.nearAssetId) === raw.nearAssetId) {
        const id = raw.nearAssetId;
        void providers.routility.lookup([id], signal).then(async initial => {
          const current = initial.state === 'fresh' ? initial.quotes.find(q => q.assetId === id)?.usd : undefined;
          const target = comparableUsd(current, id);
          // The existing provider searches its canonical-ID Map and shares the
          // same single-flight cache/budget. No per-candidate network requests.
          const result = target !== undefined && target > 0
            ? await providers.routility.search(q => usdDistance(current, q.usd)?.absoluteDifference, 10, signal) : undefined;
          const candidates = result?.state === 'fresh' ? result.quotes.filter(q => usdDistance(current, q.usd) !== undefined) : [];
          const ids = [...new Set(candidates.map(q => q.assetId))];
          const metadata = ids.length ? await providers.rolimons.lookup(ids, signal) : undefined;
          // Rolimon's verifies Limited identity and supplies independent display
          // fields. Its RAP/Value never select, sort or replace USD observations.
          const quotes = metadata?.state === 'fresh' ? ids.flatMap(id => metadata.quotes.filter(q => q.assetId === id)) : [];
          const accepted = candidates.filter(c => quotes.some(q => q.assetId === c.assetId));
          const reply = { ok: true, quotes, usdQuotes: accepted.map(q => q.usd), demandQuotes:demands(result)?.filter(d => quotes.some(q => q.assetId === d.assetId)),
            facts: accepted.filter(q => q.thumbnailUrl).map(q => ({ assetId: q.assetId, retrievedAt: q.retrievedAt, thumbnailUrl: q.thumbnailUrl })) };
          sendResponse(parseLookupReply(reply, ids) ?? { ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Catalog unavailable.' });
        }).catch(() => sendResponse({ ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Catalog unavailable.' }));
        return true;
      }
      if (raw.type === 'w8rld:catalog-search' && Object.keys(raw).length === 2 && typeof raw.query === 'string' && raw.query.trim().length >= 2 && raw.query.length <= 100) {
        const query = raw.query.trim().toLowerCase();
        void providers.rolimons.search(q => q.assetId === query || q.acronym?.toLowerCase() === query ? 0 : q.name.toLowerCase() === query ? 1 : q.name.toLowerCase().startsWith(query) ? 2 : q.name.toLowerCase().includes(query) ? 3 : undefined, 20, signal)
          .then(async result => {
            const ids = result.quotes.map(q => q.assetId); const usd = ids.length ? await providers.routility.lookup(ids, signal) : undefined;
            const reply = { ok: true, quotes: result.quotes, usdQuotes: usd?.quotes.map(q => q.usd).filter(q => q.availability === 'available') ?? [], demandQuotes:demands(usd),
              facts: usd?.quotes.filter(q => q.thumbnailUrl).map(q => ({assetId:q.assetId,retrievedAt:q.retrievedAt,thumbnailUrl:q.thumbnailUrl})) ?? [] };
            sendResponse(parseLookupReply(reply, ids) ?? { ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Catalog unavailable.' });
          }).catch(() => sendResponse({ ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Catalog unavailable.' }));
        return true;
      }
    }
    const request = parseLookupMessage(message);
    if (!request) { sendResponse({ ok: false, code: 'INVALID_REQUEST', error: 'Invalid Limited lookup request.' }); return false; }
    if (providers) {
      void Promise.allSettled([providers.rolimons.lookup(request.assetIds, signal), providers.routility.lookup(request.assetIds, signal)]).then(([roli, rout]) => {
        const quotes = roli.status === 'fulfilled' ? roli.value.quotes : [];
        const usdQuotes = rout.status === 'fulfilled' ? rout.value.quotes
          .map(q => observation('routility', q.assetId, 'USD', q.usd.value, q.retrievedAt, Date.now()))
          .filter(q => q.availability === 'available') : [];
        const facts = rout.status === 'fulfilled' ? rout.value.quotes.map(q => ({ assetId: q.assetId, retrievedAt: q.retrievedAt,
          ...(q.thumbnailUrl === undefined ? {} : { thumbnailUrl: q.thumbnailUrl }),
          ...(q.bestPrice?.value === undefined ? {} : { bestPrice: q.bestPrice.value }),
          ...(q.copies === undefined ? {} : { copies: q.copies }), ...(q.premiumCopies === undefined ? {} : { premiumCopies: q.premiumCopies }), ...(q.hoardShare === undefined ? {} : {hoardShare:q.hoardShare}) })) : [];
        // Empty fresh catalogs and failed providers are different outcomes.
        // Expose only fixed states/deadlines, never catalog bodies or errors.
        const status = (r: PromiseSettledResult<ProviderStatus>): ProviderStatus => r.status === 'fulfilled'
          ? { state: r.value.state, ...(r.value.retryAt === undefined ? {} : { retryAt: r.value.retryAt }) }
          : { state: 'unavailable' };
        const reply = { ok: true, quotes, usdQuotes, demandQuotes:rout.status==='fulfilled'?demands(rout.value):[], facts, providers: { rolimons: status(roli), routility: status(rout) } };
        sendResponse(parseLookupReply(reply, request.assetIds) ?? { ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Invalid catalog evidence.' });
      });
      return true;
    }
    if (!fixtureCatalog) { sendResponse({ ok: false, code: 'PROVIDER_DISABLED', error: 'Catalog transport unavailable in this context.' }); return false; }
    void catalog().then((quotes) => {
      const reply = { ok: true, quotes: request.assetIds.map((id) => quotes.get(id)).filter((quote): quote is LimitedQuote => !!quote) };
      sendResponse(parseLookupReply(reply, request.assetIds) ?? { ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Invalid catalog evidence.' });
    }).catch(() => sendResponse({ ok: false, code: 'CATALOG_UNAVAILABLE', error: 'Catalog unavailable.' }));
    return true;
  };
  return (message: unknown, sender: LookupSender | undefined, respond: (reply: LookupReply) => void): true | false => {
    const type = message && typeof message === 'object' && !Array.isArray(message) ? (message as {type?: unknown}).type : undefined;
    if(type==='w8rld:research'&&research)return research(message,sender,respond);
    // Keep sender validation, Settings, preference/status reads and own-tab
    // cancellation available. No feature data or local feature writes bypass this.
    if (!access || type === 'w8rld:settings' || !(validSender(sender, extensionId) || optionsFeature(message,sender))
      || ['w8rld:preferences', 'w8rld:item-history-cancel', 'w8rld:community-member-cancel'].includes(String(type))) return dispatch(message, sender, respond);
    const signal = access.signal();
    const refused = () => respond({ok:false, code:'PROVIDER_DISABLED', error:'W8RLD is disabled.'});
    void access.allowed(signal).then(allowed => {
      if (!allowed) { refused(); return; }
      let responded=false;
      const pending=dispatch(message, sender, reply => {
        responded=true;
        void access.allowed(signal).then(current => current ? respond(reply) : refused());
      }, signal);
      if(!pending&&!responded)respond({ok:false,code:'INVALID_REQUEST',error:'Invalid feature request.'});
    }).catch(refused);
    return true;
  };
}

const extension = (globalThis as unknown as { chrome?: any }).chrome;
if (extension?.runtime?.onMessage) {
  extensionDiagnosticHistory.record({ code: 'W8RLD-EXT-WORKER-001', status: 'started', enabled: 'unknown', stage: 'worker-start' });
  const access = createWorkerAccess(extension);
  const providers = createBrowserProviders(extension.storage.local,extension.permissions);
  const research=createResearchHandler(extension,providers,access);
  const invalidateFacts = () => {
    void extension.tabs.query({}).then((tabs: { id?: number }[]) => {
      for (const tab of tabs) if (Number.isSafeInteger(tab.id)) extension.tabs.sendMessage(tab.id, { type: 'w8rld:public-facts-changed' }, () => { void extension.runtime.lastError; });
    }).catch(() => {});
  };
  const publicFacts = createPublicFactService(extension, readRobloxPublicJson, invalidateFacts);
  const publicSearch = createPublicSearch(extension, readRobloxPublicJson);
  const members=createCommunityMemberService(extension,readRobloxPublicJson);
  extension.permissions?.onRemoved?.addListener(()=>members.clear());
  extension.permissions?.onAdded?.addListener(()=>members.clear());
  extension.tabs?.onUpdated?.addListener((tab:number,change:{status?:string})=>{if(change.status==='loading')members.cancel(tab);});
  extension.tabs?.onRemoved?.addListener((tab:number)=>members.cancel(tab));
  const history=createItemHistoryService(extension,readRoutilityHistory);
  extension.permissions?.onRemoved?.addListener(()=>history.clear());
  extension.tabs?.onUpdated?.addListener((tabId:number,change:{status?:string})=>{if(change.status==='loading')history.cancel(tabId);});
  extension.tabs?.onRemoved?.addListener((tabId:number)=>history.cancel(tabId));
  extension.permissions?.onRemoved?.addListener(() => { publicSearch.clear(); invalidateFacts(); });
  extension.permissions?.onAdded?.addListener(() => { publicSearch.clear(); invalidateFacts(); });
  extension.permissions?.onRemoved?.addListener(() => publicFacts.clear());
  extension.permissions?.onAdded?.addListener(() => publicFacts.clear());
  const features = createFeatureServices(extension, async (assetId, metric, signal) => {
    if (metric === 'usd') { const r = await providers.routility.lookup([assetId], signal); return r.state === 'fresh' ? r.quotes[0]?.usd.value : undefined; }
    const r = await providers.rolimons.lookup([assetId], signal); const q = r.quotes[0];
    return r.state === 'fresh' ? metric === 'rap' ? q?.rap : q?.estimatedValue : undefined;
  }, access);
  extension.runtime.onMessage.addListener(createLookupHandler(extension.runtime.id, undefined, providers, features, createSettingsService(extension, providers, publicFacts, {clear(){history.clear();members.clear();}}), publicFacts, publicSearch, history, members, access, research));
  // TRUSTED_CONTEXTS intentionally hides worker local storage and its changes
  // from content scripts. Send only a fixed invalidation, never storage data.
  // Numeric tab IDs and extension messaging require no additional permission.
  extension.storage.onChanged?.addListener((changes: Record<string, unknown>, area: string) => {
    if (area === 'local' && ALERT_HISTORY_KEY in changes && !(changes[ALERT_HISTORY_KEY] as { newValue?: unknown }).newValue) features.clear();
    if (area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, PREFERENCE_KEY)) return;
    const change = changes[PREFERENCE_KEY] as {oldValue?: Record<string, unknown>; newValue?: Record<string, unknown>};
    if(change.newValue?.communitySearch!==true||change.newValue?.privacyMode===true)members.clear();
    if(change.newValue?.itemPages===false||change.newValue?.showUsd===false)history.cancel();
    if (['profileFacts','communityFacts','experienceFacts'].some(key => change.oldValue?.[key] === true && change.newValue?.[key] !== true)) publicFacts.cancel();
    if (change.newValue?.smartSearch === false || change.newValue?.privacyMode === true) publicSearch.clear();
    void extension.tabs.query({}).then((tabs: { id?: number }[]) => {
      for (const tab of tabs) if (Number.isSafeInteger(tab.id)) extension.tabs.sendMessage(tab.id, { type: 'w8rld:preferences-changed' }, () => { void extension.runtime.lastError; });
    }).catch(() => {});
  });
  extension.storage.onChanged?.addListener((changes: Record<string, {newValue?: unknown}>, area: string) => {
    if(area==='sync'&&changes.enabled?.newValue===false)members.clear();
    if (area === 'sync' && changes.enabled?.newValue === false) { publicFacts.cancel(); publicSearch.clear(); history.cancel(); }
  });
}
