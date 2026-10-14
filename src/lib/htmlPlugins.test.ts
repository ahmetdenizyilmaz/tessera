import {beforeEach,expect,it,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {loadHtmlApps} from './htmlPlugins';
import {usePluginStore} from '../store/pluginStore';
import type {PluginManifest} from '../types/plugin';
import {registerBuiltins} from './builtinPlugins';
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
it('replaces old launch IDs with HTML apps while keeping restored panel IDs and titles',()=>{
  registerBuiltins();
  expect(usePluginStore.getState().registry.has('timer')).toBe(false);
  expect(usePluginStore.getState().registry.has('notepad')).toBe(false);
  expect(usePluginStore.getState().restoreInstance('notepad','original-id','Project notes')).toBe(true);
  expect(usePluginStore.getState().instances.get('original-id')).toMatchObject({pluginName:'html-tessera.quick-notes',title:'Project notes'});
  const timer=usePluginStore.getState().createInstance('timer');
  expect(usePluginStore.getState().instances.get(timer)?.pluginName).toBe('html-tessera.timer');
  for(const name of ['html-tessera.quick-notes','html-tessera.timer','html-tessera.clock']) {
    expect(usePluginStore.getState().registry.get(name)).toMatchObject({htmlPlugin:true,browserSite:name});
  }
});
it('migrates old removals to native disabled apps and does not resurrect them',async()=>{
  registerBuiltins();
  usePluginStore.setState({removedPlugins:new Set(['timer'])});
  expect(usePluginStore.getState().createInstance('timer')).toBe('');
  const manifest=usePluginStore.getState().registry.get('html-tessera.timer')!;
  vi.mocked(invoke).mockImplementation(async command=>command==='scan_plugins'?[{name:manifest.name,manifest:{...manifest}}]:null);
  await usePluginStore.getState().scanPlugins();
  expect(invoke).toHaveBeenCalledWith('html_plugin_set_enabled',{plugin:manifest.name,enabled:false});
  expect([...usePluginStore.getState().removedPlugins]).toEqual([manifest.name]);
  expect(usePluginStore.getState().restoreInstance('timer','old-timer')).toBe(false);
});
