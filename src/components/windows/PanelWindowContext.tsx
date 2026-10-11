import { createContext, useContext } from 'react';
import { useLayoutStore, type LayoutStore } from '../../store/layoutStore';
export const PanelWindowContext = createContext<{ document?: Document; label?: string; enterGroup?: (id: string) => void; layout?: LayoutStore }>({});
export const usePanelWindow = () => useContext(PanelWindowContext);
export const usePanelLayout = () => usePanelWindow().layout ?? useLayoutStore;
