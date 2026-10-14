import { usePluginStore } from '../../store/pluginStore';
import { BrowserPanel } from '../browser/BrowserPanel';

export function PluginPanel({ instanceId }: { instanceId: string }) {
  const site = usePluginStore(s => {
    const instance = s.instances.get(instanceId);
    return instance ? s.registry.get(instance.pluginName)?.browserSite : undefined;
  });
  return site ? <BrowserPanel instanceId={instanceId} site={site}/> :
    <div className="plugin-unavailable">This app is unavailable. Open the app library to install its HTML version.</div>;
}
