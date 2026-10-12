import type { Graphics } from 'pixi.js';

/** Pixi 8's SVG polygon parser truncates decimals and ignores root viewBox.
 * Convert polygons to paths and apply the viewBox explicitly. Browser thumbnails
 * continue to use the original, standards-compliant SVG from the item definition.
 */
export function drawOfficeSvg(g: Graphics, svg: string) {
  const root=svg.match(/<svg\b[^>]*>/)?.[0]??'';
  const box=root.match(/viewBox="([^"]+)"/)?.[1].trim().split(/\s+/).map(Number);
  const width=Number(root.match(/\bwidth="([\d.]+)"/)?.[1]);
  const height=Number(root.match(/\bheight="([\d.]+)"/)?.[1]);
  const normalized=svg.replace(/<(polygon|polyline)\b([^>]*?)\bpoints="([^"]+)"([^>]*?)\/?\s*>/g,(_,tag,before,points,after)=>{
    const coords=points.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number)??[];
    const path=coords.map((n:number,i:number)=>`${i===0?'M':i%2===0?' L':''}${n}`).join(' ');
    return `<path ${before} d="${path}${tag==='polygon'?' Z':''}" ${after.replace(/\/$/,'')}/>`;
  });
  g.save();
  // Append a local transform. context.scale() also scales the caller's
  // translation, which pulls small shirt badges back toward the feet.
  if(box?.length===4 && box[2]>0 && box[3]>0 && width>0 && height>0) {
    const sx=width/box[2], sy=height/box[3];
    g.context.transform(sx,0,0,sy,-box[0]*sx,-box[1]*sy);
  }
  g.svg(normalized);g.restore();
}
