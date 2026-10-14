import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useAppearanceStore } from '../../store/appearanceStore';
import { backgroundForeground, backgroundStyle, readBackgroundImage, type PanelBackground } from '../../lib/panelBackground';
import './appearance.css';

export function usePanelBackground(id: string) {
  return useAppearanceStore(state => state.panels[id] ?? state.global);
}
export function useBackgroundImage(background: PanelBackground) {
  const [result, setResult] = useState<{ id: string; image?: string; error?: string }>();
  const id = background.mode === 'image' ? background.imageId : undefined;
  useEffect(() => {
    if (!id) return;
    let disposed = false;
    void readBackgroundImage(id).then(image => { if (!disposed) setResult({ id, image, error: image ? undefined : 'This background image is not available on this device. Choose it again.' }); })
      .catch(() => { if (!disposed) setResult({ id, error: 'Could not load the saved background image.' }); });
    return () => { disposed = true; };
  }, [id]);
  return result?.id === id ? result : undefined;
}
export function PanelAppearance({ panelId, children }: { panelId: string; children: ReactNode }) {
  const background = usePanelBackground(panelId), image = useBackgroundImage(background);
  return <div className="panel-appearance" data-custom-background={background.mode !== 'theme' ? '' : undefined}
    style={{ ...backgroundStyle(background, image?.image), '--panel-foreground': backgroundForeground(background) } as CSSProperties}>{children}</div>;
}
