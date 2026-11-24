// The classical learning ciphers, as the textbooks define them. They protect nothing and are graded
// insecure. Caesar, Vigenère and Atbash change the letters A to Z and keep everything else; rail
// fence rearranges every character; Playfair keeps letters only, merges I and J and pads pairs
// with X, so it gives back a normalised version of the text rather than the text itself.

import { CipherError } from './errors';
import { assertNever, type ClassicalMethodId } from './methods';
import type { LearnSecret } from './secrets';

export type Direction = 'seal' | 'open';

/**
 * The most text a learning cipher seals: 1 MiB. The ciphers run on the page's main thread a
 * character at a time, and a lesson needs far less.
 */
export const MAX_LEARN_BYTES = 1024 * 1024;
/** The longest ciphertext one of them can give for that much text: Playfair pads every letter in the worst case. */
export const MAX_LEARN_CIPHERTEXT = 2 * MAX_LEARN_BYTES;

const A = 65;
const a = 97;

function shiftLetters(text: string, shiftFor: (letterIndex: number) => number): string {
  let index = 0;
  return text.replace(/[A-Za-z]/g, (ch) => {
    const base = ch <= 'Z' ? A : a;
    const shift = shiftFor(index++);
    return String.fromCharCode(((((ch.charCodeAt(0) - base + shift) % 26) + 26) % 26) + base);
  });
}

export const SHIFT_MIN = 1;
export const SHIFT_MAX = 25;

export function parseShift(value: string): number {
  const shift = Number(value.trim());
  if (!Number.isInteger(shift) || shift < SHIFT_MIN || shift > SHIFT_MAX) throw new CipherError('shift-range');
  return shift;
}

export function parseKeyword(value: string): string {
  // NFC first, as for passwords, so a keyword typed in either Unicode form is the same key.
  const letters = value.normalize('NFC').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (letters.length === 0) throw new CipherError('keyword-letters');
  return letters;
}

export const RAILS_MIN = 2;
export const RAILS_MAX = 64;

export function parseRails(value: string): number {
  const rails = Number(value.trim());
  if (!Number.isInteger(rails) || rails < RAILS_MIN || rails > RAILS_MAX) throw new CipherError('rails-range');
  return rails;
}

export function caesar(text: string, shift: number, direction: Direction): string {
  return shiftLetters(text, () => (direction === 'seal' ? shift : -shift));
}

export function vigenere(text: string, keyword: string, direction: Direction): string {
  const shifts = Array.from(parseKeyword(keyword), (ch) => ch.charCodeAt(0) - A);
  return shiftLetters(text, (i) => {
    const s = shifts[i % shifts.length] ?? 0;
    return direction === 'seal' ? s : -s;
  });
}

export function atbash(text: string): string {
  return text.replace(/[A-Za-z]/g, (ch) => {
    const base = ch <= 'Z' ? A : a;
    return String.fromCharCode(base + 25 - (ch.charCodeAt(0) - base));
  });
}

/** The rail each position of a message of `length` characters lands on, zigzagging down and up. */
export function railPattern(length: number, rails: number): number[] {
  const cycle = 2 * (rails - 1);
  return Array.from({ length }, (_, i) => {
    const r = i % cycle;
    return r < rails ? r : cycle - r;
  });
}

export function railFence(text: string, rails: number, direction: Direction): string {
  const chars = Array.from(text);
  const pattern = railPattern(chars.length, rails);
  // Positions in reading order: rail 0 left to right, then rail 1, and so on.
  const order = pattern.map((rail, i) => ({ rail, i })).sort((x, y) => x.rail - y.rail || x.i - y.i).map((p) => p.i);
  if (direction === 'seal') return order.map((i) => chars[i]).join('');
  const out: string[] = new Array<string>(chars.length);
  order.forEach((position, k) => {
    out[position] = chars[k] ?? '';
  });
  return out.join('');
}

/** The 5 × 5 Playfair square for a keyword: its letters first, without repeats, J folded into I. */
export function playfairSquare(keyword: string): string[] {
  const seen = new Set<string>();
  const letters = (parseKeyword(keyword) + 'ABCDEFGHIKLMNOPQRSTUVWXYZ').replace(/J/g, 'I');
  return Array.from(letters).filter((ch) => !seen.has(ch) && seen.add(ch));
}

/** The text as Playfair reads it: letters only, upper case, J as I, split into pairs. */
function playfairPairs(text: string): [string, string][] {
  const letters = text.replace(/[^A-Za-z]/g, '').toUpperCase().replace(/J/g, 'I');
  const pairs: [string, string][] = [];
  let i = 0;
  while (i < letters.length) {
    const first = letters[i] ?? '';
    const second = letters[i + 1];
    const filler = first === 'X' ? 'Q' : 'X';
    if (second === undefined || second === first) {
      pairs.push([first, filler]);
      i += 1;
    } else {
      pairs.push([first, second]);
      i += 2;
    }
  }
  return pairs;
}

export function playfair(text: string, keyword: string, direction: Direction): string {
  const square = playfairSquare(keyword);
  const at = (ch: string) => square.indexOf(ch);
  const cell = (row: number, col: number) => square[((row + 5) % 5) * 5 + ((col + 5) % 5)] ?? '';
  const step = direction === 'seal' ? 1 : -1;
  // A sealed text never holds a pair of equal letters, so opening reads it as the same pairs.
  return playfairPairs(text)
    .map(([x, y]) => {
      const px = at(x), py = at(y);
      const [rx, cx, ry, cy] = [Math.floor(px / 5), px % 5, Math.floor(py / 5), py % 5];
      if (rx === ry) return cell(rx, cx + step) + cell(ry, cy + step);
      if (cx === cy) return cell(rx + step, cx) + cell(ry + step, cy);
      return cell(rx, cy) + cell(ry, cx);
    })
    .join('');
}

/** Narrows a learning key to the kind a cipher takes, or refuses it. */
function need<K extends LearnSecret['kind']>(secret: LearnSecret, kind: K): Extract<LearnSecret, { kind: K }> {
  if (secret.kind !== kind) throw new CipherError('key-kind-unsupported', secret.kind);
  // TypeScript cannot narrow a union by a generic discriminant; the line above has checked it.
  return secret as Extract<LearnSecret, { kind: K }>;
}

/** Seals or opens text with a classical cipher, reading its key as that cipher defines it. */
export function runClassical(method: ClassicalMethodId, text: string, secret: LearnSecret, direction: Direction): string {
  switch (method) {
    case 'caesar':
      return caesar(text, parseShift(need(secret, 'shift').shift), direction);
    case 'vigenere':
      return vigenere(text, need(secret, 'keyword').keyword, direction);
    case 'atbash':
      need(secret, 'none');
      return atbash(text);
    case 'rail-fence':
      return railFence(text, parseRails(need(secret, 'rails').rails), direction);
    case 'playfair':
      return playfair(text, need(secret, 'keyword').keyword, direction);
    default:
      return assertNever(method, 'method');
  }
}

const unchanged = (text: string) => text;

/** What opening gives back for a sealed text: the text itself, or the cipher's normalised form. */
const NORMALISE: Record<ClassicalMethodId, (text: string) => string> = {
  caesar: unchanged,
  vigenere: unchanged,
  atbash: unchanged,
  'rail-fence': unchanged,
  playfair: (text) => playfairPairs(text).flat().join(''),
};

export function classicalExpected(method: ClassicalMethodId, text: string): string {
  return NORMALISE[method](text);
}

/** Whether opening gives back a normalised text rather than the text itself. */
export function normalises(method: ClassicalMethodId): boolean {
  return NORMALISE[method] !== unchanged;
}
