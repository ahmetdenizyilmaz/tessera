import { usePluginStore } from '../store/pluginStore';

import { BUNDLED_APPS } from './bundledApps';

export function registerBuiltins(): void {
  const { registerBuiltin } = usePluginStore.getState();
  for (const manifest of BUNDLED_APPS) registerBuiltin(manifest.name, manifest);
  registerBuiltin('lichess', {
    name: 'lichess', version: '1.0.0', description: 'Play chess on Lichess with your own account',
    entry: '', icon: 'Chess', defaultTitle: 'Lichess', builtin: true,
    browserSite: 'lichess', homeUrl: 'https://lichess.org/', accentColor: '#82b86b',
  });
}
