import { invoke } from '@tauri-apps/api/core';
import type { AntigravityDiscovery } from '../types/antigravity';

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<AntigravityDiscovery> }>();

/** `agy --version`, `agy models` and the sign-in check. Shared by every panel's
 *  controls so opening a menu does not start the CLI again; failures are not cached. */
export function discoverAntigravity(executablePath: string, fresh = false): Promise<AntigravityDiscovery> {
  const key = executablePath.trim();
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = invoke<AntigravityDiscovery>('antigravity_discover', { executablePath: key });
  cache.set(key, { at: Date.now(), value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}
