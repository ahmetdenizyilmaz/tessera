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
export type BubbleKind = '' | 'talk' | 'think' | 'work' | 'question' | 'alert';
/** How many animation frames a bubble kind cycles through. */
export const BUBBLE_FRAMES: Record<Exclude<BubbleKind, ''>, number> = { talk: 4, think: 3, work: 12, question: 1, alert: 1 };
/** A bubble drawn at the character's origin, floating above the head. Each kind
 * has its own shape and motion so the state reads at a glance without text:
 * talk = speech bubble with sound waves, think = thought cloud with pulsing
 * dots, work = spinning gear, question/alert = a glyph drawn by the engine. */
export function drawSpeechBubble(g: Graphics, kind: BubbleKind, frame: number) {
  g.clear();
  if (!kind) return;
  const outline = { color: 0x2a3a44, width: 1.2, alpha: .5 };
  if (kind === 'think') {
    const fill = 0xf7f4e8;
    // Cloud: overlapping circles for a bumpy outline, with a trail of small circles to the head.
    for (const [x, y, r] of [[-9, -73, 7], [0, -76, 9], [9, -73, 7], [-4, -68, 6], [5, -68, 6]]) g.circle(x, y, r).fill(fill);
    for (const [x, y, r] of [[-9, -73, 7], [0, -76, 9], [9, -73, 7]]) g.circle(x, y, r).stroke(outline);
    g.circle(-3, -60, 2.4).fill(fill).stroke(outline); g.circle(-6, -55, 1.5).fill(fill).stroke(outline);
    for (let i = 0; i < 3; i++) g.circle(-6 + i * 6, -73, frame % 3 === i ? 2.6 : 1.7).fill(0x5a6b78);
    return;
  }
  const fill = kind === 'talk' ? 0xdff3ea : kind === 'question' ? 0xfbe7b5 : kind === 'alert' ? 0xf8d2cb : 0xfbead3;
  g.roundRect(-15, -82, 30, 19, 9).fill(fill).stroke(outline);
  g.poly([-4, -64, 2, -64, 0, -58]).fill(fill);
  if (kind === 'talk') {
    // A speaker dot and three sound-wave arcs that light up outward in turn.
    g.circle(-8, -72.5, 2.4).fill(0x2f8f6b);
    for (let i = 0; i < 3; i++) g.arc(-8, -72.5, 5 + i * 3.3, -Math.PI / 3, Math.PI / 3).stroke({ color: 0x2f8f6b, width: 1.6, alpha: frame % 4 === i + 1 ? 1 : .3 });
  }
  if (kind === 'work') {
    // Gear turning one tooth per frame.
    const angle = (frame % 12) * Math.PI / 6, cx = 0, cy = -72.5;
    for (let t = 0; t < 6; t++) { const a = angle + t * Math.PI / 3; g.poly([cx + Math.cos(a - .28) * 4.5, cy + Math.sin(a - .28) * 4.5, cx + Math.cos(a - .2) * 7.2, cy + Math.sin(a - .2) * 7.2, cx + Math.cos(a + .2) * 7.2, cy + Math.sin(a + .2) * 7.2, cx + Math.cos(a + .28) * 4.5, cy + Math.sin(a + .28) * 4.5]).fill(0xd98d3a); }
    g.circle(cx, cy, 4.6).fill(0xd98d3a); g.circle(cx, cy, 1.8).fill(fill);
  }
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

/** What the body does besides walking: `talk0/talk1` move the mouth,
 * `think` lifts the gaze, `work0/work1` move the arms as if typing. */
export type CharacterMood = '' | 'talk0' | 'talk1' | 'think' | 'work0' | 'work1';
/** `wearables` is the `wearableKey()` string: head|face|neck item ids. */
export function drawOfficeCharacter(g: Graphics, id: string, color: number, wearables: string, frame: number, walking: boolean, activity: string, mood: CharacterMood = '') {
  const [head, face, neck] = wearables.split('|');
  const seed = characterSeed(id), skin = [0xf1c29c, 0xbd8968, 0x966747, 0xe3af81][seed % 4], hair = [0x423632, 0xb6804d, 0x302e39, 0x8a6751][seed % 4];
  const step = walking ? (frame % 2 ? 2 : -2) : mood === 'work0' ? 1 : mood === 'work1' ? -1 : 0;
  g.clear().ellipse(0, 7, 10, 4).fill({ color: 0x152329, alpha: .28 });
  const stride = walking ? step : 0;
  g.rect(-6, -8 + stride, 5, 12).rect(1, -8 - stride, 5, 12).fill(0x3b485a);
  g.rect(-7, 2 + stride, 6, 4).rect(1, 2 - stride, 6, 4).fill(0xd5d8c7);
  g.roundRect(-8, -27, 16, 22, 3).fill(color).stroke({ color: 0x202b37, width: 1 });
  g.rect(-11, -24 - step, 4, 14).rect(7, -24 + step, 4, 14).fill(shade(color, .8));
  g.rect(-11, -11 - step, 4, 4).rect(7, -11 + step, 4, 4).fill(skin);
  g.roundRect(-7, -42, 14, 16, 3).fill(skin);
  g.rect(-8, -43, 16, 5).rect(-8, -39, seed % 2 ? 5 : 3, 6).fill(hair);
  const gaze = mood === 'think' ? 1 : 0;
  g.rect(-4, -35 - gaze, 2, 2).rect(3, -35 - gaze, 2, 2).fill(0x26313d);
  if (mood === 'talk1') g.roundRect(-2, -30.5, 4, 2.5, 1).fill(0x7a3f3f);
  else if (mood === 'talk0') g.rect(-1.5, -29.5, 3, 1).fill(0x7a3f3f);
  // Neck first so hats and glasses draw over it.
  if (neck === 'tie') g.poly([-1, -27, 1, -27, 2, -17, 0, -13, -2, -17]).fill(0xc24d4d);
  if (neck === 'bowtie') g.poly([-6, -29, -1, -27, -6, -24]).poly([6, -29, 1, -27, 6, -24]).fill(0xc24d4d).rect(-1, -28, 2, 2).fill(0x8a2f2f);
  if (neck === 'scarf') { g.roundRect(-9, -29, 18, 5, 2).fill(0xe28a4a); g.roundRect(3, -26, 4, 9, 1).fill(0xd3773a); }
  if (neck === 'lanyard') { g.moveTo(-3, -27).lineTo(0, -18).moveTo(3, -27).lineTo(0, -18).stroke({ color: 0x4aa3df, width: 1.2 }); g.rect(-2, -18, 4, 5).fill(0xf2f2f2).rect(-1.5, -17, 3, 1).fill(0x4aa3df); }
  if (face === 'glasses') { g.circle(-3, -35, 2.8).circle(4, -35, 2.8).stroke({ color: 0x26313d, width: 1 }); g.moveTo(-0.2, -35).lineTo(1.2, -35).stroke({ color: 0x26313d, width: 1 }); }
  if (face === 'sunglasses') { g.roundRect(-6, -37, 5, 4, 1).roundRect(1.5, -37, 5, 4, 1).fill(0x1a1f26); g.moveTo(-1, -36).lineTo(1.5, -36).stroke({ color: 0x1a1f26, width: 1 }); }
  if (face === 'monocle') { g.circle(4, -35, 3.2).stroke({ color: 0xf3ce75, width: 1 }); g.moveTo(6.5, -33).lineTo(9, -27).stroke({ color: 0xf3ce75, width: .8 }); }
  if (head === 'headphones') { g.arc(0, -36, 10, Math.PI, 0).stroke({ color: 0x26313d, width: 3 }); g.roundRect(-12, -37, 4, 9, 2).roundRect(8, -37, 4, 9, 2).fill(0xf0bb77); }
  if (head === 'cap') g.poly([-9, -40, -7, -48, 6, -48, 9, -40, 14, -38, -9, -38]).fill(0xe7bb76);
  if (head === 'beanie') { g.roundRect(-8.5, -48, 17, 9, 4).fill(0xb75c6b); g.rect(-8.5, -42, 17, 3).fill(0x8f4452); g.circle(0, -49, 2.5).fill(0xf0d7a6); }
  if (head === 'beret') { g.ellipse(-1, -45, 10, 4).fill(0x3b4f8f); g.rect(-1.5, -50, 2, 3).fill(0x2a3a6b); }
  if (head === 'visor') { g.poly([-9, -40, 9, -40, 13, -37, -13, -37]).fill(0x3dd1a0); g.rect(-8, -43, 16, 3).fill(0x2fae84); }
  if (head === 'party_hat') { g.poly([-6, -43, 6, -43, 0, -59]).fill(0x7fc0e8); g.poly([-4, -48, 4, -48, 3, -51, -3, -51]).fill(0xf5d76e); g.circle(0, -59, 2).fill(0xf0788f); }
  if (head === 'crown') g.poly([-8, -43, -9, -53, -3, -48, 0, -55, 4, -48, 9, -53, 8, -43]).fill(0xf3ce75).stroke({ color: 0x9a7743, width: 1 });
  if (head === 'halo') g.ellipse(0, -50, 9, 3).stroke({ color: 0xf3ce75, width: 2 });
  if (!walking && (activity === 'reading_file' || activity === 'searching_files')) g.poly([-9, -19, 0, -16, 9, -19, 9, -7, 0, -4, -9, -7]).fill(0xf0d7a6).stroke({ color: 0x9e805b, width: 1 });
  const active = !['idle', 'unknown', 'new'].includes(activity);
  g.circle(11, -43, 4).fill(activity === 'error' ? 0xe79588 : activity === 'awaiting_permission' ? 0xf1c574 : active ? 0x8fceaf : 0x8c9b9c);
}
