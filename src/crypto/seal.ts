// Sealing and opening. Every seal is opened again from its own serialised text and compared with
// what it should give back before it is returned, so an envelope that would not open is never
// offered for download.

import { equalBytes, fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8, type Bytes } from './bytes';
import { classicalExpected, MAX_LEARN_BYTES, runClassical } from './classical';
import { FORMAT, isAesEnvelope, parse, serialize, VERSION, type AesEnvelope, type Envelope } from './envelope';
import { CipherError } from './errors';
import { isRecord } from './json';
import { keyForRecipient, keyFromFile, keyFromGenerated, keyFromPassword, keyFromPrivateKeyFile, PBKDF2_ITERATIONS, SALT_BYTES } from './keys';
import { acceptsKey, aesSpec, classicalSpec, isAes, type AesMethodId, type ClassicalMethodId, type MethodId } from './methods';
import { isDataSecret, isLearnSecret, type DataSecret, type LearnSecret, type OpenDataSecret, type OpenSecret, type SealSecret } from './secrets';

export type { OpenSecret, SealSecret } from './secrets';

export type Content =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly name: string; readonly type: string; readonly bytes: Bytes };

/** 64 MiB: sealing happens in memory, in one piece. Chunked sealing would lift this. */
export const MAX_INPUT_BYTES = 64 * 1024 * 1024;

/**
 * The largest envelope text read when opening: base64 makes the sealed bytes 4/3 as long, and 64 KiB
 * on each side leaves room for the file's name and type and for the envelope's own fields.
 */
export const MAX_ENVELOPE_BYTES = Math.ceil(((MAX_INPUT_BYTES + 64 * 1024) * 4) / 3) + 64 * 1024;

export function contentBytes(content: Content): number {
  return content.kind === 'text' ? utf8(content.text).length : content.bytes.length;
}

export function assertWithinLimit(byteLength: number, limit: number = MAX_INPUT_BYTES): void {
  if (byteLength > limit) throw new CipherError('too-large', String(limit));
}

// The file's name and type travel inside the ciphertext, so the envelope reveals nothing about them.
function pack(content: Content): Bytes {
  const header = utf8(JSON.stringify(content.kind === 'file' ? { kind: 'file', name: content.name, type: content.type } : { kind: 'text' }));
  const body = content.kind === 'file' ? content.bytes : utf8(content.text);
  const out = new Uint8Array(4 + header.length + body.length);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  out.set(body, 4 + header.length);
  return out;
}

function unpack(bytes: Bytes): Content {
  try {
    const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
    // Read as strictly as the envelope: the header fits, and holds its kind's fields and no others.
    if (length <= bytes.length - 4) {
      const header: unknown = JSON.parse(fromUtf8(bytes.subarray(4, 4 + length)));
      const body = bytes.slice(4 + length);
      if (isRecord(header) && header.kind === 'text' && Object.keys(header).length === 1) return { kind: 'text', text: fromUtf8(body) };
      if (isRecord(header) && header.kind === 'file' && typeof header.name === 'string' && typeof header.type === 'string' && Object.keys(header).length === 3) {
        return { kind: 'file', name: header.name, type: header.type, bytes: body };
      }
    }
  } catch {
    // Falls through: a header that does not parse means the wrong key got past an unauthenticated cipher.
  }
  throw new CipherError('garbled');
}

async function decrypt(envelope: AesEnvelope, key: CryptoKey): Promise<Content> {
  const { algorithm, authenticated } = aesSpec(envelope.method).cipher;
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: algorithm, iv: fromBase64Url(envelope.nonce) }, key, fromBase64Url(envelope.ciphertext));
  } catch {
    throw new CipherError(authenticated ? 'wrong-secret' : 'unauthenticated-failed');
  }
  return unpack(new Uint8Array(plain));
}

async function openingKey(envelope: AesEnvelope, secret: OpenDataSecret): Promise<CryptoKey> {
  const { algorithm } = aesSpec(envelope.method).cipher;
  switch (envelope.opensWith) {
    case 'password':
      if (secret.kind === 'password') return keyFromPassword(secret.password, fromBase64Url(envelope.kdf.salt), envelope.kdf.iterations, algorithm);
      break;
    case 'generated':
      if (secret.kind === 'generated') return keyFromGenerated(secret.key, algorithm);
      break;
    case 'keyfile':
      if (secret.kind === 'keyfile') return keyFromFile(secret.file, fromBase64Url(envelope.kdf.salt), algorithm);
      break;
    case 'publickey':
      if (secret.kind === 'privatekey') return keyFromPrivateKeyFile(secret.file, fromBase64Url(envelope.kdf.salt), fromBase64Url(envelope.kdf.epk), algorithm);
      break;
  }
  throw new CipherError('key-kind-unsupported', secret.kind);
}

export async function open(envelope: Envelope, secret: OpenSecret): Promise<Content> {
  if (!isAesEnvelope(envelope)) {
    if (!isLearnSecret(secret)) throw new CipherError('key-kind-unsupported', secret.kind);
    return { kind: 'text', text: runClassical(envelope.method, envelope.ciphertext, secret, 'open') };
  }
  if (isLearnSecret(secret)) throw new CipherError('key-kind-unsupported', secret.kind);
  return decrypt(envelope, await openingKey(envelope, secret));
}

