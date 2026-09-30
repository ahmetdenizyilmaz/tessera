import { Graphics } from 'pixi.js';
import type { OfficeFurnitureType } from '../types/office';

export function characterSeed(id: string): number { let hash = 0; for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return hash; }
const shade = (c: number, factor: number) => ((Math.round((c >> 16 & 255) * factor) << 16) | (Math.round((c >> 8 & 255) * factor) << 8) | Math.round((c & 255) * factor));
function box(g: Graphics, x: number, y: number, w: number, d: number, h: number, color: number) {
  const a = { x, y: y - h }, b = { x: x + w, y: y - h + w / 2 }, c = { x: x + w - d, y: y - h + (w + d) / 2 }, e = { x: x - d, y: y - h + d / 2 };
  g.poly([e, c, { x: c.x, y: c.y + h }, { x: e.x, y: e.y + h }]).fill(shade(color, .7));
  g.poly([b, c, { x: c.x, y: c.y + h }, { x: b.x, y: b.y + h }]).fill(shade(color, .5));
  g.poly([a, b, c, e]).fill(color).stroke({ color: 0x181d27, width: 1, alpha: .35 });
}
export function drawOfficeFurniture(g: Graphics, type: OfficeFurnitureType) {
  g.ellipse(8, 8, 22, 10).fill({ color: 0x111b25, alpha: .2 });
  if (type === 'desk') {
    box(g, -2, 8, 43, 23, 22, 0xb79773);
    box(g, 5, -11, 18, 5, 20, 0x34444a);
    g.poly([5, -31, 23, -22, 23, -9, 5, -18]).fill(0x85cab5);
    g.poly([5, -10, 20, -3, 14, 0, -1, -7]).fill(0xc8d3cf);
    g.rect(27, -3, 4, 6).fill(0xe2af76);
  } else if (type === 'chair') {
    box(g, 0, 11, 13, 13, 13, 0x476978); box(g, -3, -1, 15, 4, 16, 0x6695a3);
    g.moveTo(0, 18).lineTo(0, 24).moveTo(-8, 24).lineTo(8, 24).stroke({ color: 0x26333c, width: 3 });
  } else if (type === 'plant') {
    box(g, 0, 12, 12, 12, 14, 0xc48e6b);
    g.moveTo(0, 5).lineTo(0, -25).stroke({ color: 0x466b4b, width: 3 });
    for (const [x, y] of [[-8, -10], [8, -17], [-5, -25], [4, -31]]) g.ellipse(x, y, 8, 5).fill(x < 0 ? 0x78aa7f : 0x9ac393);
  } else if (type === 'bookshelf' || type === 'filing_cabinet' || type === 'server_rack') {
    box(g, -2, 8, 30, 12, 43, type === 'server_rack' ? 0x354453 : type === 'bookshelf' ? 0x967659 : 0x83939a);
    for (let row = 0; row < 3; row++) {
      const y = -28 + row * 11;
      g.poly([-12, y, 16, y + 14, 16, y + 22, -12, y + 8]).fill(type === 'bookshelf' ? 0x443e3b : 0x26343f);
      if (type === 'bookshelf') for (let col = 0; col < 5; col++) g.poly([-10 + col * 5, y + 1 + col * 2.5, -7 + col * 5, y + 2.5 + col * 2.5, -7 + col * 5, y + 8 + col * 2.5, -10 + col * 5, y + 6.5 + col * 2.5]).fill([0xb77569, 0x76a297, 0xdac18d, 0x97a8c0, 0xc18da1][col]);
      else g.circle(-8, y + 5, 1.4).fill(0x8ee3b5);
    }
  } else if (type === 'couch') {
    box(g, 0, 12, 44, 20, 15, 0x74928e); box(g, 0, -4, 44, 5, 21, 0x98b2a8);
    box(g, -12, 8, 7, 13, 20, 0x6b9189); box(g, 31, 29, 7, 13, 20, 0x6b9189);
  } else if (type === 'whiteboard' || type === 'task_board' || type === 'poster') {
    box(g, 0, 8, 36, 3, 38, 0xccd4c5);
    const colors = type === 'whiteboard' ? [0x508c85, 0x508c85, 0x508c85] : [0xeab775, 0x86b5a3, 0xbe94b5];
    for (let i = 0; i < 3; i++) g.poly([4 + i * 9, -21 + i * 4.5, 10 + i * 9, -18 + i * 4.5, 10 + i * 9, -10 + i * 4.5, 4 + i * 9, -13 + i * 4.5]).fill(colors[i]);
    if (type !== 'poster') g.moveTo(2, 8).lineTo(2, 16).moveTo(28, 21).lineTo(28, 29).stroke({ color: 0x516375, width: 3 });
  } else if (type === 'lamp') {
    g.ellipse(0, 12, 9, 4).fill(0x55606b); g.moveTo(0, 10).lineTo(0, -29).stroke({ color: 0xa9ad9b, width: 3 });
    g.poly([-8, -33, 8, -33, 13, -18, -13, -18]).fill(0xf5d293);
    g.ellipse(0, -18, 12, 4).fill(0xffe3ab);
  } else if (type === 'rug') {
    g.poly([0, 0, 47, 24, 0, 48, -47, 24]).fill(0xb07970).stroke({ color: 0xe0b292, width: 3 });
    g.poly([0, 9, 29, 24, 0, 39, -29, 24]).stroke({ color: 0xe0b292, width: 2 });
  } else {
    box(g, 0, 9, 18, 16, type === 'water_cooler' ? 30 : 23, 0x96a4a5);
    if (type === 'water_cooler') box(g, 0, -17, 12, 12, 14, 0x91c6d5);
    else if (type === 'coffee_machine') { box(g, 0, -9, 14, 12, 17, 0x384349); g.rect(3, -9, 5, 7).fill(0xe6d8b9); }
    else box(g, 0, -13, 13, 10, 2, 0xd9ded2);
  }
}

