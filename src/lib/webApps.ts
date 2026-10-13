import type { PluginManifest } from '../types/plugin';

export const WEB_APPS_KEY='tessera-web-apps';
export const WEB_APP_ICONS=['Globe','Chess','Music','Video','Gamepad2','MessageCircle','BookOpen','FileText','Clock'] as const;
export interface WebAppInput { name:string; url:string; icon:string }
export function webAppUrl(value:string):string {
  const text=value.trim();
  const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[\w.-]+:\d+(?:\/|$)/.test(text)?text:`https://${text}`);
  if(!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Enter an http or https address without a username or password.');
  return url.href;
}
export function validWebAppIcon(icon:unknown):icon is string {
  return typeof icon==='string' && ((WEB_APP_ICONS as readonly string[]).includes(icon) || icon.length<=100000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(icon));
}
export function webAppManifest(input:WebAppInput,id=`web-app-${crypto.randomUUID()}`):PluginManifest {
  const name=input.name.trim();
  if(!name || name.length>60) throw new Error('Choose a name between 1 and 60 characters.');
  if(!/^web-app-[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid web app identity.');
  if(!validWebAppIcon(input.icon)) throw new Error('Choose an icon or upload an image.');
  return {name:id,version:'1.0.0',description:`${name} web panel`,entry:'',icon:input.icon,defaultTitle:name,customWebApp:true,browserSite:id,homeUrl:webAppUrl(input.url)};
}
export function loadWebApps():PluginManifest[] {
  try {
    const entries:unknown=JSON.parse(localStorage.getItem(WEB_APPS_KEY)??'[]');
    if(!Array.isArray(entries))return [];
    return entries.flatMap(entry=>{
      if(!entry || typeof entry.name!=='string')return [];
      try{return [webAppManifest({name:entry.defaultTitle,url:entry.homeUrl,icon:entry.icon},entry.name)];}catch{return [];}
    });
  } catch {return [];}
}
export function saveWebApps(registry:Map<string,PluginManifest>) {
  localStorage.setItem(WEB_APPS_KEY,JSON.stringify([...registry.values()].filter(m=>m.customWebApp)));
}

/** Keep a small, portable image in the app definition instead of a temporary file path. */
export async function webAppImage(file:File):Promise<string> {
  if(file.size>5*1024*1024)throw new Error('Choose an image smaller than 5 MB.');
  if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
  const objectUrl=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=objectUrl;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image preview is unavailable.');
    const scale=Math.min(64/image.naturalWidth,64/image.naturalHeight);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    ctx.drawImage(image,(64-w)/2,(64-h)/2,w,h);
    return canvas.toDataURL('image/png');
  } finally {URL.revokeObjectURL(objectUrl);}
}
