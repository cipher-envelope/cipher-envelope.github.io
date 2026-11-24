// Turning what the user holds into an AES key. Everything here is the browser's own Web Crypto.

import { concatBytes, equalBytes, fromBase64Url, toBase64Url, utf8, type Bytes } from './bytes';
import { CipherError } from './errors';
import { isRecord } from './json';
import type { Cipher } from './methods';

export type AesAlgorithm = Cipher['algorithm'];

/**
 * What sealing spends on a password: the figure for PBKDF2-HMAC-SHA256 in OWASP's Password Storage
 * Cheat Sheet (checked 2026-11-20). It may rise in a later release. What an envelope may ask for when it is opened is a separate, frozen range (see
 * envelope.ts), so raising this never locks out an envelope already saved.
 */
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;
/** The largest key file read: the same as the most this version seals, since both are held in memory whole. */
export const MAX_KEY_FILE_BYTES = 64 * 1024 * 1024;
/** A private-key file is a few hundred bytes; anything far larger is not one. */
export const MAX_PRIVATE_KEY_FILE_BYTES = 64 * 1024;

const KEYFILE_INFO = utf8('cipher-envelope v1 key file');
const X25519_INFO = utf8('cipher-envelope v1 x25519');

export async function keyFromPassword(password: string, salt: Bytes, iterations: number, algorithm: AesAlgorithm): Promise<CryptoKey> {
  if (password.length === 0) throw new CipherError('password-empty');
  // NFC first, so a password typed with a composed "é" on one device and a decomposed one on
  // another derives the same key. Part of the v1 format: it cannot change later.
  const base = await crypto.subtle.importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: algorithm, length: 256 }, false, ['encrypt', 'decrypt']);
}

export function parseGeneratedKey(text: string): Bytes {
  let raw: Bytes;
  try {
    raw = fromBase64Url(text.trim());
  } catch {
    throw new CipherError('generated-key-invalid');
  }
  if (raw.length !== KEY_BYTES) throw new CipherError('generated-key-invalid');
  return raw;
}

export async function keyFromGenerated(text: string, algorithm: AesAlgorithm): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', parseGeneratedKey(text), algorithm, false, ['encrypt', 'decrypt']);
}

export async function keyFromFile(file: Bytes, salt: Bytes, algorithm: AesAlgorithm): Promise<CryptoKey> {
  if (file.length === 0) throw new CipherError('keyfile-missing');
  const base = await crypto.subtle.importKey('raw', file, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: KEYFILE_INFO }, base, { name: algorithm, length: 256 }, false, ['encrypt', 'decrypt']);
}

// ---- X25519: one person, by their public key ----

/** A private-key file, as the "make a key pair" flow saves it. */
export interface PrivateKeyFile {
  readonly format: 'cipher-envelope-key';
  readonly version: 1;
  readonly kind: 'x25519-private';
  readonly publicKey: string;
  readonly privateKey: string;
}

export async function supportsX25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

async function requireX25519<T>(work: () => Promise<T>): Promise<T> {
  if (!(await supportsX25519())) throw new CipherError('x25519-unsupported');
  return work();
}

/**
 * The one form a v1 private-key file holds its key in: RFC 8410's PKCS#8 prefix for an X25519 key,
 * then the 32-byte private key. Platforms export other valid PKCS#8 forms (one carries the public
 * key too), so the file is written in this form, and read only in it, whichever browser made it.
 */
const X25519_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const X25519_PKCS8_BYTES = X25519_PKCS8_PREFIX.length + 32;

export async function makeKeyPair(): Promise<{ publicKey: string; privateKeyFile: PrivateKeyFile }> {
  return requireX25519(async () => {
    // generateKey is typed for every algorithm; for X25519, an asymmetric one, it always returns a pair.
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
    const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const scalar = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
    if (scalar === undefined) throw new CipherError('x25519-unsupported'); // a platform with X25519 exports it
    const privateKey = toBase64Url(concatBytes(X25519_PKCS8_PREFIX, fromBase64Url(scalar)));
    return { publicKey, privateKeyFile: { format: 'cipher-envelope-key', version: 1, kind: 'x25519-private', publicKey, privateKey } };
  });
}

export function parsePublicKey(text: string): Bytes {
  let raw: Bytes;
  try {
    raw = fromBase64Url(text.trim());
  } catch {
    throw new CipherError('public-key-invalid');
  }
  if (raw.length !== 32) throw new CipherError('public-key-invalid');
  return raw;
}

