// The envelope: a versioned JSON file holding the method ID, what decryption needs besides the
// secret, and the ciphertext. The type has no field a secret could go in. Reading is strict: an
// unknown version, method, key derivation or field is refused by name, never guessed around.

import { isBase64Url } from './bytes';
import { MAX_LEARN_CIPHERTEXT } from './classical';
import { CipherError } from './errors';
import { isRecord } from './json';
import { aesSpec, classicalSpec, isAes, isMethodId, type AesMethodId, type ClassicalMethodId, type DataKey, type LearnKey } from './methods';

export const FORMAT = 'cipher-envelope';
export const VERSION = 1;

// What a version-1 envelope may ask for. Frozen with the format: sealing may spend more (keys.ts),
// but these bounds only ever widen, so every envelope already saved keeps opening.
const V1_SALT_BYTES = 16;
const V1_PBKDF2_MIN_ITERATIONS = 600_000;
/** An upper bound, so a crafted envelope cannot make opening it take minutes. */
const V1_PBKDF2_MAX_ITERATIONS = 10_000_000;

export interface Pbkdf2 { readonly id: 'pbkdf2-sha256'; readonly iterations: number; readonly salt: string }
export interface Hkdf { readonly id: 'hkdf-sha256'; readonly salt: string }
export interface X25519Hkdf { readonly id: 'x25519-hkdf-sha256'; readonly salt: string; readonly epk: string }
export type Kdf = Pbkdf2 | Hkdf | X25519Hkdf;

interface Head {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly ciphertext: string;
}

interface AesHead extends Head {
  readonly method: AesMethodId;
  readonly nonce: string;
}

/** How an AES envelope opens decides its key derivation: none for a generated key. */
export type AesEnvelope =
  | (AesHead & { readonly opensWith: 'password'; readonly kdf: Pbkdf2 })
  | (AesHead & { readonly opensWith: 'generated' })
  | (AesHead & { readonly opensWith: 'keyfile'; readonly kdf: Hkdf })
  | (AesHead & { readonly opensWith: 'publickey'; readonly kdf: X25519Hkdf });

/** A classical envelope holds the transformed text itself, with no nonce and no key derivation. */
export interface ClassicalEnvelope extends Head {
  readonly method: ClassicalMethodId;
  readonly opensWith: LearnKey;
}

export type Envelope = AesEnvelope | ClassicalEnvelope;

export function isAesEnvelope(envelope: Envelope): envelope is AesEnvelope {
  return isAes(envelope.method);
}

const ENVELOPE_FIELDS = ['format', 'version', 'method', 'opensWith', 'kdf', 'nonce', 'ciphertext'];

/** Fixed field order, so the same envelope always serialises to the same text. */
export function serialize(envelope: Envelope): string {
  const { format, version, method, opensWith, ciphertext } = envelope;
  const kdf = 'kdf' in envelope ? envelope.kdf : undefined;
  const nonce = 'nonce' in envelope ? envelope.nonce : undefined;
  return JSON.stringify({ format, version, method, opensWith, kdf, nonce, ciphertext }, null, 2) + '\n';
}

function onlyFields(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const extra = Object.keys(value).find((k) => !allowed.includes(k));
  if (extra !== undefined) throw new CipherError('field-unknown', prefix + extra);
}

/** A value named back to the user. An object is named by its type: it could carry a toString of its own. */
const shown = (value: unknown) => (typeof value === 'object' && value !== null ? typeof value : String(value));

// Checked, never decoded: the ciphertext can be tens of megabytes. Strict base64url has one length
// per byte count, so a fixed-length field's size follows from its text.
function base64Field(value: unknown, name: string, length?: number): string {
  if (typeof value !== 'string' || !isBase64Url(value)) throw new CipherError('field-invalid', name);
  if (length !== undefined && Math.floor((value.length * 3) / 4) !== length) throw new CipherError('field-invalid', name);
  return value;
}

/**
 * AES-GCM gives at least its 16-byte tag, and AES-CBC whole 16-byte blocks, at least one. A
 * ciphertext of any other length could never open, so it is refused as damaged, never tried.
 */
const AES_BLOCK_BYTES = 16;
function aesCiphertext(value: string, method: AesMethodId): string {
  const bytes = Math.floor((base64Field(value, 'ciphertext').length * 3) / 4);
  if (bytes < AES_BLOCK_BYTES || (aesSpec(method).cipher.algorithm === 'AES-CBC' && bytes % AES_BLOCK_BYTES !== 0)) throw new CipherError('field-invalid', 'ciphertext');
  return value;
}

