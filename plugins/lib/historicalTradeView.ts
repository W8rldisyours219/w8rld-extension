/** Small shared date/result view. Adapters supply exact identities and observations. */
import { historicalCutoff, historicalPolicy, historicalTrade, type HistoricalItem, type HistoricalObservation } from './historicalTrade';
export function historicalTradeControls(output: HTMLElement, load: (items: HistoricalItem[]) => Promise<{observations: HistoricalObservation[]; coverage: string; names?:Record<string,string>}>, changed: () => void) {
  const node=document.createElement('div');node.className='w8rld-history-controls w8rld-fields';
  const label=document.createElement('label');label.textContent='Valuation date (UTC)';
  const date=document.createElement('input');date.type='date';date.className='w8rld-input';date.setAttribute('aria-label','Historical valuation date (UTC)');date.max=new Date().toISOString().slice(0,10);label.append(date);
  const current=document.createElement('button');current.type='button';current.className='w8rld-btn w8rld-btn-secondary';current.textContent='Use current values';
  const policy=document.createElement('small');policy.className='w8rld-desc';policy.textContent=historicalPolicy;
  node.append(label,current,policy);
  let serial=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const invalidate=()=>{serial++;if(timer!==undefined)clearTimeout(timer);timer=undefined;};
  const change=()=>{invalidate();output.replaceChildren();changed();};
  date.addEventListener('change',change);current.addEventListener('click',()=>{date.value='';change();});
  async function compare(items: HistoricalItem[]): Promise<void> {
    invalidate();const request=serial,cutoff=historicalCutoff(date.value);
    if(cutoff===undefined){output.textContent='Choose a valid UTC date on or before today.';return;}
    output.textContent='Loading historical observations…';
    timer=setTimeout(()=>{if(serial===request&&!disposed){serial++;output.textContent='Historical source timed out. Calculate again to retry.';}},20000);
    try {
      const result=await load(items);
      if(disposed||serial!==request||!output.isConnected)return;
      if(timer!==undefined)clearTimeout(timer);timer=undefined;
      const trade=historicalTrade(items,result.observations,cutoff);output.replaceChildren();
      const line=(text:string)=>{const p=document.createElement('p');p.textContent=text;output.append(p);};
      line(`Historical comparison · cutoff ${new Date(cutoff).toISOString()}`);line(result.coverage);
      for(const side of ['give','receive'] as const){
        line(side==='give'?'YOU GIVE':'YOU RECEIVE');
        for(const row of trade.rows.filter(r=>r.side===side)){
          line(`${result.names?.[row.assetId]??row.name} (${row.assetId}) ×${row.quantity}`);
          for(const key of ['value','rap'] as const){const m=row[key];line(`${key==='value'?'Value':'RAP'}: ${m?`${m.amount.toLocaleString('en-US')} Robux · ${new Date(m.at).toISOString()} · ${m.source}`:'Unavailable at cutoff'}`);}
        }
      }
      for(const m of trade.metrics){
        const total=(s:typeof m.give)=>`${s.complete?'Total':'Incomplete subtotal'} ${Number.isSafeInteger(s.total)?s.total.toLocaleString('en-US'):'Unavailable (overflow)'} Robux (${s.covered}/${s.copies} copies)`;
        line(`${m.key==='value'?'Value':'RAP'} · Giving ${total(m.give)} → Receiving ${total(m.receive)}`);
        line(m.difference===undefined?'Difference unavailable: both sides need complete coverage.':`Receiving − Giving: ${m.difference>=0?'+':''}${m.difference.toLocaleString('en-US')} Robux · ${m.percent===undefined?'Percentage unavailable (Giving is zero)':`${m.percent>=0?'+':''}${m.percent.toFixed(2)}% of Giving`}`);
      }
    }catch{if(!disposed&&serial===request){output.textContent='Historical source unavailable. No current values were substituted.';}}
    finally{if(serial===request&&timer!==undefined){clearTimeout(timer);timer=undefined;}}
  }
  return {node,date,compare,invalidate,dispose(){disposed=true;invalidate();node.remove();}};
}
