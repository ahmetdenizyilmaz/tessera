import { beforeEach, expect, it } from 'vitest';
import { backgroundStyle, DEFAULT_BACKGROUND, normalizeBackground } from './panelBackground';
import { getPanelBackground, useAppearanceStore } from '../store/appearanceStore';

beforeEach(()=>useAppearanceStore.setState({global:{...DEFAULT_BACKGROUND},panels:{}}));
it('global edits update inherited panels while custom panels keep their choices',()=>{
  const custom={...DEFAULT_BACKGROUND,mode:'color' as const,color:'#ffffff'};
  useAppearanceStore.getState().setPanel('locked',custom);
  useAppearanceStore.getState().setGlobal({...DEFAULT_BACKGROUND,mode:'color',color:'#112233'});
  expect(getPanelBackground('new-panel').color).toBe('#112233');
  expect(getPanelBackground('locked')).toEqual(custom);
  useAppearanceStore.getState().setPanel('locked',null);
  expect(getPanelBackground('locked').color).toBe('#112233');
});
it('remaps each panel background without changing global settings',()=>{
  const custom={...DEFAULT_BACKGROUND,mode:'image' as const,imageId:'saved-image',fit:'contain' as const};
  useAppearanceStore.getState().restorePanels({old:custom},new Map([['old','restored']]));
  expect(getPanelBackground('restored')).toEqual(custom);
  expect(getPanelBackground('other')).toEqual(DEFAULT_BACKGROUND);
});
it('rejects CSS, URL and non-finite values from imported workspace settings',()=>{
  expect(normalizeBackground({mode:'script',color:'url(https://example.com)',imageId:'../../secret',fit:'expression(x)',dim:Infinity})).toEqual({...DEFAULT_BACKGROUND,imageId:undefined,imageName:undefined});
  expect(normalizeBackground({dim:-10}).dim).toBe(0);
  expect(normalizeBackground({dim:1000}).dim).toBe(85);
});
it('fit and fill preserve proportions while stretch and tile are explicit',()=>{
  for(const fit of ['cover','contain','stretch','center','tile'] as const){
    const css=backgroundStyle({...DEFAULT_BACKGROUND,mode:'image',fit},'data:image/jpeg;base64,AQ==');
    expect(css.backgroundSize).toBe(`100% 100%, ${fit==='stretch'?'100% 100%':fit==='center'||fit==='tile'?'auto':fit}`);
    expect(css.backgroundRepeat).toBe(fit==='tile'?'no-repeat, repeat':'no-repeat');
  }
});
