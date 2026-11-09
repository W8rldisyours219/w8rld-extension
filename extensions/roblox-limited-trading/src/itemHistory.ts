/*! Public history loading/observations adapted from RoUtility (MIT),
 * src/background/background.js::getHistory and src/core/content.js::loadChange
 * at 403c75ed81f297e82ada6fccf084ae3fc2249def. Copyright (c) 2026 RoUtility.
 * Full notice: ../THIRD_PARTY_NOTICES.txt. W8RLD: one public probe, bounded
 * worker memory/budget, strict identity/seconds/USD schema; never a valuation. */
import {safeAssetId, catalogAssetId} from './core';
import {parsePreferences, PREFERENCE_KEY} from './preferences';
import {usdAmount,usdExact,signedPercent} from './presentation';

export const HISTORY_BUDGET_KEY = 'w8rld:public-history-budget:v1';
const FRESH_MS = 15 * 60000;
export interface HistoryPoint {ts: number; usd: number;}
export interface ItemHistory {ok: true; assetId: string; retrievedAt: number; points: HistoryPoint[];}
function points(raw: unknown, now: number, provider = false): HistoryPoint[] | undefined {
  if (!Array.isArray(raw) || raw.length > 512) return;
  const rows = new Map<number,number>();
  for (const p of raw) {
    if (!p || typeof p !== 'object' || Object.keys(p).some(k => !['ts','usd',...(provider?['date','rap']:[])].includes(k)) || !Number.isSafeInteger(p.ts)
      || p.ts <= 0 || p.ts > Math.floor(now / 1000) || typeof p.usd !== 'number' || !Number.isFinite(p.usd) || p.usd < 0 || p.usd > Number.MAX_SAFE_INTEGER
      || rows.has(p.ts) && rows.get(p.ts) !== p.usd) return;
    rows.set(p.ts,p.usd);
  }
  return [...rows].sort((a,b)=>a[0]-b[0]).map(([ts,usd])=>({ts,usd}));
}
export function parseProviderHistory(raw: any, id: string, now = Date.now()): ItemHistory | undefined {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).some(k=>!['item_id','datapoints'].includes(k))
    || safeAssetId(typeof raw.item_id==='number'&&Number.isSafeInteger(raw.item_id)?String(raw.item_id):raw.item_id) !== id) return;
  const rows = points(raw.datapoints,now,true);return rows ? {ok:true,assetId:id,retrievedAt:now,points:rows} : undefined;
}
export function parseItemHistory(raw: any, id: string, now = Date.now()): ItemHistory | undefined {
  if (!raw || Object.keys(raw).some(k=>!['ok','assetId','retrievedAt','points'].includes(k)) || raw.ok !== true || raw.assetId !== id
    || !Number.isSafeInteger(raw.retrievedAt) || raw.retrievedAt <= 0 || raw.retrievedAt > now || now-raw.retrievedAt >= FRESH_MS) return;
  const rows = points(raw.points,now);return rows ? {...raw,points:rows} : undefined;
}
export function createItemHistoryService(extension: any, read: (id: string, signal: AbortSignal)=>Promise<unknown>) {
  const cache = new Map<string,ItemHistory>();
  // Include preflight awaits in tab cancellation, before active is assigned.
  const controllers = new Map<AbortController,number>();
  let active: {id:string;tabId:number;controller:AbortController;job:Promise<ItemHistory|undefined>} | undefined;
  const cancel = (tabId?: number, clear = false) => {
    for (const [controller, owner] of controllers) if (tabId === undefined || owner === tabId) controller.abort();
    if (tabId === undefined || active?.tabId === tabId) active = undefined;
    if (clear) cache.clear();
  };
  async function lookup(id: string, tabId: number): Promise<ItemHistory|undefined> {
    if (safeAssetId(id)!==id || !Number.isSafeInteger(tabId) || controllers.size >= 8) return;
    const controller = new AbortController(); controllers.set(controller,tabId);
    try {
      const p = parsePreferences((await extension.storage.local.get(PREFERENCE_KEY))[PREFERENCE_KEY]);
      if (!p.itemPages || !p.showUsd || (await extension.storage.sync.get({enabled:true})).enabled === false) return;
      if (controller.signal.aborted) return;
      const cached = cache.get(id);if(cached && Date.now()-cached.retrievedAt < FRESH_MS)return cached;
      if(active)return active.id===id&&active.tabId===tabId?active.job:undefined;
      const job=(async()=>{
        const retryAt=(await extension.storage.local.get(HISTORY_BUDGET_KEY))[HISTORY_BUDGET_KEY];
        if(controller.signal.aborted)return;
        if(retryAt!==undefined&&(!Number.isSafeInteger(retryAt)||retryAt>Date.now()||retryAt<0))return;
        await extension.storage.local.set({[HISTORY_BUDGET_KEY]:Date.now()+60000});
        if(controller.signal.aborted)return;
        try {
          const raw=await read(id,controller.signal);if(controller.signal.aborted)return;
          const reply=parseProviderHistory(raw,id);if(!reply)return;
          cache.delete(id);cache.set(id,reply);if(cache.size>8)cache.delete(cache.keys().next().value!);return reply;
        }catch(error){const retry=(error as {retryAt?:number})?.retryAt;if(Number.isSafeInteger(retry)&&retry!>Date.now())await extension.storage.local.set({[HISTORY_BUDGET_KEY]:retry});return;}
      })();
      active={id,tabId,controller,job};try{return await job;}finally{if(active?.job===job)active=undefined;}
    } finally { controllers.delete(controller); }
  }
  return {lookup,cancel,clear:()=>cancel(undefined,true)};
}

