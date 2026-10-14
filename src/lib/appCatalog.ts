export const APP_CATALOG_KEY = 'tessera-app-catalog';
export interface CatalogSource { repositoryUrl: string; reference: string }
export interface CatalogEntry { id: string; name: string; version: string; description: string; category: string; icon: string; package: string; sha256: string }
export interface AppCatalog { ticket: string; repository: string; commit: string; apps: CatalogEntry[] }
export function loadCatalogSource(): CatalogSource {
  try {
    const source = JSON.parse(localStorage.getItem(APP_CATALOG_KEY) ?? 'null');
    if (typeof source?.repositoryUrl === 'string' && typeof source.reference === 'string') return source;
  } catch { /* No source configured yet. */ }
  return { repositoryUrl: '', reference: '' };
}
export function saveCatalogSource(source: CatalogSource): void {
  localStorage.setItem(APP_CATALOG_KEY, JSON.stringify(source));
}
