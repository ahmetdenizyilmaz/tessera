import { createContext, useContext } from 'react';
export const PanelWindowContext = createContext<{ document?: Document; label?: string; enterGroup?: (id: string) => void; maximize?: () => void }>({});
export const usePanelWindow = () => useContext(PanelWindowContext);
