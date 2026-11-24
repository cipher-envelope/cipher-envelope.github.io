// The hand-drawn pictures: the envelope, the security tint, and "How it works" for every method.
// Colours come from the palette passed in, so a theme change is a redraw. Text drawn here is
// escaped by @borrowdale/text, so user input cannot become markup.

import { sketch, toSvgSketch, type Shape, type SketchOptions } from '@borrowdale/core';
import { pattern } from '@borrowdale/fills';
import { fontFaceCss, layoutText, toSvgText } from '@borrowdale/text';
import { excalifontFiles } from '@borrowdale/text/excalifont-files';
import { parseKeyword, parseRails, parseShift, playfairSquare, railPattern } from '../crypto/classical';
import { isAesEnvelope, type Envelope } from '../crypto/envelope';
import { CipherError } from '../crypto/errors';
import { aesSpec, assertNever, gradeOf, isAes, isDataKey, type Cipher, type KeyKind, type MethodId } from '../crypto/methods';
import { METHOD_TEXT, DRAWING_TEXT as T } from './catalog';
import type { Palette } from './palette';

type Part = string | readonly [Shape, SketchOptions];

const render = (parts: readonly Part[]) => parts.map((p) => (typeof p === 'string' ? p : toSvgSketch(sketch(p[0], p[1])))).join('');

function draw(svg: SVGSVGElement, parts: readonly Part[], defs = ''): void {
  svg.innerHTML = (defs ? `<defs>${defs}</defs>` : '') + render(parts);
}

const hand = (text: string, x: number, y: number, size: number, fill: string, anchor: 'start' | 'middle' | 'end' = 'middle') =>
  toSvgText(layoutText(text, { x, y, fontSize: size, anchor, baseline: 'middle' }), { fill });

/** The handwriting face the drawings use, as CSS, for the page to add once. */
export const handwritingCss = (): string => fontFaceCss(excalifontFiles);

export function clear(svg: SVGSVGElement): void {
  svg.innerHTML = '';
}

export function drawTint(svg: SVGSVGElement, p: Palette): void {
  const tint = pattern({ kind: 'cross-hatch', size: 9, stroke: p.tintLine, strokeWidth: 1.1, background: p.wash, seed: 'security-tint' });
  draw(svg, [`<rect width="100%" height="100%" fill="${tint.fill}"/>`], tint.def);
}

export function drawEnvelope(svg: SVGSVGElement, p: Palette, method: MethodId, key: KeyKind, closed: boolean): void {
  const ink = { stroke: p.ink, strokeWidth: 1.6 };
  const grade = gradeOf(method);
  const wax = { recommended: p.tint, legacy: p.legacy, insecure: p.alarm }[grade];
  const parts: Part[] = [
    [{ kind: 'rectangle', x: 20, y: 100, width: 360, height: 180 }, { ...ink, fill: p.field, fillStyle: 'solid', seed: 'body' }],
    [{ kind: 'line', x1: 22, y1: 278, x2: 150, y2: 196 }, { ...ink, strokeWidth: 1, seed: 'fold-l' }],
    [{ kind: 'line', x1: 378, y1: 278, x2: 250, y2: 196 }, { ...ink, strokeWidth: 1, seed: 'fold-r' }],
    closed
      ? [{ kind: 'polygon', points: [[20, 100], [200, 196], [380, 100]] }, { ...ink, fill: p.wash, fillStyle: 'hachure', hachureGap: 6, hachureAngle: -41, seed: 'flap-closed' }]
      : [{ kind: 'polygon', points: [[20, 100], [200, 16], [380, 100]] }, { ...ink, fill: p.wash, fillStyle: 'hachure', hachureGap: 8, seed: 'flap-open' }],
  ];
  if (closed) parts.push([{ kind: 'circle', cx: 200, cy: 192, diameter: 36 }, { stroke: wax, strokeWidth: 2, fill: wax, fillStyle: 'solid', seed: 'wax' }]);
  parts.push(hand(METHOD_TEXT[method].name, 200, 236, 30, p.ink), hand(T.opensWith[key], 200, 264, 17, p.inkSoft));
  if (grade === 'insecure') {
    const stamp = toSvgSketch(sketch({ kind: 'rectangle', x: 58, y: 112, width: 284, height: 84 }, { stroke: p.alarm, strokeWidth: 4.5, roughness: 1.6, seed: 'stamp' }));
    parts.push(`<g transform="rotate(-8 200 154)">${stamp}${hand(T.notSecure, 200, 156, 56, p.alarm)}</g>`);
  }
  // A closed flap leaves the top of the drawing empty: crop to what is drawn.
  svg.setAttribute('viewBox', closed ? '0 90 400 200' : '0 0 400 290');
  draw(svg, parts);
}

