/** Credentialless public facts, separate from Limited valuation. No account store. */
import { safeAssetId } from './core';
import {parsePreferences, PREFERENCE_KEY} from './preferences';
export type PublicFactKind = 'profile' | 'community' | 'experience';
export interface PublicFact { label: string; value: string; }
export interface PublicFactReply { ok: true; kind: PublicFactKind; entityId: string; retrievedAt: number; rows: PublicFact[]; partial: boolean; }
export const PUBLIC_FACT_ORIGINS = {
  profile: ['https://friends.roblox.com/*', 'https://users.roblox.com/*'],
  community: ['https://groups.roblox.com/*'],
  experience: ['https://games.roblox.com/*'],
} as const;
export const PUBLIC_FACT_BUDGET_KEY = 'w8rld:public-facts:budgets:v1';
const labels = ['Followers', 'Following', 'Friends', 'Joined', 'Members', 'Created', 'Description', 'Visits', 'Players', 'Updated', 'Avatar type'];
const exact = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n.toLocaleString('en-US') : undefined;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 && Date.parse(value) <= Date.now() ? new Date(value).toISOString() : undefined;
export function publicFactRequests(kind: PublicFactKind, id: string): string[] {
  if (safeAssetId(id) !== id) return [];
  return kind === 'profile' ? [
    `https://friends.roblox.com/v1/users/${id}/followers/count`, `https://friends.roblox.com/v1/users/${id}/followings/count`,
    `https://friends.roblox.com/v1/users/${id}/friends/count`, `https://users.roblox.com/v1/users/${id}`,
  ] : kind === 'community' ? [`https://groups.roblox.com/v1/groups/${id}`, `https://groups.roblox.com/v2/groups?groupIds=${id}`]
    : kind === 'experience' ? [`https://games.roblox.com/v1/games?universeIds=${id}`] : [];
}
export function projectPublicFacts(kind: PublicFactKind, id: string, payloads: unknown[], now = Date.now()): PublicFactReply {
  const rows: PublicFact[] = []; const add = (label: string, value: string | undefined) => { if (value !== undefined) rows.push({ label, value }); };
  const data = payloads as any[];
  if (kind === 'profile') {
    ['Followers', 'Following', 'Friends'].forEach((label, i) => add(label, exact(data[i]?.count)));
    if (String(data[3]?.id) === id) add('Joined', date(data[3]?.created));
  } else if (kind === 'community') {
    if (String(data[0]?.id) === id) {
      add('Members', exact(data[0]?.memberCount));
      const description = data[0]?.description;
      if (typeof description === 'string' && description.trim() && description.length <= 16000) add('Description', description.trim());
    }
    if (Array.isArray(data[1]?.data) && data[1].data.length === 1 && String(data[1].data[0]?.id) === id) add('Created', date(data[1].data[0].created));
  } else if (kind === 'experience' && Array.isArray(data[0]?.data) && data[0].data.length === 1 && String(data[0].data[0]?.id) === id) {
    const game = data[0].data[0]; add('Visits', exact(game.visits)); add('Players', exact(game.playing)); add('Updated', date(game.updated)); add('Created', date(game.created));
    const type = ({ MorphToR6: 'R6', MorphToR15: 'R15', PlayerChoice: 'Player choice' } as Record<string, string>)[game.universeAvatarType]; add('Avatar type', type);
  }
  return { ok: true, kind, entityId: id, retrievedAt: now, rows, partial: rows.length < (kind === 'profile' ? 4 : kind === 'community' ? 3 : 5) };
}
export function parsePublicFactReply(raw: unknown, kind: PublicFactKind, id: string): PublicFactReply | undefined {
  const r = raw as PublicFactReply;
  if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['ok', 'kind', 'entityId', 'retrievedAt', 'rows', 'partial'].includes(k))
    || r.ok !== true || r.kind !== kind || r.entityId !== id || !Number.isSafeInteger(r.retrievedAt) || r.retrievedAt <= 0 || r.retrievedAt > Date.now()
    || Date.now() - r.retrievedAt >= 5 * 60000 || typeof r.partial !== 'boolean' || !Array.isArray(r.rows) || r.rows.length > 11) return;
  const seen = new Set<string>();
  for (const row of r.rows) {
    if (!row || Object.keys(row).length !== 2 || !labels.includes(row.label) || seen.has(row.label) || typeof row.value !== 'string'
      || !row.value.trim() || row.value.length > (row.label === 'Description' ? 16000 : 100)) return;
    const allowed = kind === 'profile' ? ['Followers', 'Following', 'Friends', 'Joined'] : kind === 'community' ? ['Members', 'Created', 'Description'] : ['Visits', 'Players', 'Updated', 'Created', 'Avatar type'];
    if (!allowed.includes(row.label)) return;
    if (['Followers', 'Following', 'Friends', 'Members', 'Visits', 'Players'].includes(row.label)
      && (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(row.value) || !Number.isSafeInteger(Number(row.value.replace(/,/g, ''))))) return;
    if (['Joined', 'Created', 'Updated'].includes(row.label) && date(row.value) !== row.value) return;
    if (row.label === 'Avatar type' && !['R6', 'R15', 'Player choice'].includes(row.value)) return;
    seen.add(row.label);
  }
  return r;
}

