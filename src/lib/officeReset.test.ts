import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const storage = new Map<string,string>(), files = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  vi.stubGlobal('window', {localStorage:globalThis.localStorage});
  return {storage,files,write:vi.fn(),remove:vi.fn()};
});
vi.mock('@tauri-apps/plugin-fs',()=>({
  BaseDirectory:{AppLocalData:28},
  exists:vi.fn(async(path:string)=>fixture.files.has(path)),
  readTextFile:vi.fn(async(path:string)=>fixture.files.get(path)),
  writeTextFile:fixture.write,remove:fixture.remove,
}));
beforeEach(()=>{
  vi.resetModules();fixture.storage.clear();fixture.files.clear();vi.clearAllMocks();
  fixture.write.mockImplementation(async(path:string,content:string)=>{fixture.files.set(path,content);});
  fixture.remove.mockImplementation(async(path:string)=>{fixture.files.delete(path);});
});
const request='office-reset-request.json';

it('only applies an explicit request, backs up the game, and survives StrictMode and interrupted cleanup',async()=>{
  const {useOfficeGameStore:office}=await import('../store/officeGameStore');
  office.setState({currency:500,inventory:{headphones:2}});
  fixture.storage.set('tessera-autosave','active panels');fixture.storage.set('tessera-llm-chats','active chat');
  const saved=fixture.storage.get('tessera-office');
  fixture.files.set(request,'\uFEFF'+JSON.stringify({kind:'fresh-office',id:'reset-fixture'}));
  const {applyPendingOfficeReset:apply}=await import('./officeReset');
  fixture.remove.mockRejectedValueOnce(new Error('File is locked'));
  const results=await Promise.allSettled([apply(),apply()]);
  expect(results.every(r=>r.status==='rejected')).toBe(true);
  expect(fixture.write).toHaveBeenCalledTimes(1);
  expect(fixture.files.get('office-before-reset-reset-fixture.json')).toBe(saved);
  expect(office.getState()).toMatchObject({currency:0,inventory:{},lastResetId:'reset-fixture'});
  office.setState({currency:10});
  vi.resetModules();
  await (await import('./officeReset')).applyPendingOfficeReset();
  expect((await import('../store/officeGameStore')).useOfficeGameStore.getState().currency).toBe(10);
  expect(fixture.files.has(request)).toBe(false);
  expect(fixture.write).toHaveBeenCalledTimes(1);
  expect(fixture.storage.get('tessera-autosave')).toBe('active panels');
  expect(fixture.storage.get('tessera-llm-chats')).toBe('active chat');
});

it.each(['missing','invalid','backup failure'])('keeps the current game intact when the request has %s',async(mode)=>{
  const {useOfficeGameStore:office}=await import('../store/officeGameStore');
  office.setState({currency:123,inventory:{headphones:1}});
  const before=fixture.storage.get('tessera-office');
  if(mode!=='missing')fixture.files.set(request,JSON.stringify({kind:'fresh-office',id:mode==='invalid'?'../invalid':'safe-id'}));
  if(mode==='backup failure')fixture.write.mockRejectedValueOnce(new Error('Disk full'));
  const call=(await import('./officeReset')).applyPendingOfficeReset();
  if(mode==='missing')await call;else await expect(call).rejects.toThrow();
  expect(fixture.storage.get('tessera-office')).toBe(before);expect(fixture.remove).not.toHaveBeenCalled();
});