// ---- How it works ----

export interface HowState {
  readonly method: MethodId;
  readonly key: KeyKind;
  /** The text being sealed, for the ciphers that draw its letters. */
  readonly text: string;
  /** The key as typed, for the classical ciphers: a shift, a keyword or a rail count. */
  readonly keyText: string;
  /** Once sealed, or when opening: the envelope, whose salt and nonce the AES diagram shows. */
  readonly envelope?: Envelope | undefined;
}

/** Reads a key with the cipher's own parser; a key it refuses is drawn with the textbook example. Any other failure is a bug: it is re-thrown, and the page logs it and leaves the drawing blank. */
function orExample<V>(read: () => V, example: V): V {
  try {
    return read();
  } catch (error) {
    if (error instanceof CipherError) return example;
    throw error;
  }
}

const box = (p: Palette, x: number, y: number, w: number, h: number, label: string, seed: string, lit: boolean): Part[] => [
  [{ kind: 'rectangle', x, y, width: w, height: h }, { stroke: p.ink, strokeWidth: 1.5, ...(lit ? { fill: p.wash, fillStyle: 'hachure', hachureGap: 5 } : {}), seed }],
  hand(label, x + w / 2, y + h / 2, 18, p.ink),
];

const arrow = (p: Palette, x1: number, y1: number, x2: number, y2: number, seed: string): Part[] => [
  [{ kind: 'line', x1, y1, x2, y2 }, { stroke: p.tint, strokeWidth: 1.8, seed }],
  [{ kind: 'polygon', points: [[x2 - 6, y2 - 10], [x2 + 6, y2 - 10], [x2, y2]] }, { stroke: p.tint, fill: p.tint, fillStyle: 'solid', seed: `${seed}h` }],
];

const short = (s: string | undefined) => (s ? `${s.slice(0, 10)}…` : '');

function aes(p: Palette, s: HowState, cipher: Cipher): Part[] {
  if (!isDataKey(s.key)) throw new Error(`An AES method does not take a ${s.key}.`);
  const sealed = s.envelope !== undefined && isAesEnvelope(s.envelope) ? s.envelope : undefined;
  const lit = sealed !== undefined;
  const salt = sealed && 'kdf' in sealed ? sealed.kdf.salt : undefined;
  const parts: Part[] = [...box(p, 20, 20, 180, 52, T.firstBox[s.key], 'b1', lit)];
  const stretch = T.stretch[s.key];
  if (stretch) {
    parts.push(...box(p, 260, 20, 180, 52, T.randomSalt, 'b2', lit));
    if (salt) parts.push(hand(short(salt), 350, 88, 15, p.tint));
    parts.push(...arrow(p, 110, 74, 190, 118, 'a1'), ...arrow(p, 350, 74, 270, 118, 'a2'));
    parts.push(...box(p, 60, 122, 340, 56, stretch, 'b3', lit), ...arrow(p, 230, 180, 120, 222, 'a3'));
  } else {
    parts.push(hand(T.usedDirectly, 230, 150, 17, p.tint), ...arrow(p, 110, 74, 110, 222, 'a3'));
  }
  parts.push(...box(p, 20, 226, 180, 52, T.aesKey, 'b4', lit), ...box(p, 260, 226, 180, 52, T.randomNonce, 'b5', lit));
  if (sealed) parts.push(hand(short(sealed.nonce), 350, 294, 15, p.tint));
  parts.push(...arrow(p, 110, 280, 190, 322, 'a4'), ...arrow(p, 350, 280, 270, 322, 'a5'));
  parts.push(...box(p, 80, 326, 300, 56, T.locks(cipher.algorithm), 'b6', lit));
  parts.push(...arrow(p, 230, 384, 230, 404, 'a6'), ...box(p, 40, 408, 380, 52, T.envelopeBox, 'b7', lit));
  if (!cipher.authenticated) parts.push(hand(T.noTamperCheck, 420, 352, 17, p.legacy, 'end'));
  return parts;
}