/** Restart-safe global operation budgets store timestamps only, never entity IDs.
 * Factual responses live in bounded worker memory for five minutes. No polling. */
export function createPublicFactService(extension: any, transport: (url: string, signal?: AbortSignal) => Promise<unknown>, invalidate?: () => void) {
  const cache = new Map<string, PublicFactReply>(); const flights = new Map<string, Promise<PublicFactReply | undefined>>();
  const controllers = new Set<AbortController>();
  let generation = 0;
  let lock = Promise.resolve();
  const reserve = (kind: PublicFactKind) => {
    const task = lock.then(async () => {
      const data = (await extension.storage.local.get(PUBLIC_FACT_BUDGET_KEY))[PUBLIC_FACT_BUDGET_KEY];
      if (data !== undefined && (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['profile', 'community', 'experience'].includes(k))
        || Object.values(data).some(n => !Number.isSafeInteger(n) || Number(n) < 0))) return false;
      if (data?.[kind] > Date.now()) return false;
      await extension.storage.local.set({ [PUBLIC_FACT_BUDGET_KEY]: { ...data, [kind]: Date.now() + 60000 } }); return true;
    }); lock = task.then(() => {}, () => {}); return task;
  };
  const lookup = async (kind: PublicFactKind, id: string) => {
    // Capture before storage/permission awaits: disable/revocation also owns
    // work that has not reached its network controller yet.
    const version = generation;
    if (extension.storage.sync && (await extension.storage.sync.get({ enabled: true })).enabled === false) return;
    if (!publicFactRequests(kind, id).length || !await extension.permissions?.contains({ origins: [...PUBLIC_FACT_ORIGINS[kind]] })) return;
    if (version !== generation) return;
    const key = `${kind}:${id}`; const previous = cache.get(key);
    if (previous && Date.now() - previous.retrievedAt < 5 * 60000) return previous;
    if (flights.has(key)) return flights.get(key);
    const controller = new AbortController(); controllers.add(controller);
    const operation = (async () => {
      if (!await reserve(kind)) return;
      if (version !== generation || !await extension.permissions?.contains({ origins: [...PUBLIC_FACT_ORIGINS[kind]] })) return;
      if (version !== generation) return;
      const results = await Promise.allSettled(publicFactRequests(kind, id).map(url => transport(url, controller.signal)));
      const retryAt = Math.max(0, ...results.map(r => r.status === 'rejected' && Number.isSafeInteger(r.reason?.retryAt) ? r.reason.retryAt : 0));
      if (retryAt > Date.now()) {
        const task = lock.then(async () => { const current = (await extension.storage.local.get(PUBLIC_FACT_BUDGET_KEY))[PUBLIC_FACT_BUDGET_KEY];
          await extension.storage.local.set({ [PUBLIC_FACT_BUDGET_KEY]: { ...current, [kind]: Math.max(current?.[kind] ?? 0, retryAt) } }); });
        lock = task.then(() => {}, () => {}); await task;
      }
      if (version !== generation || !await extension.permissions?.contains({ origins: [...PUBLIC_FACT_ORIGINS[kind]] })) return;
      if (version !== generation) return;
      const reply = projectPublicFacts(kind, id, results.map(r => r.status === 'fulfilled' ? r.value : undefined));
      if (cache.size >= 32) cache.delete(cache.keys().next().value!); cache.set(key, reply); return reply;
    })().finally(() => { controllers.delete(controller); if (flights.get(key) === operation) flights.delete(key); }); flights.set(key, operation); return operation;
  };
  const cancel = () => { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); flights.clear(); invalidate?.(); };
  return Object.assign(lookup, { cancel, clear() { cancel(); cache.clear(); } });
}

