import { invoke } from '@tauri-apps/api/core';
import { webAppImage, webAppUrl } from './webApps';

interface Resource { url: string; contentType: string; body: string }
const requests = new Map<string, { time: number; task: Promise<string | null> }>();

/** Parse as inert HTML: no page scripts, embedded frames or third-party icon
 * service. Resolve relative icon links against redirects and the page's base. */
export function websiteIconCandidates(html: string, finalUrl: string): string[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  let base = finalUrl;
  const resolve = (href: string, against = base) => {
    try { return webAppUrl(new URL(href, against).href); } catch { return null; }
  };
  const baseHref = document.querySelector('base[href]')?.getAttribute('href');
  if (baseHref) base = resolve(baseHref, finalUrl) ?? finalUrl;
  const icons = [...document.querySelectorAll('link[rel][href]')].flatMap(link => {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon') && !rel.includes('apple-touch-icon-precomposed')) return [];
    const href = resolve(link.getAttribute('href') ?? '');
    return href ? [{ href, rank: rel.includes('icon') ? 0 : 1 }] : [];
  }).sort((a, b) => a.rank - b.rank).map(icon => icon.href);
  const fallback = resolve('/favicon.ico', finalUrl);
  return [...new Set([...icons.slice(0, 5), ...(fallback ? [fallback] : [])])];
}

export function fetchWebsiteIcon(address: string, force = false): Promise<string | null> {
  const url = webAppUrl(address), cached = requests.get(url);
  if (cached && (!force || Date.now() - cached.time < 1000) && Date.now() - cached.time < 5 * 60 * 1000) return cached.task;
  const task = (async () => {
    let candidates = [new URL('/favicon.ico', url).href];
    try {
      const page = await invoke<Resource>('website_icon_fetch', { url, kind: 'document' });
      if (page) candidates = websiteIconCandidates(page.body, page.url);
    } catch { /* Some sites block page fetches but still serve favicon.ico. */ }
    for (const candidate of candidates) {
      try {
        const resource = await invoke<Resource>('website_icon_fetch', { url: candidate, kind: 'image' });
        if (!resource || resource.body.length > 1400000) continue;
        // Decode in an image context and rasterize to the same small PNG used
        // by uploads. No remote URL or untrusted SVG becomes persistent UI.
        const mime = /^image\/(?:png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml|avif)$/.test(resource.contentType)
          ? resource.contentType : 'application/octet-stream';
        const bytes = Uint8Array.from(atob(resource.body), c => c.charCodeAt(0));
        return await webAppImage(new File([bytes], 'website-icon', { type: mime === 'application/octet-stream' ? 'image/x-icon' : mime }));
      } catch { /* Try the next declared icon, then the site's favicon.ico. */ }
    }
    return null;
  })();
  requests.set(url, { time: Date.now(), task });
  return task;
}