export function drawOfficeCharacter(g: Graphics, id: string, color: number, accessory: string, frame: number, walking: boolean, activity: string) {
  const seed = characterSeed(id), skin = [0xf1c29c, 0xbd8968, 0x966747, 0xe3af81][seed % 4], hair = [0x423632, 0xb6804d, 0x302e39, 0x8a6751][seed % 4];
  const step = walking ? (frame % 2 ? 2 : -2) : 0;
  g.clear().ellipse(0, 7, 10, 4).fill({ color: 0x152329, alpha: .28 });
  g.rect(-6, -8 + step, 5, 12).rect(1, -8 - step, 5, 12).fill(0x3b485a);
  g.rect(-7, 2 + step, 6, 4).rect(1, 2 - step, 6, 4).fill(0xd5d8c7);
  g.roundRect(-8, -27, 16, 22, 3).fill(color).stroke({ color: 0x202b37, width: 1 });
  g.rect(-11, -24 - step, 4, 14).rect(7, -24 + step, 4, 14).fill(shade(color, .8));
  g.rect(-11, -11 - step, 4, 4).rect(7, -11 + step, 4, 4).fill(skin);
  g.roundRect(-7, -42, 14, 16, 3).fill(skin);
  g.rect(-8, -43, 16, 5).rect(-8, -39, seed % 2 ? 5 : 3, 6).fill(hair);
  g.rect(-4, -35, 2, 2).rect(3, -35, 2, 2).fill(0x26313d);
  if (accessory === 'headphones') { g.arc(0, -36, 10, Math.PI, 0).stroke({ color: 0x26313d, width: 3 }); g.roundRect(-12, -37, 4, 9, 2).roundRect(8, -37, 4, 9, 2).fill(0xf0bb77); }
  if (accessory === 'cap') g.poly([-9, -40, -7, -48, 6, -48, 9, -40, 14, -38, -9, -38]).fill(0xe7bb76);
  if (accessory === 'crown') g.poly([-8, -43, -9, -53, -3, -48, 0, -55, 4, -48, 9, -53, 8, -43]).fill(0xf3ce75).stroke({ color: 0x9a7743, width: 1 });
  if (!walking && (activity === 'reading_file' || activity === 'searching_files')) g.poly([-9, -19, 0, -16, 9, -19, 9, -7, 0, -4, -9, -7]).fill(0xf0d7a6).stroke({ color: 0x9e805b, width: 1 });
  const active = !['idle', 'unknown', 'new'].includes(activity);
  g.circle(11, -43, 4).fill(activity === 'error' ? 0xe79588 : activity === 'awaiting_permission' ? 0xf1c574 : active ? 0x8fceaf : 0x8c9b9c);
}
