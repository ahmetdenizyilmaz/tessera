import { BaseDirectory, exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { useOfficeGameStore } from '../store/officeGameStore';

const REQUEST = 'office-reset-request.json';
const options = { baseDir: BaseDirectory.AppLocalData };
let pending: Promise<void> | undefined;

/** Explicit maintenance request only. Never reset game data as a migration. */
export function applyPendingOfficeReset(): Promise<void> {
  return pending ??= (async () => {
    if (!await exists(REQUEST, options)) return;
    const request: unknown = JSON.parse((await readTextFile(REQUEST, options)).replace(/^\uFEFF/, ''));
    if (!request || typeof request !== 'object' || !('id' in request) || typeof request.id !== 'string'
      || !/^[a-zA-Z0-9-]{1,80}$/.test(request.id) || !('kind' in request) || request.kind !== 'fresh-office')
      throw new Error('Invalid Office reset request; your office has not been changed.');
    if (useOfficeGameStore.getState().lastResetId !== request.id) {
      const saved = localStorage.getItem('tessera-office');
      if (saved) await writeTextFile(`office-before-reset-${request.id}.json`, saved, options);
      useOfficeGameStore.getState().resetFresh(request.id);
      const persisted = JSON.parse(localStorage.getItem('tessera-office') ?? '{}');
      if (persisted.state?.lastResetId !== request.id) throw new Error('Office reset could not be saved.');
    }
    // The persisted request ID prevents a second reset if this cleanup fails.
    await remove(REQUEST, options);
  })();
}