/*! Change window adapted from pinned core/content.js::valueChange (MIT).
 * The reference date is the last genuine observation, never retrieval time. */
export function historyChange(rows: readonly HistoryPoint[], currentUsd?: number) {
  if(rows.length<2)return;
  const sorted=[...rows].sort((a,b)=>a.ts-b.ts),last=sorted.at(-1)!;
  const base=sorted.filter(p=>p.ts<=last.ts-30*86400).at(-1)??sorted[0];
  if(base===last||base.usd<=0)return;
  const difference=(currentUsd??last.usd)-base.usd;
  return {difference,percent:difference/base.usd*100,days:Math.max(1,Math.round((last.ts-base.ts)/86400))};
}

/** A single budgeted public-history probe; no heading until real points exist.
 * The native Roblox chart remains intact. Empty/failing history stays omitted. */
export function itemHistoryView(extension: any, id: string, currentUsd?: number) {
  const node=document.createElement('details');node.className='w8rld-item-history';node.hidden=true;
  const summary=document.createElement('summary');summary.textContent='USD history';
  const output=document.createElement('div');node.append(summary,output);
  let disposed=false,serial=0;let timer:number|undefined,expiry:number|undefined;let pending=false;
  const current=()=>!disposed&&node.isConnected&&catalogAssetId(location.pathname,document.baseURI)===id;
  function cancel(){serial++;if(timer!==undefined)clearTimeout(timer);if(expiry!==undefined)clearTimeout(expiry);timer=expiry=undefined;if(pending)try{extension.runtime.sendMessage({type:'w8rld:item-history-cancel',assetId:id},()=>{void extension.runtime.lastError;});}catch{}pending=false;}
  function draw(reply:ItemHistory){
    if(!reply.points.length)return;
    output.replaceChildren();const rows=reply.points;
    const min=Math.min(...rows.map(p=>p.usd)),max=Math.max(...rows.map(p=>p.usd));
    const caption=document.createElement('small');caption.textContent=`${new Date(rows[0].ts*1000).toISOString().slice(0,10)} to ${new Date(rows.at(-1)!.ts*1000).toISOString().slice(0,10)} · ${rows.length} Routility observations`;
    const change=historyChange(rows,currentUsd);
    if(change){const label=document.createElement('span');label.className='w8rld-history-change';label.textContent=`${usdAmount(change.difference,{signed:true})} (${signedPercent(change.percent)}%) · ${change.days}d`;label.title=`Unrounded difference: ${usdExact(change.difference)}; ${change.percent}%. Price change from a genuine ${change.days}-day observation window; not sales or guaranteed proceeds.`;summary.append(label);}
    if(rows.length>1){const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 600 120');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Routility USD estimate history, ${rows.length} observations; range ${min} to ${max} dollars.`);const line=document.createElementNS(ns,'polyline');const first=rows[0].ts,span=rows.at(-1)!.ts-first;
      line.setAttribute('points',rows.map(p=>`${(4+(p.ts-first)/span*592).toFixed(1)},${(max===min?60:116-(p.usd-min)/(max-min)*112).toFixed(1)}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);output.append(svg);}
    else{const point=document.createElement('p');point.textContent=usdAmount(rows[0].usd);output.append(point);}
    const list=document.createElement('ul');for(const p of rows.slice(-10).reverse()){const row=document.createElement('li');row.textContent=`${new Date(p.ts*1000).toISOString().slice(0,10)} · ${usdAmount(p.usd)}`;row.title=`${new Date(p.ts*1000).toISOString()} · ${p.usd} USD`;list.append(row);}
    const latest=document.createElement('details');const label=document.createElement('summary');label.textContent='Latest observations';latest.append(label,list);output.append(caption,latest);node.hidden=false;
    expiry=window.setTimeout(()=>{expiry=undefined;node.hidden=true;node.open=false;output.replaceChildren();},Math.max(1,reply.retrievedAt+FRESH_MS-Date.now()));
  }
  function load(){
    if(!current())return;const version=serial;pending=true;
    timer=window.setTimeout(()=>{if(version===serial)cancel();},10000);
    try{extension.runtime.sendMessage({type:'w8rld:item-history',assetId:id},(raw:unknown)=>{const error=extension.runtime.lastError;if(version!==serial||!current())return;if(timer!==undefined)clearTimeout(timer);timer=undefined;pending=false;const reply=!error&&parseItemHistory(raw,id);if(reply)draw(reply);});}catch{cancel();}
  }
  queueMicrotask(load);
  return {node,dispose(){disposed=true;cancel();node.remove();}};
}
