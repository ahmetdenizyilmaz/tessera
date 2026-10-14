import {beforeEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {loadHtmlApps} from './htmlPlugins';
import {usePluginStore} from '../store/pluginStore';
import type {PluginManifest} from '../types/plugin';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
const app:PluginManifest={name:'html-test.notes',defaultTitle:'Notes',description:'Local notes',entry:'index.html',version:'1',icon:'NotebookPen',htmlPlugin:true,browserSite:'html-test.notes',permissions:{network:[],panels:[]},enabled:true};
let storage:Map<string,string>;
beforeEach(()=>{
  vi.clearAllMocks();storage=new Map();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
  usePluginStore.setState({registry:new Map(),instances:new Map(),removedPlugins:new Set()});
});
it('hydrates a saved HTML definition before synchronous workspace restore',()=>{
  usePluginStore.getState().registerHtmlApp(app);
  expect(loadHtmlApps()).toEqual([app]);
  usePluginStore.setState({registry:new Map(loadHtmlApps().map(m=>[m.name,m]))});
  expect(usePluginStore.getState().restoreInstance(app.name,'saved-panel','My notes')).toBe(true);
  expect(usePluginStore.getState().instances.get('saved-panel')?.title).toBe('My notes');
});
it('does not accept web/built-in identity overrides from the HTML display cache',()=>{
  storage.set('tessera-html-apps',JSON.stringify([app,{...app,name:'lichess'},{...app,builtin:true},{...app,customWebApp:true},{...app,browserSite:'web-app-another'}]));
  expect(loadHtmlApps()).toEqual([app]);
});
it('uses the native installed/removed catalog while preserving other panel types',async()=>{
  const builtin={name:'timer',defaultTitle:'Timer',description:'',entry:'',version:'1',icon:'Timer',builtin:true};
  usePluginStore.setState({registry:new Map([['timer',builtin],[app.name,app],['html-removed.from.disk',{...app,name:'html-removed.from.disk'}]])});
  vi.mocked(invoke).mockResolvedValue([{name:app.name,manifest:{...app,enabled:false}}]);
  await usePluginStore.getState().scanPlugins();
  expect([...usePluginStore.getState().registry.keys()]).toEqual(['timer',app.name]);
  expect(usePluginStore.getState().createInstance(app.name)).toBe('');
  expect(usePluginStore.getState().restoreInstance(app.name,'old-panel')).toBe(false);
  expect(loadHtmlApps()[0].enabled).toBe(false);
});
it('retains the existing catalog if discovery fails',async()=>{
  usePluginStore.setState({registry:new Map([[app.name,app]])});
  vi.mocked(invoke).mockRejectedValue(new Error('Temporarily unavailable'));
  await usePluginStore.getState().scanPlugins();
  expect(usePluginStore.getState().registry.get(app.name)).toBe(app);
});
