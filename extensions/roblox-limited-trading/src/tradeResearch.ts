/** Local research only. Shared valuation/core remains the arithmetic authority. */
import { type PricedTradeItem } from './core';
import { calculatorInput, savedComparison, validComparison, validSavedComparison, comparisonIdentity, valueWarning, type AnonymousComparison, type SavedComparison } from './tradeResearchCore';
import { parseLookupReply } from './protocol';
import { ownedRegion } from './presentation';
import { differenceNode, listMetrics, metricAmount } from './nativeUi';
import type { Preferences } from './preferences';
import { historicalTradeControls } from '../../../plugins/lib/historicalTradeView';

/** No provider read until the explicit Compare action. Text and offers stay in memory. */
export function tradeCalculator(extension: any, preferences: Preferences): { node: HTMLElement; dispose(): void } {
  const node = ownedRegion('Read-only trade calculator'); node.classList.add('w8rld-calculator');
  const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Trade calculator';
  details.append(summary); node.append(details);
  const inputs = (['Giving', 'Receiving'] as const).map(side => {
    const label = document.createElement('label'); label.textContent = side;
    const field = document.createElement('textarea'); field.rows = 2; field.maxLength = 500; field.placeholder = 'Asset ID × quantity, one per line'; field.setAttribute('aria-label', `${side} calculator assets`); label.append(field); details.append(label); return field;
  });
  const compare = document.createElement('button'); compare.type = 'button'; compare.textContent = 'Compare';
  const output = document.createElement('div'); output.setAttribute('role', 'status');
  const dated=historicalTradeControls(output,async(items)=>{
    const reply=await new Promise<any>((resolve,reject)=>{try{extension.runtime.sendMessage({type:'w8rld:research',action:'history',assetIds:[...new Set(items.map(i=>i.assetId))]},(r:any)=>extension.runtime.lastError||!r?.ok?reject(Error('History unavailable')):resolve(r));}catch{reject(Error('History unavailable'));}});
    return {observations:reply.observations,coverage:reply.coverage,names:reply.names};
  },()=>invalidate());
  details.append(dated.node);
  const note = document.createElement('small'); note.textContent = 'Limited items only · provider observations · no trade actions'; details.append(compare, note, output);
  let disposed = false; let serial = 0; let timeout: number | undefined; let expiry: number | undefined;
  let current: PricedTradeItem[] = [];
  let loadedId: string | undefined;
  const history = document.createElement('div');
  const send = (message: object): Promise<any> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Local history unavailable.')), 3000);
    try { extension.runtime.sendMessage(message, (r: any) => { clearTimeout(timer); const error = extension.runtime.lastError; if (error || !r?.ok) reject(Error('Local history unavailable.')); else resolve(r); }); } catch { clearTimeout(timer); reject(Error('Local history unavailable.')); }
  });
  function draw() {
    output.replaceChildren();
    const metrics = [...listMetrics(current, false, 'rap-value', preferences), ...listMetrics(current, false, 'rap-usd', preferences).filter(m=>m.key==='usd')];
    for (const metric of metrics) { const row = document.createElement('div'); row.append(document.createTextNode(`${metric.label}: Give ${metricAmount(metric, metric.give, preferences.compactNumbers)} → Receive ${metricAmount(metric, metric.receive, preferences.compactNumbers)} `), differenceNode(metric, preferences.compactNumbers)); row.title = `${metric.label}: Give ${metricAmount(metric, metric.give)} → Receive ${metricAmount(metric, metric.receive)}`; row.setAttribute('aria-label', row.title); output.append(row); }
    const warning = preferences.overpayWarnings && valueWarning(current, false, preferences.overpayThreshold);
    if (warning) { const text = document.createElement('p'); text.textContent = warning; text.className = 'w8rld-value-warning'; output.append(text); }
    if (preferences.savedComparisons) {
      const save = document.createElement('button'); save.type = 'button'; save.textContent = loadedId ? 'Update saved comparison' : 'Save comparison locally'; save.disabled = !savedComparison(current);
      save.addEventListener('click', () => { const record = savedComparison(current); if (!record) { save.disabled = true; return; }
        save.disabled = true; void send({ type: 'w8rld:comparison', action: loadedId ? 'update' : 'save', ...(loadedId ? {id:loadedId}:{}), record }).then(reply => { if (!disposed && save.isConnected) { loadedId=comparisonIdentity(record); save.textContent = reply.duplicate ? 'Already saved locally' : 'Saved locally'; showHistory(reply.records); } }).catch(() => { if (!disposed && save.isConnected) { save.textContent = 'Could not save; retry'; save.disabled = false; } });
      }); output.append(save);
    }
  }
  const invalidate = () => { serial++; dated.invalidate(); current = []; if (timeout !== undefined) clearTimeout(timeout); if (expiry !== undefined) clearTimeout(expiry); timeout = expiry = undefined; compare.disabled = false; output.replaceChildren(); };
  function showHistory(records: unknown) {
    if(disposed)return;
    history.replaceChildren(...(Array.isArray(records)?records.filter(r=>validComparison(r)||validSavedComparison(r)).slice(-20).reverse():[]).map((r:AnonymousComparison|SavedComparison)=>{
      const row=document.createElement('div');row.className='w8rld-saved-comparison';
      const caption=document.createElement('small');caption.textContent=`${new Date(r.time).toLocaleString()} · ${r.metrics.map(m=>`${m.name} ${m.give.toLocaleString()} → ${m.receive.toLocaleString()}`).join(' · ')} · historical observation`;row.append(caption);
      if(validSavedComparison(r)) {
        const identities=document.createElement('small');identities.textContent=r.items.map(i=>`${i.side==='give'?'Give':'Receive'} ${i.assetId} ×${i.quantity}`).join(' · ');row.append(identities);
        const provenance=document.createElement('small');provenance.textContent=`${r.observations.some(o=>o.rolimonsAt)?'RAP / curated Value: Rolimon’s. ':''}${r.observations.some(o=>o.routilityAt)?'$: Routility estimate. ':''}Refresh with Compare; saved amounts are not current quotes.`;row.append(provenance);
        const load=document.createElement('button');load.type='button';load.textContent='Load';load.addEventListener('click',()=>{invalidate();loadedId=comparisonIdentity(r);for(const [index,side]of ['give','receive'].entries())inputs[index].value=r.items.filter(i=>i.side===side).map(i=>`${i.assetId} ×${i.quantity}`).join('\n');output.textContent='Saved items loaded. Compare to fetch current observations.';inputs[0].focus();});
        const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';remove.addEventListener('click',()=>{remove.disabled=true;void send({type:'w8rld:comparison',action:'delete',id:comparisonIdentity(r)}).then(reply=>{if(disposed)return;if(loadedId===comparisonIdentity(r)){loadedId=undefined;invalidate();}showHistory(reply.records);}).catch(()=>{if(!disposed&&remove.isConnected){remove.disabled=false;caption.textContent='Could not delete; retry.';}});});row.append(load,remove);
      }
      return row;
    }));if(!history.childNodes.length)history.textContent='No saved comparisons.';
  }
  for (const input of inputs) input.addEventListener('input', invalidate);
  compare.addEventListener('click', () => {
    invalidate(); const items = calculatorInput(inputs[0].value, inputs[1].value);
    if (!items) { output.textContent = 'Enter up to eight canonical asset IDs per side, with optional × quantity (1–1000).'; return; }
    if(dated.date.value){void dated.compare(items);return;}
    const ids = [...new Set(items.map(i => i.assetId))]; const request = ++serial; compare.disabled = true; output.textContent = 'Loading current observations…';
    timeout = window.setTimeout(() => { timeout = undefined; if (!disposed && serial === request) { serial++; compare.disabled = false; output.textContent = 'Provider unavailable. Compare again to retry.'; } }, 10000);
    try { extension.runtime.sendMessage({ type: 'w8rld:limited-lookup', assetIds: ids }, (raw: unknown) => {
      const error = extension.runtime.lastError; if (disposed || serial !== request || !node.isConnected) return;
      if (timeout !== undefined) clearTimeout(timeout); timeout = undefined; compare.disabled = false;
      const reply = !error && parseLookupReply(raw, ids);
      if (!reply || !reply.ok) { output.textContent = 'Provider unavailable. Compare again to retry.'; return; }
      current = items.map(i => ({ ...i, quote: reply.quotes.find(q => q.assetId === i.assetId), usdQuote: reply.usdQuotes?.find(q => q.assetId === i.assetId),demandQuote:reply.demandQuotes?.find(q=>q.assetId===i.assetId) })); draw();
      const earliest = Math.min(...current.flatMap(i => [i.quote?.fetchedAt, i.usdQuote?.retrievedAt,i.demandQuote?.retrievedAt].filter((t): t is number => !!t)));
      if (Number.isFinite(earliest)) expiry = window.setTimeout(() => { expiry = undefined; if (!disposed) { current = []; serial++; output.textContent = 'Observations expired. Compare again for current data.'; } }, Math.max(1, earliest + 15 * 60000 - Date.now()));
    }); } catch { invalidate(); output.textContent = 'Provider unavailable.'; }
  });
  if (preferences.savedComparisons) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Show saved comparisons';
    button.addEventListener('click', () => { void send({ type: 'w8rld:comparison', action: 'list' }).then(reply => {
      showHistory(reply.records);
    }).catch(() => { if (!disposed) history.textContent = 'Local history unavailable.'; }); }); details.append(button, history);
  }
  return { node, dispose() { disposed = true; invalidate(); dated.dispose(); node.remove(); } };
}
