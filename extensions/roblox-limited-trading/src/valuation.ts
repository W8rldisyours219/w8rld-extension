/** Presentation policy only: never fill or mutate missing provider observations. */
import {QUOTE_FRESH_MS,type PricedTradeItem,type TradeSide} from './core';
import type {Preferences} from './preferences';
export const quoteFor=(item:PricedTradeItem,now=Date.now())=>item.quote?.assetId===item.assetId
  && item.quote.fetchedAt<=now && now-item.quote.fetchedAt<QUOTE_FRESH_MS ? item.quote : undefined;
export function displayValue(item:PricedTradeItem,preferences?:Pick<Preferences,'valueFallback'>){
  const q=quoteFor(item);
  if(q?.estimatedValue!==undefined)return {value:q.estimatedValue,method:'curated' as const};
  if(preferences?.valueFallback==='rap'&&q?.rap!==undefined)return {value:q.rap,method:'rap' as const};
  return {value:undefined,method:'unavailable' as const};
}
export function displayValueTrade(items:readonly PricedTradeItem[],incomplete=false,preferences?:Pick<Preferences,'valueFallback'>){
  const side=(kind:TradeSide)=>{
    let value=0,covered=0,total=0,curatedCovered=0,rapCovered=0;
    for(const item of items.filter(i=>i.side===kind)){
      total+=item.quantity;const price=displayValue(item,preferences);if(price.value===undefined)continue;
      value+=price.value*item.quantity;covered+=item.quantity;
      if(price.method==='curated')curatedCovered+=item.quantity;else rapCovered+=item.quantity;
    }
    return {value,covered,total,curatedCovered,rapCovered};
  };
  const give=side('give'),receive=side('receive');
  const complete=!incomplete&&give.total>0&&receive.total>0&&give.covered===give.total&&receive.covered===receive.total;
  const difference=complete?receive.value-give.value:undefined;
  const fallback=give.rapCovered+receive.rapCovered>0;
  return {give,receive,difference,percent:difference!==undefined&&give.value>0?difference/give.value*100:undefined,
    label:fallback?'Estimated':'Value',description:fallback?'Curated Value where available; RAP fallback for missing Value. RAP is an estimate, not curated Value.':"Rolimon's curated Value. Missing observations remain unavailable."};
}
/** Explicit W8RLD mapping of Rolimon's qualitative categories, not an official score. */
export function demandScore(label:string|undefined):number|undefined {
  return ({Terrible:1,Low:2,Normal:3,High:4,Amazing:5} as Record<string,number>)[label??''];
}
export function demandText(label:string|undefined):string {
  const score=demandScore(label);return score===undefined?'N/A':`${score}/5 · ${score===1?'Very Low':label}`;
}
export function itemDemand(item:PricedTradeItem):string|undefined {
  const label=quoteFor(item)?.demand;if(demandScore(label)!==undefined)return label;
  const q=item.demandQuote;
  return q?.assetId===item.assetId&&q.provider==='routility'&&q.unit==='ITEM_DEMAND'&&q.availability==='available'&&q.validation==='validated'
    &&q.freshness==='fresh'&&q.retrievedAt<=Date.now()&&Date.now()-q.retrievedAt<QUOTE_FRESH_MS&&demandScore(q.value)!==undefined?q.value:undefined;
}
export function weightedTradeDemand(items:readonly PricedTradeItem[],incomplete=false,preferences?:Pick<Preferences,'valueFallback'>){
  const side=(kind:TradeSide)=>{
    let weighted=0,weight=0,covered=0,total=0;
    for(const item of items.filter(i=>i.side===kind)){
      total+=item.quantity;const demand=demandScore(itemDemand(item)),price=displayValue(item,preferences).value;
      if(demand===undefined||price===undefined||price<=0)continue;
      const itemWeight=price*item.quantity;weight+=itemWeight;weighted+=demand*itemWeight;covered+=item.quantity;
    }
    const score=weight>0?weighted/weight:undefined;
    return {score,weight,covered,total,partial:incomplete||covered<total,
      value:score===undefined?'N/A':`${score.toFixed(2)}/5`,detail:`${covered}/${total} copies with demand and positive Robux weight.`};
  };
  const give=side('give'),receive=side('receive');
  return {give,receive,difference:give.score!==undefined&&receive.score!==undefined?receive.score-give.score:undefined};
}