export function parsePrivateKeyFile(text: string): { publicKey: Bytes; privateKey: Bytes } {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new CipherError('private-key-invalid');
  }
  // Exactly the five fields a saved file has: v1 reads it as strictly as an envelope.
  if (!isRecord(file) || Object.keys(file).length !== 5 || file.format !== 'cipher-envelope-key' || file.version !== 1 || file.kind !== 'x25519-private') {
    throw new CipherError('private-key-invalid');
  }
  const { publicKey, privateKey } = file;
  if (typeof publicKey !== 'string' || typeof privateKey !== 'string') throw new CipherError('private-key-invalid');
  try {
    const pkcs8 = fromBase64Url(privateKey);
    if (pkcs8.length !== X25519_PKCS8_BYTES || !equalBytes(pkcs8.subarray(0, X25519_PKCS8_PREFIX.length), X25519_PKCS8_PREFIX)) throw new CipherError('private-key-invalid');
    return { publicKey: parsePublicKey(publicKey), privateKey: pkcs8 };
  } catch {
    throw new CipherError('private-key-invalid');
  }
}

/** Who is at fault if the agreement fails: the recipient's public key when sealing, the envelope's ephemeral key when opening. */
type Blame = { readonly code: 'public-key-invalid' } | { readonly code: 'field-invalid'; readonly detail: 'kdf.epk' };

/**
 * The X25519 shared secret. A low-order public key makes the agreement fail: most platforms refuse
 * the derivation themselves (Web Crypto requires it), and an all-zero result is refused here for
 * those that do not (RFC 7748, section 6.1). Either way, the key at fault is the one named.
 */
async function sharedSecret(peer: CryptoKey, own: CryptoKey, blame: Blame): Promise<Bytes> {
  let shared: Bytes;
  try {
    shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, own, 256));
  } catch {
    throw new CipherError(blame.code, 'detail' in blame ? blame.detail : undefined);
  }
  if (shared.every((b) => b === 0)) throw new CipherError(blame.code, 'detail' in blame ? blame.detail : 'low-order');
  return shared;
}

async function contentKeyFromShared(shared: Bytes, salt: Bytes, ephemeral: Bytes, recipient: Bytes, algorithm: AesAlgorithm): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const info = concatBytes(X25519_INFO, ephemeral, recipient);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, { name: algorithm, length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * For sealing: a fresh ephemeral key pair, the content key it agrees with the recipient, and
 * `rederive`, which derives that key again from a salt and an ephemeral key read back from the
 * envelope's text, so the sender can check what was written.
 */
export async function keyForRecipient(
  recipientText: string,
  salt: Bytes,
  algorithm: AesAlgorithm,
): Promise<{ key: CryptoKey; ephemeral: Bytes; rederive: (salt: Bytes, ephemeral: Bytes) => Promise<CryptoKey> }> {
  const recipient = parsePublicKey(recipientText);
  return requireX25519(async () => {
    // As in makeKeyPair: X25519 always gives a pair. Its private half is used once and never exported.
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    const ephemeral = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    let peer: CryptoKey;
    try {
      peer = await crypto.subtle.importKey('raw', recipient, { name: 'X25519' }, false, []);
    } catch {
      throw new CipherError('public-key-invalid');
    }
    const shared = await sharedSecret(peer, pair.privateKey, { code: 'public-key-invalid' });
    const rederive = (readSalt: Bytes, readEphemeral: Bytes) => contentKeyFromShared(shared, readSalt, readEphemeral, recipient, algorithm);
    return { key: await rederive(salt, ephemeral), ephemeral, rederive };
  });
}

/** For opening: the same content key, from the recipient's private-key file. */
export async function keyFromPrivateKeyFile(fileText: string, salt: Bytes, ephemeral: Bytes, algorithm: AesAlgorithm): Promise<CryptoKey> {
  const { publicKey, privateKey } = parsePrivateKeyFile(fileText);
  return requireX25519(async () => {
    let own: CryptoKey;
    let peer: CryptoKey;
    try {
      own = await crypto.subtle.importKey('pkcs8', privateKey, { name: 'X25519' }, false, ['deriveBits']);
    } catch {
      throw new CipherError('private-key-invalid');
    }
    try {
      peer = await crypto.subtle.importKey('raw', ephemeral, { name: 'X25519' }, false, []);
    } catch {
      throw new CipherError('field-invalid', 'kdf.epk');
    }
    const shared = await sharedSecret(peer, own, { code: 'field-invalid', detail: 'kdf.epk' });
    return contentKeyFromShared(shared, salt, ephemeral, publicKey, algorithm);
  });
}
