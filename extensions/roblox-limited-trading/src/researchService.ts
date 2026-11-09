/** Worker-only fixed operations; existing catalog budgets and explicit saved observations. */
import { settingsSender } from './settingsService';
import { parseLookupMessage, validSender } from './protocol';
import type { createBrowserProviders } from './transport';
import type { WorkerAccess } from './workerAccess';
import { selectDeals, validDealFilters, type DealFilters } from './deals';
import { safeAssetId } from './core';
import { COMPARISON_KEY } from './preferences';
import { validSavedComparison } from './tradeResearchCore';
import type { HistoricalObservation } from '../../../plugins/lib/historicalTrade';
export function createResearchHandler(extension: any, providers: ReturnType<typeof createBrowserProviders>, access: WorkerAccess) {
  return (raw: any, sender: any, reply: (value: any) => void) => {
    if (raw?.type !== 'w8rld:research') return false;
    if (!(settingsSender(sender,extension.runtime.id) || validSender(sender,extension.runtime.id))) { reply({ok:false}); return false; }
    const signal = access.signal();
    void (async () => {
      if (!await access.allowed(signal)) return {ok:false};
      let result: unknown;
      if (raw.action === 'deals' && Object.keys(raw).length === 3 && validDealFilters(raw.filters)) {
        const [asks,refs] = await Promise.all([providers.routility.snapshot(signal),providers.rolimons.snapshot(signal)]);
        result = {ok:true,...selectDeals(asks.quotes,refs.quotes,raw.filters as DealFilters),states:{asks:asks.state,references:refs.state},retryAt:Math.max(asks.retryAt??0,refs.retryAt??0),checkedAt:Date.now(),coverage:'Routility catalog best asks for Rolimon’s recognized Limiteds; one ask per asset, not individual sellers or the whole Roblox marketplace. Provider generation times are unavailable; timestamps are W8RLD retrieval times.'};
      } else if (raw.action === 'recheck' && Object.keys(raw).length === 4 && safeAssetId(raw.assetId)===raw.assetId && validDealFilters(raw.filters)) {
        const [asks,refs]=await Promise.all([providers.routility.lookup([raw.assetId],signal),providers.rolimons.lookup([raw.assetId],signal)]);
        const selected=selectDeals(asks.quotes,refs.quotes,{...raw.filters,offset:0});
        result={ok:true,row:selected.rows.find(r=>r.assetId===raw.assetId&&r.fresh)};
      } else if (raw.action === 'history' && Object.keys(raw).length === 3 && parseLookupMessage({type:'w8rld:limited-lookup',assetIds:raw.assetIds}) && raw.assetIds.length<=16) {
        const stored=(await extension.storage.local.get(COMPARISON_KEY))[COMPARISON_KEY];
        const records=Array.isArray(stored) ? stored.slice(-20).filter(validSavedComparison) : [];
        const observations: HistoricalObservation[]=records.flatMap((r: any)=>r.observations.filter((o:any)=>o.rolimonsAt).map((o:any)=>({assetId:o.assetId,at:o.rolimonsAt,source:'Rolimon’s catalog · explicitly saved W8RLD comparison',value:o.value??null,rap:o.rap??null})));
        const metadata=await providers.rolimons.lookup(raw.assetIds,signal);
        const names=Object.fromEntries(metadata.quotes.map(q=>[q.assetId,q.name]));
        result={ok:true,observations,names,coverage:'Only observations in up to 20 explicitly saved local comparisons. Names use current catalog identity. No historical Value/RAP provider is connected to this Extension. USD history is not Value or RAP. Dates before retained observations are unavailable.'};
      } else return {ok:false};
      return await access.allowed(signal) ? result : {ok:false};
    })().then(reply).catch(()=>reply({ok:false}));
    return true;
  };
}
