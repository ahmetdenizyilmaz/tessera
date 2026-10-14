import { usePluginStore } from '../store/pluginStore';
import { closePanel } from './panelCleanup';

const removing = new Map<string, Promise<void>>();

/** Remove every copy through normal panel cleanup, including group/window
 * membership and native web views. Keep profiles and plugin files for restore. */
export function removePlugin(name: string): Promise<void> {
  const pending = removing.get(name);
  if (pending) return pending;
  const task = Promise.resolve().then(async () => {
    if (!usePluginStore.getState().registry.has(name)) return;
    usePluginStore.getState().setPluginRemoved(name, true);
    const ids = [...usePluginStore.getState().instances.values()].filter(instance => instance.pluginName === name).map(instance => instance.id);
    for (const id of ids) await closePanel(id, false);
  }).finally(() => removing.delete(name));
  removing.set(name, task);
  return task;
}