/*! RoUtility communities.js::findMember (MIT), Copyright (c) 2026 RoUtility,
 * 403c75ed81f297e82ada6fccf084ae3fc2249def. Exact public roles GET retained;
 * username POST replaced with the already reviewed anonymous search GET.
 * No member crawl, authentication, thumbnails request or persisted identities. */
export const MEMBER_ORIGINS = ['https://users.roblox.com/*','https://groups.roblox.com/*','https://apis.roblox.com/*'];
export const MEMBER_BUDGET_KEY = 'w8rld:public-member-budget:v1';
export type MemberReply = {ok:true;groupId:string;query:string;retrievedAt:number;user?:{id:string;name:string;displayName:string;role?:{name:string;rank:number}}};
export function memberQuery(raw: unknown): string | undefined {
  if(typeof raw!=='string')return;
  const q=raw.trim().replace(/^@/,'');
  return safeAssetId(q)===q || /^[A-Za-z0-9_]{3,20}$/.test(q)&&!/^\d+$/.test(q) ? q : undefined;
}
const memberText=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
export function parseMemberReply(raw:unknown,groupId:string,query:string):MemberReply|undefined {
  const r=raw as MemberReply;
  if(!r||r.ok!==true||r.groupId!==groupId||r.query!==query||Object.keys(r).some(k=>!['ok','groupId','query','retrievedAt','user'].includes(k))
    ||!Number.isSafeInteger(r.retrievedAt)||r.retrievedAt<=0||r.retrievedAt>Date.now()||Date.now()-r.retrievedAt>=60000)return;
  const u=r.user;if(u&&(Object.keys(u).some(k=>!['id','name','displayName','role'].includes(k))||safeAssetId(u.id)!==u.id||!memberText(u.name,20)||!memberText(u.displayName,100)
    ||(safeAssetId(query)===query?u.id!==query:u.name.toLowerCase()!==query.toLowerCase())
    ||u.role&&(Object.keys(u.role).sort().join()!=='name,rank'||!memberText(u.role.name,100)||!Number.isInteger(u.role.rank)||u.role.rank<0||u.role.rank>255)))return;
  return r;
}
export function createCommunityMemberService(extension:any,read:(url:string,signal?:AbortSignal)=>Promise<unknown>) {
  let revision=0;let lock=Promise.resolve();let preflights=0;
  const active=new Map<number,AbortController>(),cache=new Map<string,MemberReply>();
  const cancel=(tab?:number)=>{if(tab===undefined){revision++;for(const c of active.values())c.abort();active.clear();}else{active.get(tab)?.abort();active.delete(tab);}};
  const allowed=async()=> (await extension.storage.sync.get({enabled:true})).enabled!==false
    &&parsePreferences((await extension.storage.local.get(PREFERENCE_KEY))[PREFERENCE_KEY]).communitySearch
    &&!parsePreferences((await extension.storage.local.get(PREFERENCE_KEY))[PREFERENCE_KEY]).privacyMode
    &&await extension.permissions?.contains({origins:MEMBER_ORIGINS});
  const lookup=async(groupId:string,raw:string,tab:number):Promise<MemberReply|undefined>=>{
    const query=memberQuery(raw);if(!query||safeAssetId(groupId)!==groupId||!Number.isSafeInteger(tab)||tab<0||preflights>=4)return;
    const version=revision;cancel(tab);const controller=new AbortController();active.set(tab,controller);preflights++;
    const current=()=>version===revision&&!controller.signal.aborted&&active.get(tab)===controller;
    try{
      if(!await allowed()||!current())return;
      const key=groupId+'\0'+query.toLowerCase(),hit=cache.get(key);if(hit&&Date.now()-hit.retrievedAt<60000)return {...hit,query};
      let reserved=false;const reservation=lock.then(async()=>{if(!current())return;const next=(await extension.storage.local.get(MEMBER_BUDGET_KEY))[MEMBER_BUDGET_KEY];
        if(next!==undefined&&(!Number.isSafeInteger(next)||next<0)||next>Date.now())return;
        await extension.storage.local.set({[MEMBER_BUDGET_KEY]:Date.now()+2000});reserved=true;});lock=reservation.catch(()=>{});await reservation;
      if(!reserved||!current()||!await allowed()||!current())return;
      let id=safeAssetId(query);
      if(!id){
        const session=crypto.randomUUID();const response:any=await read(`https://apis.roblox.com/search-api/omni-search?verticalType=user&searchQuery=${encodeURIComponent(query)}&pageToken=&globalSessionId=${session}&sessionId=${session}`,controller.signal);
        if(!current()||!Array.isArray(response?.searchResults)||response.searchResults.length>100)return;
        const users=response.searchResults.filter((g:any)=>g?.contentGroupType==='User');
        if(users.length!==1||!Array.isArray(users[0].contents)||users[0].contents.length>100)return;
        const matches=users[0].contents.filter((u:any)=>typeof u?.username==='string'&&u.username.toLowerCase()===query.toLowerCase());
        if(matches.length>1)return;
        if(!matches.length)return await allowed()&&current()?{ok:true,groupId,query,retrievedAt:Date.now()}:undefined;
        const value=matches[0].contentId;id=safeAssetId(typeof value==='number'&&Number.isSafeInteger(value)?String(value):value);if(!id)return;
      }
      const user:any=await read(`https://users.roblox.com/v1/users/${id}`,controller.signal);
      if(!current()||String(user?.id)!==id||!memberText(user?.name,20)||!memberText(user?.displayName,100)
        ||safeAssetId(query)!==query&&user.name.toLowerCase()!==query.toLowerCase())return;
      const roles:any=await read(`https://groups.roblox.com/v2/users/${id}/groups/roles`,controller.signal);
      if(!current()||!Array.isArray(roles?.data)||roles.data.length>1000||roles.nextPageCursor)return;
      const seen=new Set<string>();for(const r of roles.data){const gid=safeAssetId(String(r?.group?.id));if(!gid||seen.has(gid))return;seen.add(gid);}
      const match=roles.data.find((r:any)=>String(r.group.id)===groupId);
      const reply=parseMemberReply({ok:true,groupId,query,retrievedAt:Date.now(),user:{id,name:user.name,displayName:user.displayName,...(match?{role:{name:match.role?.name,rank:match.role?.rank}}:{})}},groupId,query);
      if(!reply||!await allowed()||!current())return;
      if(cache.size>=20)cache.delete(cache.keys().next().value!);cache.set(key,reply);return reply;
    }catch(error){const retryAt=(error as {retryAt?:number})?.retryAt;if(Number.isSafeInteger(retryAt)&&retryAt!>Date.now()){
      const task=lock.then(async()=>{const prior=(await extension.storage.local.get(MEMBER_BUDGET_KEY))[MEMBER_BUDGET_KEY];await extension.storage.local.set({[MEMBER_BUDGET_KEY]:Math.max(prior??0,retryAt!)});});lock=task.catch(()=>{});await task;
    }return;}
    finally{preflights--;if(active.get(tab)===controller)active.delete(tab);}
  };
  return {lookup,cancel,clear(){cancel();cache.clear();}};
}
