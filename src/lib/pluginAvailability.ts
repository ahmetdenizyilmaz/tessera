export const REMOVED_PLUGINS_KEY = 'tessera-removed-plugins';

export function loadRemovedPlugins(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(REMOVED_PLUGINS_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 200) : []);
  } catch { return new Set(); }
}

export function saveRemovedPlugins(names: Set<string>): void {
  localStorage.setItem(REMOVED_PLUGINS_KEY, JSON.stringify([...names]));
}
