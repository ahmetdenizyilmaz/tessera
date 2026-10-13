import { beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k),clear:()=>data.clear()});});
import { loadWebApps, webAppManifest, webAppUrl, webAppIcon, WEB_APPS_KEY } from './webApps';
import { usePluginStore } from '../store/pluginStore';
beforeEach(()=>{localStorage.clear();usePluginStore.setState({registry:new Map(),instances:new Map()});});
it('persists automatic icon choice and a cached PNG separately without changing the browser profile',()=>{
  const favicon='data:image/png;base64,iVBORw0KGgo=';
  const automatic=webAppManifest({name:'Auto',url:'https://example.test',icon:'',favicon});
  expect(webAppIcon(automatic)).toBe(favicon);
  localStorage.setItem(WEB_APPS_KEY,JSON.stringify([automatic]));
  expect(loadWebApps()).toEqual([automatic]);
  expect(loadWebApps()[0].browserSite).toBe(automatic.name);
  const fallback=webAppManifest({name:'Auto',url:'https://example.test',icon:''});
  expect(webAppIcon(fallback)).toBe('Globe');
  expect(webAppIcon(webAppManifest({name:'Manual',url:'https://example.test',icon:'Music',favicon}))).toBe('Music');
});
it('discards unsafe favicon cache values and accepts an empty icon from a saved custom app',()=>{
  const app=webAppManifest({name:'Auto',url:'https://example.test',icon:''});
  for(const favicon of ['https://example.test/icon.svg','data:image/svg+xml;base64,PHN2Zz4=', 'Globe']) {
    localStorage.setItem(WEB_APPS_KEY,JSON.stringify([{...app,favicon}]));
    expect(loadWebApps()).toEqual([app]);
  }
  const {icon:_,...withoutIcon}=app;
  localStorage.setItem(WEB_APPS_KEY,JSON.stringify([withoutIcon]));
  expect(loadWebApps()).toEqual([app]);
});
it('normalizes web addresses and rejects local files, executable URLs, and embedded credentials',()=>{
  expect(webAppUrl('example.com/player')).toBe('https://example.com/player');
  expect(webAppUrl('http://localhost:3000/music')).toBe('http://localhost:3000/music');
  for(const url of ['file:///C:/secret','javascript:alert(1)','data:text/html,test','https://user:password@example.com'])expect(()=>webAppUrl(url)).toThrow();
});
it('keeps profile identity and uploaded images through closing panels, reloading definitions, and restore',()=>{
  const icon='data:image/png;base64,iVBORw0KGgo=';
  const name=usePluginStore.getState().addWebApp({name:'My player',url:'https://music.example.test',icon});
  const definition=usePluginStore.getState().registry.get(name)!;
  const first=usePluginStore.getState().createInstance(name);usePluginStore.getState().destroyInstance(first);
  const persisted=loadWebApps();expect(persisted).toHaveLength(1);expect(persisted[0]).toEqual(definition);
  usePluginStore.setState({registry:new Map(persisted.map(m=>[m.name,m]))});
  expect(usePluginStore.getState().restoreInstance(name,'restored')).toBe(true);
  expect(usePluginStore.getState().instances.get('restored')?.icon).toBe(icon);
  expect(usePluginStore.getState().registry.get(name)?.browserSite).toBe(name);
});
it('restores an exported app definition without replacing existing ones and skips invalid saved entries',()=>{
  const definition=webAppManifest({name:'Player',url:'https://example.test',icon:'Music'});
  usePluginStore.getState().restoreWebApp(definition);
  usePluginStore.getState().restoreWebApp({...definition,homeUrl:'https://changed.test'});
  expect(usePluginStore.getState().registry.get(definition.name)?.homeUrl).toBe('https://example.test/');
  localStorage.setItem(WEB_APPS_KEY,JSON.stringify([definition,{...definition,name:'../../other'},{...definition,homeUrl:'javascript:test'}]));
  expect(loadWebApps()).toEqual([definition]);
  expect(()=>webAppManifest({name:' ',url:'https://example.test',icon:'Globe'})).toThrow();
});
it('keeps rapidly created panels independent even when the clock has not advanced',()=>{
  const name=usePluginStore.getState().addWebApp({name:'Player',url:'https://example.test',icon:'Music'});
  const clock=vi.spyOn(Date,'now').mockReturnValue(12345);
  try {
    const first=usePluginStore.getState().createInstance(name);
    const second=usePluginStore.getState().createInstance(name);
    expect(second).not.toBe(first);
    usePluginStore.getState().destroyInstance(first);
    expect(usePluginStore.getState().instances.has(second)).toBe(true);
  } finally {clock.mockRestore();}
});
it('does not invent a new browser profile when a saved definition is missing its identity',()=>{
  const valid=webAppManifest({name:'Player',url:'https://example.test',icon:'Music'});
  const {name:_,...missingId}=valid;
  localStorage.setItem(WEB_APPS_KEY,JSON.stringify([missingId,valid]));
  expect(loadWebApps()).toEqual([valid]);
  expect(loadWebApps()).toEqual([valid]);
  expect(()=>usePluginStore.getState().restoreWebApp(missingId as typeof valid)).toThrow();
  expect(usePluginStore.getState().registry.size).toBe(0);
});