const letter = (i: number) => String.fromCharCode(65 + (((i % 26) + 26) % 26));

function caesarWheel(p: Palette, s: HowState): Part[] {
  const shift = orExample(() => parseShift(s.keyText), 3);
  const [cx, cy] = [230, 230];
  const parts: Part[] = [
    [{ kind: 'circle', cx, cy, diameter: 420 }, { stroke: p.ink, strokeWidth: 1.5, seed: 'o' }],
    [{ kind: 'circle', cx, cy, diameter: 320 }, { stroke: p.ink, strokeWidth: 1.5, seed: 'm' }],
    [{ kind: 'circle', cx, cy, diameter: 220 }, { stroke: p.tint, strokeWidth: 1.5, fill: p.wash, fillStyle: 'hachure', hachureGap: 7, seed: 'i' }],
  ];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 - Math.PI / 2;
    parts.push(hand(letter(i), cx + Math.cos(a) * 185, cy + Math.sin(a) * 185, 21, p.ink), hand(letter(i + shift), cx + Math.cos(a) * 135, cy + Math.sin(a) * 135, 21, p.tint));
  }
  parts.push(hand(T.shift(shift), cx, cy - 10, 30, p.tint), hand(T.becomes(letter(shift)), cx, cy + 26, 18, p.ink));
  return parts;
}

/** The drawings show a dozen characters at most; reading only the start keeps a long letter from slowing every keystroke. */
const SAMPLE = 1000;

function vigenereTable(p: Palette, s: HowState): Part[] {
  const keyword = orExample(() => parseKeyword(s.keyText), 'KEY');
  const shifts = Array.from(keyword, (c) => c.charCodeAt(0) - 65);
  const letters = Array.from((s.text.slice(0, SAMPLE).replace(/[^A-Za-z]/g, '').toUpperCase() || 'MEETMEATTHEGATE').slice(0, 10));
  const parts: Part[] = [hand(T.rowMessage, 12, 70, 17, p.ink, 'start'), hand(T.rowKeyword, 12, 150, 17, p.tint, 'start'), hand(T.rowSealed, 12, 230, 17, p.alarm, 'start')];
  letters.forEach((ch, i) => {
    const x = 118 + i * 34;
    const k = shifts[i % shifts.length] ?? 0;
    parts.push(hand(ch, x, 70, 24, p.ink), hand(letter(k), x, 150, 24, p.tint), hand(letter(ch.charCodeAt(0) - 65 + k), x, 230, 24, p.alarm));
    parts.push([{ kind: 'line', x1: x, y1: 88, x2: x, y2: 128 }, { stroke: p.tint, strokeWidth: 1.2, seed: `v${i}` }], [{ kind: 'line', x1: x, y1: 168, x2: x, y2: 208 }, { stroke: p.tint, strokeWidth: 1.2, seed: `w${i}` }]);
  });
  parts.push(hand(T.vigenereRepeats, 230, 300, 18, p.ink), hand(T.vigenereBreaks, 230, 330, 18, p.ink));
  return parts;
}

