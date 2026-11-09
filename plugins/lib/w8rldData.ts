/** Credential-free public serving contract. W8RLD storage supplies data; the
 * original provider, amount and retrieval dates never become W8RLD estimates. */
import { CATALOG_MAX_BYTES, QUOTE_SOURCE, type LimitedQuote, type RolimonsItem } from './robloxLimitedValuation';

export const W8RLD_LIMITED_CATALOG = 'https://w8rldisyours.com/api/data/v1/catalog/limiteds';
export const W8RLD_DATA_ORIGIN='https://w8rldisyours.com/*';
export const W8RLD_DATA_MAX_BYTES = CATALOG_MAX_BYTES;
export interface StoredLimitedCatalog { retrievedAt:number; quotes:Map<string,LimitedQuote>; items:RolimonsItem[]; }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const amount=(v:unknown):v is number|null=>v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
/** Full validation precedes publication: duplicate IDs, future times, a new
 * source/model, partial catalogs or mixed units refuse the complete response. */
export function parseW8rldLimitedCatalog(raw:unknown,now=Date.now()):StoredLimitedCatalog {
  if(!object(raw)||raw.schemaVersion!==1||!object(raw.serving)||raw.serving.owner!=='w8rld'||raw.serving.collectedDuringRequest!==false||!object(raw.catalog))throw Error('W8RLD catalog unavailable');
  const c=raw.catalog;
  if(c.game!=='limiteds'||c.sourceId!=='rolimons'||c.origin!=='provider'||c.valueUnit!=='Robux'||c.complete!==true||c.rejected!==0
    ||!Number.isSafeInteger(c.retrievedAt)||Number(c.retrievedAt)<=0||Number(c.retrievedAt)>now||!Array.isArray(c.rows)||!c.rows.length||c.rows.length>15000)throw Error('W8RLD catalog invalid');
  const retrievedAt=Number(c.retrievedAt),quotes=new Map<string,LimitedQuote>(),items:RolimonsItem[]=[];
  for(const r of c.rows){
    if(!object(r)||!text(r.id,16)||!/^\d+$/.test(r.id)||String(Number(r.id))!==r.id||!Number.isSafeInteger(Number(r.id))||Number(r.id)<=0||quotes.has(r.id)
      ||r.variant!=='Standard'||!text(r.name,256)||!amount(r.value)||!amount(r.rap)||(r.acronym!==undefined&&!text(r.acronym,64))
      ||(r.rare!==undefined&&typeof r.rare!=='boolean')||(r.observedAt!==null&&(!Number.isSafeInteger(r.observedAt)||Number(r.observedAt)<=0||Number(r.observedAt)>retrievedAt)))throw Error('W8RLD catalog row invalid');
    quotes.set(r.id,{assetId:r.id,name:r.name,...(r.acronym?{acronym:r.acronym as string}:{}),...(r.rap!==null?{rap:r.rap}:{}),...(r.value!==null?{estimatedValue:r.value}:{}),
      demand:'Unavailable',trend:'Unavailable',projected:'unknown',...(typeof r.rare==='boolean'?{rare:r.rare?'rare':'not-rare'}:{}),source:QUOTE_SOURCE,fetchedAt:retrievedAt,...(r.observedAt!==null?{observedAt:Number(r.observedAt)}:{})});
    items.push({id:r.id,name:r.name,acronym:typeof r.acronym==='string'?r.acronym:'',rap:r.rap??-1,value:r.value??-1,demand:-1,trend:-1,...(r.observedAt!==null?{observedAt:Number(r.observedAt)}:{})});
  }
  return {retrievedAt,quotes,items};
}
export function parseW8rldLimitedCatalogText(text:string,now=Date.now()):Map<string,LimitedQuote>{
  if(typeof text!=='string'||new TextEncoder().encode(text).length>W8RLD_DATA_MAX_BYTES)throw Error('W8RLD catalog budget');
  return parseW8rldLimitedCatalog(JSON.parse(text),now).quotes;
}
