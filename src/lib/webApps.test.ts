import { beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k),clear:()=>data.clear()});});
import { loadWebApps, webAppManifest, webAppUrl, WEB_APPS_KEY } from './webApps';
import { usePluginStore } from '../store/pluginStore';
beforeEach(()=>{localStorage.clear();usePluginStore.setState({registry:new Map(),instances:new Map()});});
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