const KDF_IDS = ['pbkdf2-sha256', 'hkdf-sha256', 'x25519-hkdf-sha256'];

/** The kdf object an AES envelope carries, checked against the kind of key it opens with. */
function readKdf(value: unknown, expected: Kdf['id']): Record<string, unknown> {
  if (!isRecord(value)) throw new CipherError('field-invalid', 'kdf');
  const id = value['id'];
  if (typeof id !== 'string' || !KDF_IDS.includes(id)) throw new CipherError('kdf-unknown', shown(id));
  if (id !== expected) throw new CipherError('field-invalid', 'kdf.id');
  return value;
}

function parseAes(value: Record<string, unknown>, method: AesMethodId, opensWith: DataKey, ciphertext: string): AesEnvelope {
  const head = {
    format: FORMAT,
    version: VERSION,
    method,
    nonce: base64Field(value['nonce'], 'nonce', aesSpec(method).cipher.nonceBytes),
    ciphertext: aesCiphertext(ciphertext, method),
  } as const;
  switch (opensWith) {
    case 'password': {
      const kdf = readKdf(value['kdf'], 'pbkdf2-sha256');
      onlyFields(kdf, ['id', 'iterations', 'salt'], 'kdf.');
      const iterations = kdf['iterations'];
      if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < V1_PBKDF2_MIN_ITERATIONS || iterations > V1_PBKDF2_MAX_ITERATIONS) {
        throw new CipherError('iterations-range', shown(iterations));
      }
      return { ...head, opensWith, kdf: { id: 'pbkdf2-sha256', iterations, salt: base64Field(kdf['salt'], 'kdf.salt', V1_SALT_BYTES) } };
    }
    case 'generated':
      if (value['kdf'] !== undefined) throw new CipherError('field-invalid', 'kdf');
      return { ...head, opensWith };
    case 'keyfile': {
      const kdf = readKdf(value['kdf'], 'hkdf-sha256');
      onlyFields(kdf, ['id', 'salt'], 'kdf.');
      return { ...head, opensWith, kdf: { id: 'hkdf-sha256', salt: base64Field(kdf['salt'], 'kdf.salt', V1_SALT_BYTES) } };
    }
    case 'publickey': {
      const kdf = readKdf(value['kdf'], 'x25519-hkdf-sha256');
      onlyFields(kdf, ['id', 'salt', 'epk'], 'kdf.');
      return { ...head, opensWith, kdf: { id: 'x25519-hkdf-sha256', salt: base64Field(kdf['salt'], 'kdf.salt', V1_SALT_BYTES), epk: base64Field(kdf['epk'], 'kdf.epk', 32) } };
    }
  }
}

export function parse(text: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CipherError('not-envelope');
  }
  if (!isRecord(value) || value['format'] !== FORMAT) throw new CipherError('not-envelope');
  const version = value['version'];
  if (typeof version === 'number' && Number.isInteger(version) && version > VERSION) throw new CipherError('version-newer', String(version));
  if (version !== VERSION) throw new CipherError('version-invalid', shown(version));
  onlyFields(value, ENVELOPE_FIELDS, '');

  const method = value['method'];
  if (typeof method !== 'string' || !isMethodId(method)) throw new CipherError('method-unknown', shown(method));
  const ciphertext = value['ciphertext'];
  if (typeof ciphertext !== 'string') throw new CipherError('field-invalid', 'ciphertext');

  // opensWith is looked up in the method's own keys, so what is returned is one of them, typed.
  const raw = value['opensWith'];
  if (isAes(method)) {
    const opensWith = aesSpec(method).keys.find((k) => k === raw);
    if (opensWith === undefined) throw new CipherError('field-invalid', 'opensWith');
    return parseAes(value, method, opensWith, ciphertext);
  }
  const opensWith: LearnKey = classicalSpec(method).key;
  if (raw !== opensWith) throw new CipherError('field-invalid', 'opensWith');
  if (value['kdf'] !== undefined) throw new CipherError('field-invalid', 'kdf');
  if (value['nonce'] !== undefined) throw new CipherError('field-invalid', 'nonce');
  if (ciphertext.length > MAX_LEARN_CIPHERTEXT) throw new CipherError('field-invalid', 'ciphertext'); // more than any seal gives
  return { format: FORMAT, version: VERSION, method, opensWith, ciphertext };
}
