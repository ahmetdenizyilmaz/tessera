import { useId } from 'react';
import { THEMES } from '../../lib/themeManager';
import { useSettingsStore } from '../../store/settingsStore';
import { BackgroundSettings } from '../appearance/BackgroundSettings';

export function AppearanceSettings() {
  const theme = useSettingsStore(state => state.settings.theme);
  const themeHeadingId = useId(), backgroundHeadingId = useId();

  return <div className="appearance-settings">
    <section aria-labelledby={themeHeadingId}>
      <h4 id={themeHeadingId}>App theme</h4>
      <p className="background-help">Updates panel backgrounds and text colors immediately. Custom backgrounds keep their colors.</p>
      <div className="appearance-themes" role="group" aria-label="App theme">
        {THEMES.map(option => <button
          type="button"
          key={option.id}
          aria-pressed={theme === option.id}
          onClick={() => useSettingsStore.getState().updateSettings({ theme: option.id })}
        >
          <span className="appearance-theme-preview" data-theme={option.id} aria-hidden="true">Aa<span/></span>
          <span>{option.label}</span>
        </button>)}
      </div>
    </section>
    <section aria-labelledby={backgroundHeadingId}>
      <h4 id={backgroundHeadingId}>Panel backgrounds</h4>
      <BackgroundSettings/>
    </section>
  </div>;
}