function atbashMirror(p: Palette): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < 13; i++) {
    const x = 30 + i * 32;
    parts.push(hand(letter(i), x, 120, 22, p.ink), hand(letter(25 - i), x, 200, 22, p.alarm));
    parts.push([{ kind: 'line', x1: x, y1: 140, x2: x, y2: 180 }, { stroke: p.tint, strokeWidth: 1.2, seed: `m${i}` }]);
  }
  parts.push(hand(T.atbashFold, 230, 270, 18, p.ink), hand(T.atbashNoKey, 230, 300, 18, p.ink));
  return parts;
}

/** The most rails the zigzag can show legibly; more are named in the caption. */
const DRAWN_RAILS = 12;

/**
 * Characters SVG text cannot hold (controls, unpaired surrogates, U+FFFE and U+FFFF) or that end the
 * line (U+0085). Typed or pasted into the letter, they are drawn as "?" rather than breaking the drawing.
 */
const UNDRAWABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0085\uFFFE\uFFFF\uD800-\uDFFF]/gu;

function railZigzag(p: Palette, s: HowState): Part[] {
  const rails = orExample(() => parseRails(s.keyText), 3);
  const shown = Math.min(rails, DRAWN_RAILS);
  const typed = Array.from(s.text.slice(0, SAMPLE).replace(/\s+/g, ' ').trim().replace(UNDRAWABLE, '?')).slice(0, 14);
  // A zigzag needs two points: a single character is drawn with the example, as an empty letter is.
  const chars = typed.length > 1 ? typed : Array.from('WE ARE DISCOVERED').slice(0, 14);
  const rows = railPattern(chars.length, shown);
  const points = rows.map((r, i): [number, number] => [30 + i * 30, 60 + r * (220 / (shown - 1))]);
  const parts: Part[] = [[{ kind: 'linearPath', points }, { stroke: p.tint, strokeWidth: 1.4, seed: 'zig' }]];
  chars.forEach((ch, i) => {
    const pt = points[i] ?? [0, 0];
    parts.push([{ kind: 'circle', cx: pt[0], cy: pt[1], diameter: 26 }, { stroke: p.ink, strokeWidth: 1.2, fill: p.field, fillStyle: 'solid', seed: `c${i}` }], hand(ch, pt[0], pt[1], 18, p.ink));
  });
  parts.push(hand(rails === shown ? T.rails(rails) : T.railsClamped(rails, shown), 230, 330, 18, p.ink));
  return parts;
}

function playfairGrid(p: Palette, s: HowState): Part[] {
  const keyword = orExample(() => parseKeyword(s.keyText), 'PLAYFAIREXAMPLE');
  const keyLetters = new Set(keyword.replace(/J/g, 'I'));
  const parts: Part[] = [];
  playfairSquare(keyword).forEach((ch, i) => {
    const [x, y] = [90 + (i % 5) * 58, 30 + Math.floor(i / 5) * 58];
    const fromKey = keyLetters.has(ch);
    parts.push([{ kind: 'rectangle', x, y, width: 52, height: 52 }, { stroke: p.ink, strokeWidth: 1.2, ...(fromKey ? { fill: p.wash, fillStyle: 'hachure', hachureGap: 5 } : {}), seed: `s${i}` }]);
    parts.push(hand(ch, x + 26, y + 26, 24, fromKey ? p.tint : p.ink));
  });
  parts.push(hand(T.playfairFill, 230, 345, 17, p.ink), hand(T.playfairMoves, 230, 372, 17, p.ink));
  return parts;
}

export function drawHowItWorks(svg: SVGSVGElement, p: Palette, s: HowState): void {
  const method = s.method;
  if (isAes(method)) return draw(svg, aes(p, s, aesSpec(method).cipher));
  switch (method) {
    case 'caesar':
      return draw(svg, caesarWheel(p, s));
    case 'vigenere':
      return draw(svg, vigenereTable(p, s));
    case 'atbash':
      return draw(svg, atbashMirror(p));
    case 'rail-fence':
      return draw(svg, railZigzag(p, s));
    case 'playfair':
      return draw(svg, playfairGrid(p, s));
    default:
      return assertNever(method, 'method');
  }
}
