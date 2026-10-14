import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {mockIPC,mockWindows} from '@tauri-apps/api/mocks';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {PanelAppearance} from '../src/components/appearance/PanelAppearance';
import {PanelAppearanceButton} from '../src/components/appearance/BackgroundSettings';
import {AboutDialog} from '../src/components/menubar/AboutDialog';
import {SettingsDialog} from '../src/components/dialogs/SettingsDialog';
import {StatusBar} from '../src/components/statusbar/StatusBar';
import {useAppearanceStore} from '../src/store/appearanceStore';
import {useSystemStore} from '../src/store/systemStore';
import {useUsageStore} from '../src/store/usageStore';
import {panelTerminalTheme,watchTerminalBackground} from '../src/lib/terminalTheme';
import '../src/styles/global.css';
import '@xterm/xterm/css/xterm.css';
mockWindows('main');window.calls=[];mockIPC((command,args)=>{window.calls.push({command,args});return null;},{shouldMockEvents:true});
window.appearance=useAppearanceStore;window.terminals={};
useSystemStore.setState({cpuPercent:11,memoryPercent:69,memoryUsedGb:85.1,memoryTotalGb:123.7});
useUsageStore.setState({usage:new Map([['test',{inputTokens:26400000,outputTokens:6200000,totalCostUsd:387.6551}]])});
function Sample({id}){const ref=useRef();useEffect(()=>{const term=new Terminal({theme:panelTerminalTheme(id),allowTransparency:true,fontSize:15});const fit=new FitAddon();term.loadAddon(fit);term.open(ref.current);fit.fit();term.writeln('Tessera terminal background preview\r\n\r\n\x1b[32mWorking directory ready.\x1b[0m\r\n\r\n> Your text stays readable.');window.terminals[id]=term;const stop=watchTerminalBackground(term,id);return()=>{stop();delete window.terminals[id];term.dispose();};},[id]);return <PanelAppearance panelId={id}><div className="terminal-panel"><div className="terminal-toolbar"><span>{id}</span><PanelAppearanceButton panelId={id}/></div><div ref={ref} style={{flex:1,padding:12,minHeight:0}}/></div></PanelAppearance>;}
function App(){const[about,setAbout]=useState(false),[settings,setSettings]=useState(false);return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}><div style={{display:'flex',gap:12,padding:12}}><button onClick={()=>setAbout(true)}>About</button><button onClick={()=>setSettings(true)}>Settings</button></div><div style={{flex:1,display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:10,minHeight:0}}><div data-panel-id="first"><Sample id="first"/></div><div data-panel-id="second"><Sample id="second"/></div></div><StatusBar onNewInstance={()=>{}}/><AboutDialog isOpen={about} onClose={()=>setAbout(false)}/><SettingsDialog isOpen={settings} onClose={()=>setSettings(false)}/></div>}
createRoot(document.getElementById('root')).render(<App/>);
