/** Options-owned routes: no fake Roblox path, page network or account action. */
import { tradeCalculator } from './tradeResearch';
import { parsePreferences } from './preferences';
import { QUOTE_FRESH_MS } from './core';
import { validDealFilters, type Deal, type DealFilters } from './deals';
export function researchRequest(extension:any,message:object):Promise<any>{
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Provider unavailable')),20000);try{extension.runtime.sendMessage({type:'w8rld:research',...message},(r:any)=>{clearTimeout(timer);extension.runtime.lastError||!r?.ok?reject(Error('Provider unavailable')):resolve(r);});}catch{clearTimeout(timer);reject(Error('Provider unavailable'));}});
}
export function dealsView(extension:any){
  const node=document.createElement('section');node.className='w8rld-deals';
  const heading=document.createElement('h1');heading.textContent='Limited Deals';
  const intro=document.createElement('p');intro.textContent='Filter provider catalog best asks by budget and discount. Confirm the current price on Roblox before buying.';
  const filters=document.createElement('form');filters.className='w8rld-deal-filters';
  const input=(text:string,value:string)=>{const label=document.createElement('label');label.textContent=text;const field=document.createElement('input');field.type='number';field.value=value;label.append(field);filters.append(label);return field;};
  const select=(text:string,options:[string,string][])=>{const label=document.createElement('label');label.textContent=text;const field=document.createElement('select');for(const [value,title]of options){const o=document.createElement('option');o.value=value;o.textContent=title;field.append(o);}label.append(field);filters.append(label);return field;};
  const max=input('Max price (Robux)','10000');max.min='1';max.step='1';max.max=String(Number.MAX_SAFE_INTEGER);
  const discount=input('Min discount (%)','0');discount.min='0';discount.max='100';discount.step='0.1';
  const basis=select('Discount reference',[['value','Rolimon’s curated Value'],['rap','Rolimon’s RAP']]);
  const sort=select('Sort by',[['price','Listing price · low to high'],['discount','Discount · high to low'],['reference','Selected reference · high to low']]);
  const projection=select('Projection status',[['all','All · label unknown'],['exclude-known','Hide projected · keep unknown'],['known-clear','Known non-projected only']]);
  const refresh=document.createElement('button');refresh.type='submit';refresh.textContent='Browse / refresh';filters.append(refresh);
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.tabIndex=-1;status.textContent='Choose your filters, then browse. One provider best ask per item; no background polling.';
  const coverage=document.createElement('p');coverage.className='w8rld-deal-coverage';
  const cards=document.createElement('div');cards.className='w8rld-deal-grid';
  const pages=document.createElement('div');pages.className='w8rld-research-nav';
  const previous=document.createElement('button'),next=document.createElement('button');previous.type=next.type='button';previous.textContent='Previous page';next.textContent='Next page';previous.disabled=next.disabled=true;pages.append(previous,next);
  node.append(heading,intro,filters,status,coverage,cards,pages);
  let serial=0,offset=0,disposed=false,expiry:ReturnType<typeof setTimeout>|undefined;
  const choices=():DealFilters=>({maxPrice:max.value.trim()?Number(max.value):NaN,minDiscount:discount.value.trim()?Number(discount.value):NaN,basis:basis.value as DealFilters['basis'],sort:sort.value as DealFilters['sort'],projection:projection.value as DealFilters['projection'],offset});
  function invalidate(){serial++;if(expiry!==undefined)clearTimeout(expiry);expiry=undefined;cards.replaceChildren();coverage.textContent='';previous.disabled=next.disabled=true;refresh.disabled=false;}
  function draw(row:Deal,version:number,f:DealFilters){
    const card=document.createElement('article');card.className='w8rld-deal-card';
    const thumb=document.createElement('div');thumb.className='w8rld-deal-thumb';thumb.textContent='Image unavailable';
    if(row.thumbnailUrl){const img=document.createElement('img');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=row.thumbnailUrl;img.addEventListener('load',()=>thumb.replaceChildren(img),{once:true});img.addEventListener('error',()=>{thumb.textContent='Image unavailable';},{once:true});thumb.append(img);}
    const title=document.createElement('h2');title.textContent=row.name;
    const text=(value:string,cls?:string)=>{const p=document.createElement('p');p.textContent=value;if(cls)p.className=cls;card.append(p);};
    card.append(thumb,title);text(`${row.price.toLocaleString('en-US')} Robux`,'w8rld-deal-price');
    text(`Value ${row.value===undefined?'Unavailable':row.value.toLocaleString('en-US')} · RAP ${row.rap===undefined?'Unavailable':row.rap.toLocaleString('en-US')} Robux`);
    text(row.discount===undefined?'Discount unavailable':`${row.discount.toFixed(2)}% below ${f.basis==='value'?'curated Value':'RAP'}`);
    text(`Projection: ${row.projected==='unknown'?'Unknown':row.projected==='projected'?'Projected':'Known non-projected'}`);
    text(row.fresh?'Fresh retrieval':'Stale · not actionable');
    const evidence=document.createElement('details');evidence.className='w8rld-deal-evidence';const summary=document.createElement('summary');summary.textContent='Sources & timestamps';evidence.append(summary);
    for(const value of [`Ask retrieved ${new Date(row.priceAt).toISOString()}`,`Reference retrieved ${row.referenceAt?new Date(row.referenceAt).toISOString():'Unavailable'}`,'Ask / thumbnail: Routility · Value / RAP / projection: Rolimon’s','Discount = (reference − ask) / reference']){const p=document.createElement('p');p.textContent=value;evidence.append(p);}card.append(evidence);
    const action=document.createElement('button');action.type='button';action.textContent='Recheck before opening Roblox';action.disabled=!row.fresh;
    action.addEventListener('click',()=>{if(action.disabled||action.getAttribute('aria-disabled')==='true')return;action.setAttribute('aria-busy','true');action.setAttribute('aria-disabled','true');action.textContent='Rechecking…';void researchRequest(extension,{action:'recheck',assetId:row.assetId,filters:f}).then(reply=>{
      if(disposed||serial!==version||!action.isConnected)return;
      action.removeAttribute('aria-busy');action.removeAttribute('aria-disabled');
      const current:Deal|undefined=reply.row;
      if(!current?.fresh||Date.now()-current.priceAt>=QUOTE_FRESH_MS||Date.now()-(current.referenceAt??0)>=QUOTE_FRESH_MS){action.setAttribute('aria-disabled','true');action.textContent='Unavailable, stale or outside these filters. Refresh.';return;}
      const link=document.createElement('a');link.href=`https://www.roblox.com/catalog/${row.assetId}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`Open Roblox item · observed ${current.price.toLocaleString('en-US')} Robux`;
      link.addEventListener('click',e=>{if(Date.now()-Math.min(current.priceAt,current.referenceAt??0)>=QUOTE_FRESH_MS){e.preventDefault();link.removeAttribute('href');link.textContent='Retrieval expired. Refresh before opening.';}});const focused=action.ownerDocument.activeElement===action;action.replaceWith(link);if(focused)link.focus();
    }).catch(()=>{if(!disposed&&serial===version){action.removeAttribute('aria-busy');action.removeAttribute('aria-disabled');action.disabled=false;action.textContent='Recheck unavailable · retry';}});});
    card.append(action);return card;
  }
  async function load(page:number){
    const pageFocused=node.ownerDocument.activeElement===previous||node.ownerDocument.activeElement===next;
    if(pageFocused)status.focus();
    invalidate();offset=page;const f=choices();if(!validDealFilters(f)){status.textContent='Enter a positive whole Robux limit and a discount from 0 to 100.';return;}
    const version=serial;refresh.disabled=true;status.textContent='Loading catalog best asks…';
    try{const result=await researchRequest(extension,{action:'deals',filters:f});if(disposed||serial!==version)return;
      cards.replaceChildren(...result.rows.map((r:Deal)=>draw(r,version,f)));coverage.textContent=result.coverage;
      const state=result.states.asks!=='fresh'||result.states.references!=='fresh';
      status.textContent=`${state?'Partial / stale or unavailable provider coverage. ':''}${result.total?`Showing ${offset+1}–${offset+result.rows.length} of ${result.total} matching catalog items.`:'No matching catalog asks. Try a wider price or projection filter; this is not full-market coverage.'}${result.retryAt>Date.now()?` Rate limited / cooldown until ${new Date(result.retryAt).toISOString()}.`:''}`;
      previous.disabled=offset===0;next.disabled=!result.more;
      const earliest=Math.min(...result.rows.map((r:Deal)=>Math.min(r.priceAt,r.referenceAt??r.priceAt)));
      if(Number.isFinite(earliest)&&earliest+QUOTE_FRESH_MS>Date.now())expiry=setTimeout(()=>{if(disposed||serial!==version)return;for(const a of cards.querySelectorAll('a'))a.removeAttribute('href');for(const b of cards.querySelectorAll('button'))b.disabled=true;status.textContent='Retrieval expired. Refresh to recheck prices and filters.';},Math.max(1,earliest+QUOTE_FRESH_MS-Date.now()));
    }catch{if(serial===version&&!disposed)status.textContent='Catalog unavailable or W8RLD disabled. Refresh to retry. No listings can be opened from this result.';}
    finally{if(serial===version&&!disposed)refresh.disabled=false;}
  }
  filters.addEventListener('submit',e=>{e.preventDefault();void load(0);});
  filters.addEventListener('input',()=>{invalidate();offset=0;status.textContent='Filters changed. Browse again to calculate matching deals.';});
  previous.addEventListener('click',()=>void load(Math.max(0,offset-40)));next.addEventListener('click',()=>void load(offset+40));
  return {node,dispose(){disposed=true;invalidate();node.remove();}};
}
export function mountResearchRoutes(extension:any){
  const root=document.querySelector<HTMLElement>('#research'),settings=document.querySelector<HTMLElement>('#settings-body');if(!root||!settings)return()=>{};
  let active:{node:HTMLElement;dispose():void}|undefined,version=0;
  const route=()=>{const request=++version;active?.dispose();active=undefined;root.replaceChildren();const hash=location.hash;
    const current=hash==='#deals'||hash==='#calculator'?hash:'#settings';
    for(const link of document.querySelectorAll<HTMLAnchorElement>('.w8rld-research-nav a')){if(link.getAttribute('href')===current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
    settings.hidden=hash==='#deals'||hash==='#calculator';root.hidden=!settings.hidden;
    document.querySelector('main')?.classList.toggle('w8rld-research-wide',settings.hidden);
    if(hash==='#deals')active=dealsView(extension);
    else if(hash==='#calculator'){
      root.textContent='Loading calculator preferences…';
      try{extension.runtime.sendMessage({type:'w8rld:settings',action:'get'},(reply:any)=>{
        if(version!==request)return;
        if(extension.runtime.lastError||!reply?.ok){root.textContent='Calculator preferences unavailable. Return to Settings and retry.';return;}
        const preferences=parsePreferences(reply.preferences);
        active=tradeCalculator(extension,{...preferences,savedComparisons:preferences.tradeCalculator&&preferences.savedComparisons});
        const d=active.node.querySelector('details');if(d)d.open=true;const title=document.createElement('h1');title.textContent='Trade calculator';root.replaceChildren(title,active.node);
      });}catch{root.textContent='Calculator preferences unavailable. Return to Settings and retry.';}
    }
    if(active)root.append(active.node);
  };
  const changed=(_changes:Record<string,unknown>,area:string)=>{if(area==='sync'&&'enabled' in _changes)route();};
  route();window.addEventListener('hashchange',route);extension.storage.onChanged.addListener(changed);
  return()=>{version++;window.removeEventListener('hashchange',route);extension.storage.onChanged.removeListener(changed);active?.dispose();};
}
