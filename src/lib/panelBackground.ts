import type { CSSProperties } from 'react';

export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'center' | 'tile';
export interface PanelBackground {
  mode: 'theme' | 'color' | 'image';
  color: string;
  imageId?: string;
  imageName?: string;
  fit: BackgroundFit;
  dim: number;
}
export const DEFAULT_BACKGROUND: PanelBackground = { mode: 'theme', color: '#18212c', fit: 'cover', dim: 35 };
export function normalizeBackground(value: unknown): PanelBackground {
  const v = value as Partial<PanelBackground> | null;
  if (!v || typeof v !== 'object') return { ...DEFAULT_BACKGROUND };
  return {
    mode: ['theme', 'color', 'image'].includes(v.mode ?? '') ? v.mode! : 'theme',
    color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : DEFAULT_BACKGROUND.color,
    imageId: typeof v.imageId === 'string' && /^[a-z0-9-]{1,80}$/i.test(v.imageId) ? v.imageId : undefined,
    imageName: typeof v.imageName === 'string' ? v.imageName.slice(0, 150) : undefined,
    fit: ['cover', 'contain', 'stretch', 'center', 'tile'].includes(v.fit ?? '') ? v.fit! : 'cover',
    dim: typeof v.dim === 'number' && Number.isFinite(v.dim) ? Math.max(0, Math.min(85, v.dim)) : 35,
  };
}
export function backgroundForeground(value: PanelBackground): string {
  if (value.mode !== 'color') return '#e8edf3';
  const rgb = value.color.slice(1).match(/../g)!.map(v => parseInt(v, 16));
  return rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 155 ? '#17212d' : '#e8edf3';
}
export function backgroundStyle(value: PanelBackground, image?: string): CSSProperties {
  if (value.mode === 'theme') return {};
  const hasImage = value.mode === 'image' && !!image;
  return {
    backgroundColor: value.color,
    backgroundImage: hasImage ? `linear-gradient(rgba(0,0,0,${value.dim / 100}),rgba(0,0,0,${value.dim / 100})),url("${image}")` : 'none',
    backgroundSize: hasImage ? `100% 100%, ${value.fit === 'stretch' ? '100% 100%' : value.fit === 'center' || value.fit === 'tile' ? 'auto' : value.fit}` : undefined,
    backgroundPosition: 'center', backgroundRepeat: value.fit === 'tile' ? 'no-repeat, repeat' : 'no-repeat',
  };
}

// Images live in IndexedDB, not the small localStorage workspace/settings
// quota. A panel keeps an immutable image ID, including when closed/reopened.
let database: Promise<IDBDatabase> | undefined;
const cache = new Map<string, Promise<string | undefined>>();
function openImages(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('tessera-backgrounds', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('Background storage is busy. Please try again.')); };
  });
}
export function readBackgroundImage(id: string): Promise<string | undefined> {
  if (!cache.has(id)) cache.set(id, openImages().then(db => new Promise<string | undefined>((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').get(id);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
    request.onerror = () => reject(request.error);
  })).catch(error => { cache.delete(id); throw error; }));
  return cache.get(id)!;
}
export async function importBackgroundImage(file: File): Promise<{ imageId: string; imageName: string }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF, or BMP image.');
  const url = URL.createObjectURL(file);
  let data: string;
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 64_000_000) throw new Error('Choose an image with fewer than 64 million pixels.');
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image preview is unavailable.');
    context.fillStyle = '#18212c'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    data = canvas.toDataURL('image/jpeg', .86);
    if (data.length > 3 * 1024 * 1024) data = canvas.toDataURL('image/jpeg', .65);
    if (data.length > 3 * 1024 * 1024) throw new Error('This image is too detailed. Choose a smaller image.');
  } finally { URL.revokeObjectURL(url); }
  const imageId = crypto.randomUUID(); const db = await openImages();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('images', 'readwrite'); transaction.objectStore('images').put(data, imageId);
    transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this image.'));
  });
  cache.set(imageId, Promise.resolve(data));
  return { imageId, imageName: file.name };
}
