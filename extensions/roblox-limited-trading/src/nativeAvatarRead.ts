/*!
 * Equipped discovery adapted from RoUtility avatar.js::loadWearing (MIT).
 * Copyright (c) 2026 RoUtility; insane/routility-extension
 * @403c75ed81f297e82ada6fccf084ae3fc2249def. See ../THIRD_PARTY_NOTICES.txt.
 * Only the fixed native GET is retained. No equip/remove controls, fake worn
 * assets, hidden type exclusions, private persistence or RAP-as-Value fallback.
 */
import {safeAssetId, type TradeItemInput} from './core';

type Context = {url:string; userId:string|undefined; editor:boolean};
export type EquippedAvatar = {items:TradeItemInput[]; retrievedAt:number};
function binding(context:Context):string|undefined {
  try {
    const url=new URL(context.url);
    if(url.origin==='https://www.roblox.com' && /^\/my\/avatar\/?$/.test(url.pathname)
      && !url.username && !url.password && context.editor && context.userId && safeAssetId(context.userId)===context.userId) return context.userId;
  } catch { /* Unknown routes have no capability. */ }
}
export function parseEquippedAvatar(raw:unknown):TradeItemInput[]|undefined {
  const assets=(raw as {assets?:unknown}|null)?.assets;
  if(!Array.isArray(assets)||assets.length>100)return;
  const items:TradeItemInput[]=[];
  for(const asset of assets) {
    const rawId=typeof asset?.id==='number'&&Number.isSafeInteger(asset.id)?String(asset.id):asset?.id;
    const assetId=safeAssetId(rawId);
    // Native response is one entry per worn asset, not inventory ownership.
    // Duplicate IDs are malformed evidence, never inferred extra copies.
    if(!assetId || assetId!==rawId || typeof asset.name!=='string' || !asset.name.trim() || asset.name.length>256
      || items.some(i=>i.assetId===assetId))return;
    items.push({assetId,name:asset.name.trim(),quantity:1,side:'give'});
  }
  return items;
}
export function createNativeAvatarReader(context:()=>Context,fetcher:typeof fetch=fetch) {
  let epoch=0;let owner:string|undefined;let controller:AbortController|undefined;
  let pending:Promise<EquippedAvatar|undefined>|undefined;
  let windowAt=0,requests=0,cooldown=0;
  const reset=()=>{epoch++;controller?.abort();controller=undefined;pending=undefined;owner=undefined;};
  return {
    reset,
    load():Promise<EquippedAvatar|undefined> {
      const current=binding(context());
      if(current!==owner){reset();owner=current;}
      if(!current)return Promise.resolve(undefined);
      if(pending)return pending;
      if(Date.now()<cooldown)return Promise.resolve(undefined);
      if(Date.now()-windowAt>=60_000){windowAt=Date.now();requests=0;}
      if(requests>=6)return Promise.resolve(undefined);
      requests++;const version=epoch;const abort=new AbortController();controller=abort;
      const timeout=setTimeout(()=>abort.abort(),8000);
      pending=(async()=>{
        try {
          const response=await fetcher('https://avatar.roblox.com/v1/avatar',{
            method:'GET',credentials:'include',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:abort.signal,
          });
          if(!response.ok || !response.headers.get('content-type')?.includes('application/json') || !response.body)throw Error('Unavailable');
          const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
          while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>64*1024){abort.abort();throw Error('Oversized');}text+=decoder.decode(part.value,{stream:true});}
          const items=parseEquippedAvatar(JSON.parse(text+decoder.decode()));
          if(!items)throw Error('Invalid equipped data');
          if(version!==epoch || binding(context())!==current || abort.signal.aborted)return;
          return {items,retrievedAt:Date.now()};
        }catch{if(version===epoch)cooldown=Date.now()+60_000;return;}
        finally{clearTimeout(timeout);if(version===epoch){controller=undefined;pending=undefined;}}
      })();
      return pending;
    },
  };
}
