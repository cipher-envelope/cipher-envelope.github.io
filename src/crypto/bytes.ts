export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
// Strict: a leading U+FEFF is kept as part of the text, and bytes that are not UTF-8 are refused,
// never repaired. TextEncoder writes any well-formed text exactly, so a round trip gives it back
// unchanged; a lone surrogate cannot be written, so an AES seal's own check refuses a text holding one.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

export const utf8 = (text: string): Bytes => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** The bits the last character leaves unused, by the text's length mod 4. */
const SPARE_BITS = [0, 0, 0b1111, 0b11];

/**
 * Strict base64url: the alphabet only, no padding, a length that can be decoded, and the last
 * character's unused bits zero. Each byte string then has exactly one spelling.
 */
export function isBase64Url(text: string): boolean {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return false;
  return (ALPHABET.indexOf(text.at(-1) ?? 'A') & (SPARE_BITS[text.length % 4] ?? 0)) === 0;
}

/** Strict: anything isBase64Url refuses is refused here, never skipped or rounded. */
export function fromBase64Url(text: string): Bytes {
  if (!isBase64Url(text)) throw new RangeError('Not base64url.');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function concatBytes(...parts: readonly Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