/** A sealed envelope, what opening it must give back, and how to open its re-read text. */
interface Sealing {
  readonly envelope: Envelope;
  readonly expected: Content;
  readonly reopen: (reread: Envelope) => Promise<Content>;
}

function sealClassical(method: ClassicalMethodId, content: Content, secret: LearnSecret): Sealing {
  if (content.kind !== 'text') throw new CipherError('text-only');
  if (contentBytes(content) > MAX_LEARN_BYTES) throw new CipherError('learn-too-large', String(MAX_LEARN_BYTES));
  const expected = classicalExpected(method, content.text);
  // Playfair keeps letters only: a text with none would seal to an envelope that opens to nothing.
  if (expected === '') throw new CipherError('empty-input');
  return {
    envelope: { format: FORMAT, version: VERSION, method, opensWith: classicalSpec(method).key, ciphertext: runClassical(method, content.text, secret, 'seal') },
    expected: { kind: 'text', text: expected },
    reopen: (reread) => open(reread, secret),
  };
}

async function sealAes(method: AesMethodId, content: Content, secret: DataSecret): Promise<Sealing> {
  const { algorithm, nonceBytes } = aesSpec(method).cipher;
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(nonceBytes);
  const head = { format: FORMAT, version: VERSION, method, nonce: toBase64Url(nonce) } as const;
  const encrypt = async (key: CryptoKey) => toBase64Url(new Uint8Array(await crypto.subtle.encrypt({ name: algorithm, iv: nonce }, key, pack(content))));
  switch (secret.kind) {
    case 'password': {
      const key = await keyFromPassword(secret.password, salt, PBKDF2_ITERATIONS, algorithm);
      const kdf = { id: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS, salt: toBase64Url(salt) } as const;
      return { envelope: { ...head, opensWith: 'password', kdf, ciphertext: await encrypt(key) }, expected: content, reopen: (reread) => open(reread, secret) };
    }
    case 'generated': {
      const key = await keyFromGenerated(secret.key, algorithm);
      return { envelope: { ...head, opensWith: 'generated', ciphertext: await encrypt(key) }, expected: content, reopen: (reread) => open(reread, secret) };
    }
    case 'keyfile': {
      const key = await keyFromFile(secret.file, salt, algorithm);
      const kdf = { id: 'hkdf-sha256', salt: toBase64Url(salt) } as const;
      return { envelope: { ...head, opensWith: 'keyfile', kdf, ciphertext: await encrypt(key) }, expected: content, reopen: (reread) => open(reread, secret) };
    }
    case 'publickey': {
      const { key, ephemeral, rederive } = await keyForRecipient(secret.publicKey, salt, algorithm);
      const kdf = { id: 'x25519-hkdf-sha256', salt: toBase64Url(salt), epk: toBase64Url(ephemeral) } as const;
      // The sender holds no private key to open it with. The check derives the content key again from
      // the salt and ephemeral key read back from the text, which covers everything written; only the
      // recipient's side of the agreement is left unchecked.
      return {
        envelope: { ...head, opensWith: 'publickey', kdf, ciphertext: await encrypt(key) },
        expected: content,
        reopen: async (reread) => {
          if (!isAesEnvelope(reread) || reread.opensWith !== 'publickey') throw new CipherError('round-trip-failed');
          return decrypt(reread, await rederive(fromBase64Url(reread.kdf.salt), fromBase64Url(reread.kdf.epk)));
        },
      };
    }
  }
}

function sameContent(a: Content, b: Content): boolean {
  if (a.kind === 'text' && b.kind === 'text') return a.text === b.text;
  if (a.kind === 'file' && b.kind === 'file') return a.name === b.name && a.type === b.type && equalBytes(a.bytes, b.bytes);
  return false;
}

/** Seals the content and proves the downloadable text opens back to it before returning. */
export async function seal(method: MethodId, content: Content, secret: SealSecret): Promise<Envelope> {
  if (!acceptsKey(method, secret.kind)) throw new CipherError('key-kind-unsupported', secret.kind);
  // An empty text is nothing typed yet; an empty file is a file, and seals like any other.
  if (content.kind === 'text' && content.text === '') throw new CipherError('empty-input');
  assertWithinLimit(contentBytes(content));
  let sealing: Sealing;
  if (isAes(method)) {
    if (!isDataSecret(secret)) throw new CipherError('key-kind-unsupported', secret.kind);
    sealing = await sealAes(method, content, secret);
  } else {
    if (isDataSecret(secret)) throw new CipherError('key-kind-unsupported', secret.kind);
    sealing = sealClassical(method, content, secret);
  }
  const back = await sealing.reopen(parse(serialize(sealing.envelope)));
  if (!sameContent(sealing.expected, back)) throw new CipherError('round-trip-failed');
  return sealing.envelope;
}
