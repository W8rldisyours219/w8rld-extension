// Shared source/artifact guard for the exact native authenticated GET readers.
// It grants no worker capability, manifest host, message route or caller URL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export function assertNativeTradeRead(file, text) {
  const avatar = /(?:^|[\\/])nativeAvatarRead\.ts$/.test(file);
  const content = /(?:^|[\\/])content\.js$/.test(file);
  const allowed = /(?:^|[\\/])nativeTradeRead\.ts$/.test(file);
  const uses = [...text.matchAll(/credentials\s*:\s*['"]include['"]/g)].length;
  assert.equal(uses,content ? 2 : allowed || avatar ? 1 : 0,`${file}: exact audited automatic-authentication calls`);
  if(avatar || content){
    const source=readFileSync('extensions/roblox-limited-trading/src/nativeAvatarRead.ts','utf8');
    assert.equal([...source.matchAll(/await fetcher\(/g)].length,1);
    assert.ok(text.includes('https://avatar.roblox.com/v1/avatar'));
    assert.ok(source.includes('binding(context())!==current')&&source.includes("url.origin==='https://www.roblox.com'")&&source.includes('context.editor'));
    assert.ok(source.includes('bytes>64*1024')&&source.includes('requests>=6')&&source.includes('version!==epoch'));
    assert.ok(!/storage|postMessage|sendMessage|addEventListener|setInterval/.test(source),'No avatar persistence, bridge or polling');
    assert.ok(/method:\s*['"]GET['"]/.test(text)&&/redirect:\s*['"]error['"]/.test(text));
  }
  if (!allowed && !content) return;
  for(const endpoint of ['https://trades.roblox.com/v1/trades/','https://trades.roblox.com/v2/trades/'])assert.ok(text.includes(endpoint),'Exact documented trade read endpoint');
  assert.ok(text.includes('https://inventory.roblox.com/v1/users/'),'Exact documented collectibles ownership endpoint');
  assert.ok(/method:\s*['"]GET['"]/.test(text));
  assert.ok(/redirect:\s*['"]error['"]/.test(text));
  assert.ok(!/chrome\.(?:cookies|scripting|webRequest|debugger)|\.ROBLOSECURITY|Authorization\s*:/.test(text));
  const source=readFileSync('extensions/roblox-limited-trading/src/nativeTradeRead.ts','utf8');
  assert.equal([...source.matchAll(/await fetcher\(/g)].length,1);
  assert.ok(source.includes("kind === 'detail' && !list?.entries.some(e => e.id === value)"),'Details must belong to admitted native list');
  assert.ok(source.includes('matchTradeRow(list.entries,partners,index,timestamps,dates,!list.cursor)') && source.includes('partners.some((id,i) => !id || id !== entries[i].partner)'), 'Whole ordered native prefix must match');
  assert.ok(source.includes('timestamp !== entry.created') && source.includes('e.partner === entry.partner && e.created === timestamp).length === 1'), 'Exact native timestamps must match uniquely');
  assert.ok(source.includes('return complete && dates?.length === partners.length')
    && source.includes('partners.every((_,i) => dates[i] === nativeDate(entries[i].created))')
    && source.includes('e.partner === entry.partner && nativeDate(e.created) === dates[index]).length === 1'), 'Calendar dates require complete pagination, independent prefix dates and a unique partner/day');
  assert.ok(!/storage|postMessage|sendMessage|addEventListener|setInterval/.test(source),'No persistence, bridge, polling or background trigger');
  assert.ok(source.includes("kind === 'legacy' && (!['Inbound','Outbound'].includes(current.tab) || !details.has(value))"),'Legacy copy detail must belong to an admitted pending trade');
  assert.ok(source.includes('details.get(detail.tradeId)?.value !== detail')&&source.includes('current.userId !== detail.mine'),'Ownership accepts only the current exact native admitted detail');
  assert.ok(source.includes("kind === 'inventory' && (!['Inbound','Outbound'].includes(current.tab)")&&source.includes('d.value.mine === value || d.value.theirs === value'),'Inventories must belong to the two admitted pending participants');
  assert.ok(source.includes('page<5')&&source.includes('coherent && complete')&&source.includes('checkedAt:started'),'Negative copy evidence requires coherent complete bounded fresh inventory');
}
